"""
The archive assistant.

Groq is stubbed throughout — these test the harness, not the model. What
matters is that a public endpoint which spends money and answers questions
about real events cannot be drained, cannot invent, and cannot fail loudly.
"""

import json
from datetime import datetime, timedelta

import pytest
import requests

from app import main, models
from app.services import agent


@pytest.fixture(autouse=True)
def _reset_throttle():
    agent._recent_calls.clear()
    yield
    agent._recent_calls.clear()


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")


@pytest.fixture
def archive(db, countries):
    source = models.Source(name="BBC World", reliability=1.3)
    db.add(source)
    db.commit()
    db.add_all([
        models.Article(url="a1", title="Colombia earthquake kills 200", description="Rescue continues",
                       country_id=countries["IN"], source_id=source.id, geo_risk_score=90.0,
                       event_type="disaster", is_duplicate=False, published_at=datetime.utcnow()),
        models.Article(url="a2", title="Ukraine strikes continue", description="Shelling reported",
                       country_id=countries["UA"], source_id=source.id, geo_risk_score=85.0,
                       event_type="conflict", is_duplicate=False,
                       published_at=datetime.utcnow() - timedelta(days=1)),
    ])
    db.commit()


class _Reply:
    def __init__(self, status=200, message=None, text=""):
        self.status_code = status
        self._message = message
        self.text = text

    def json(self):
        if self._message is None:
            raise ValueError("no json")
        return {"choices": [{"message": self._message}]}


def _answer(text):
    return _Reply(message={"role": "assistant", "content": text})


def _tool_call(name, args):
    return _Reply(message={
        "role": "assistant",
        "content": "",
        "tool_calls": [{
            "id": "call_1",
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }],
    })


class TestDegradesSafely:
    def test_without_a_key_it_refuses_rather_than_guessing(self, db, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        result = agent.ask(db, "What happened in Colombia?")
        assert result["answer"] is None
        assert "not configured" in result["error"]

    def test_network_failure_returns_a_message_not_an_exception(self, db, configured, monkeypatch):
        def boom(*a, **k):
            raise requests.ConnectionError("down")
        monkeypatch.setattr(agent.requests, "post", boom)

        result = agent.ask(db, "What happened?")
        assert result["answer"] is None and result["error"]

    def test_upstream_error_does_not_fabricate(self, db, configured, monkeypatch):
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Reply(status=500, text="boom"))
        assert agent.ask(db, "What happened?")["answer"] is None

    def test_rate_limit_is_a_message_not_a_failure(self, db, configured, monkeypatch):
        monkeypatch.setattr(agent, "RATE_LIMIT_REQUESTS", 2)
        assert agent.rate_limited("1.2.3.4") is False
        assert agent.rate_limited("1.2.3.4") is False
        assert agent.rate_limited("1.2.3.4") is True
        # A different caller is unaffected.
        assert agent.rate_limited("5.6.7.8") is False

    def test_empty_question_is_rejected_before_spending_anything(self, db, configured, monkeypatch):
        called = []
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: called.append(1) or _answer("x"))
        agent.ask(db, "   ")
        assert called == [], "an empty question must not reach the model"


class TestBudget:
    def test_spent_budget_stops_further_questions(self, db, configured, monkeypatch):
        monkeypatch.setattr(agent, "DAILY_BUDGET", 1)
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _answer("first"))

        assert agent.ask(db, "one")["answer"] == "first"
        second = agent.ask(db, "two")
        assert second["answer"] is None
        assert "limit" in second["error"]

    def test_only_answered_questions_are_charged(self, db, configured, monkeypatch):
        """A failed upstream call should not consume the day's allowance."""
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Reply(status=500, text="x"))
        agent.ask(db, "anything")
        _, used = agent._budget_state(db)
        assert used == 0


class TestGrounding:
    def test_tool_results_become_citable_sources(self, db, configured, archive, monkeypatch):
        replies = iter([
            _tool_call("search_news", {"query": "earthquake"}),
            _answer("An earthquake killed 200 people in Colombia."),
        ])
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: next(replies))

        result = agent.ask(db, "What happened in Colombia?")
        assert result["tools_used"] == ["search_news"]
        assert result["sources"], "an answer drawn from tools must expose them"
        assert any("Colombia" in (s["title"] or "") for s in result["sources"])

    def test_search_finds_nothing_for_a_fictional_place(self, db, archive):
        assert agent._search_news(db, "Wakanda")["count"] == 0

    def test_tool_failure_does_not_break_the_answer(self, db, configured, monkeypatch):
        replies = iter([
            _tool_call("country_briefing", {"country": "Nowhereland"}),
            _answer("The archive has no coverage of that."),
        ])
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: next(replies))
        assert agent.ask(db, "How is Nowhereland?")["answer"]

    def test_unknown_tool_is_reported_not_raised(self, db):
        assert "error" in agent._dispatch(db, "definitely_not_a_tool", {})

    def test_runaway_tool_loops_are_cut_off(self, db, configured, archive, monkeypatch):
        """A model that only ever calls tools must still terminate."""
        monkeypatch.setattr(agent.requests, "post",
                            lambda *a, **k: _tool_call("search_news", {"query": "x"}))
        result = agent.ask(db, "loop forever")
        assert result["answer"] is None
        assert "narrower" in result["error"]


class TestRefreshingTheFeed:
    """The one tool that acts rather than reads.

    It is reached through a public, unauthenticated route and each cycle makes
    dozens of upstream requests per country against metered allowances, so the
    authorisation boundary matters more here than anywhere else in the agent.
    """

    @pytest.fixture
    def wired(self, monkeypatch):
        started = []
        state = {"running": False, "started_at": None, "finished_at": None,
                 "last_summary": {"total_saved": 42}, "last_error": None}
        monkeypatch.setattr(agent, "_ingest_trigger", lambda size: started.append(size))
        monkeypatch.setattr(agent, "_ingest_reader", lambda: state)
        return started, state

    def test_a_stranger_cannot_spend_the_quota(self, wired):
        started, _ = wired
        result = agent._refresh_feed(allowed=False)
        assert result["permitted"] is False
        assert started == [], "an unauthorised caller must not start a cycle"

    def test_the_owner_can(self, wired):
        started, _ = wired
        assert agent._refresh_feed(allowed=True)["started"] is True
        assert started == [15]

    def test_it_does_not_claim_to_have_finished(self, wired):
        """The cycle takes minutes; the answer must not imply fresh articles."""
        message = agent._refresh_feed(allowed=True)["message"].lower()
        assert "not finished" in message or "started" in message

    def test_a_second_request_does_not_stack_cycles(self, wired):
        started, state = wired
        state["running"] = True
        result = agent._refresh_feed(allowed=True)
        assert result["already_running"] is True
        assert started == [], "a cycle was already running"

    def test_the_country_count_is_bounded(self, wired):
        started, _ = wired
        agent._refresh_feed(allowed=True, countries=9999)
        agent._refresh_feed(allowed=True, countries=-4)
        assert started == [100, 1]

    def test_without_a_trigger_it_says_so_rather_than_raising(self, monkeypatch):
        monkeypatch.setattr(agent, "_ingest_trigger", None)
        assert "error" in agent._refresh_feed(allowed=True)

    def test_status_reports_the_last_run(self, wired):
        assert agent._feed_status()["articles_saved_last_run"] == 42

    def test_dispatch_defaults_to_refusing(self, db, wired):
        """The default has to be the safe one; this is a public route."""
        started, _ = wired
        assert agent._dispatch(db, "refresh_feed", {})["permitted"] is False
        assert started == []

    def test_dispatch_allows_it_when_told_to(self, db, wired):
        started, _ = wired
        assert agent._dispatch(db, "refresh_feed", {}, can_admin=True)["started"] is True
        assert started == [15]


class TestRefreshEndpointAuthorisation:
    @pytest.fixture
    def wired(self, monkeypatch):
        started = []
        monkeypatch.setattr(agent, "_ingest_trigger", lambda size: started.append(size))
        monkeypatch.setattr(agent, "_ingest_reader",
                            lambda: {"running": False, "last_summary": {}})
        return started

    def _ask_to_refresh(self, client, monkeypatch, headers=None):
        replies = iter([
            _tool_call("refresh_feed", {}),
            _answer("A refresh has started; it takes a few minutes."),
        ])
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: next(replies))
        return client.post("/agent/ask", json={"question": "update the news"},
                           headers=headers or {})

    def test_without_the_key_the_feed_is_not_refreshed(
        self, client, configured, wired, monkeypatch
    ):
        monkeypatch.setattr(main, "ADMIN_API_KEY", "s3cret")
        response = self._ask_to_refresh(client, monkeypatch)
        assert response.status_code == 200
        assert wired == [], "an anonymous caller triggered ingestion"

    def test_with_the_key_it_is(self, client, configured, wired, monkeypatch):
        monkeypatch.setattr(main, "ADMIN_API_KEY", "s3cret")
        self._ask_to_refresh(client, monkeypatch, {"X-API-Key": "s3cret"})
        assert wired == [15]

    def test_a_wrong_key_is_not_enough(self, client, configured, wired, monkeypatch):
        monkeypatch.setattr(main, "ADMIN_API_KEY", "s3cret")
        self._ask_to_refresh(client, monkeypatch, {"X-API-Key": "guess"})
        assert wired == []

    def test_an_unconfigured_site_stays_open_as_it_documents(
        self, client, configured, wired, monkeypatch
    ):
        """Matches require_admin: no key set means open, and startup warns."""
        monkeypatch.setattr(main, "ADMIN_API_KEY", "")
        self._ask_to_refresh(client, monkeypatch)
        assert wired == [15]

    def test_is_admin_matches_require_admin(self, monkeypatch):
        monkeypatch.setattr(main, "ADMIN_API_KEY", "s3cret")
        assert main.is_admin("s3cret") is True
        assert main.is_admin("wrong") is False
        assert main.is_admin(None) is False
        assert main.is_admin("") is False


class TestAnswerCleaning:
    @pytest.mark.parametrize("raw,expected", [
        ("Toll rose to 281 【3†id=141】 per AP.", "Toll rose to 281 per AP."),
        ("Plain answer with no markers.", "Plain answer with no markers."),
        ("Normal [brackets] stay.", "Normal [brackets] stay."),
    ])
    def test_strips_model_citation_markers(self, raw, expected):
        """The interface lists sources itself; retrieval markers are noise."""
        assert agent._clean_answer(raw) == expected

    def test_empty_content_becomes_none(self):
        assert agent._clean_answer("") is None
        assert agent._clean_answer(None) is None


class TestTranscription:
    """Voice input. Only Safari and Firefox reach this — Chrome transcribes locally."""

    def test_without_a_key_it_refuses(self, db, monkeypatch):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        assert agent.transcribe(db, b"audio")["text"] is None

    def test_empty_audio_never_reaches_the_service(self, db, configured, monkeypatch):
        called = []
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: called.append(1))
        assert agent.transcribe(db, b"")["error"] == "No audio received."
        assert called == []

    def test_oversized_audio_is_rejected_before_upload(self, db, configured, monkeypatch):
        called = []
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: called.append(1))
        result = agent.transcribe(db, b"x" * (agent.MAX_AUDIO_BYTES + 1))
        assert "too long" in result["error"]
        assert called == [], "a huge upload must not be forwarded"

    def test_successful_transcription_returns_text(self, db, configured, monkeypatch):
        class _Ok:
            status_code = 200
            text = ""
            @staticmethod
            def json(): return {"text": "  What happened in Colombia?  "}
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Ok())

        assert agent.transcribe(db, b"audio")["text"] == "What happened in Colombia?"

    def test_silence_is_reported_not_answered(self, db, configured, monkeypatch):
        class _Empty:
            status_code = 200
            text = ""
            @staticmethod
            def json(): return {"text": "   "}
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Empty())

        result = agent.transcribe(db, b"audio")
        assert result["text"] is None and result["error"]

    def test_bad_key_says_so(self, db, configured, monkeypatch):
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Reply(status=401, text="nope"))
        assert "API key" in agent.transcribe(db, b"audio")["error"]

    def test_transcription_is_charged_to_the_daily_budget(self, db, configured, monkeypatch):
        """Otherwise the budget guards answering while voice drains the account."""
        class _Ok:
            status_code = 200
            text = ""
            @staticmethod
            def json(): return {"text": "hello"}
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Ok())

        agent.transcribe(db, b"audio")
        _, used = agent._budget_state(db)
        assert used == 1

    def test_endpoint_accepts_an_upload(self, client, configured, monkeypatch):
        class _Ok:
            status_code = 200
            text = ""
            @staticmethod
            def json(): return {"text": "spoken question"}
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _Ok())

        response = client.post("/agent/transcribe", files={"audio": ("s.webm", b"fake audio bytes")})
        assert response.status_code == 200
        assert response.json()["text"] == "spoken question"


class TestEndpoint:
    def test_returns_an_answer_shape(self, client, configured, archive, monkeypatch):
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _answer("Here is what happened."))
        response = client.post("/agent/ask", json={"question": "What happened?"})
        assert response.status_code == 200
        body = response.json()
        assert body["answer"] == "Here is what happened."
        assert body["error"] is None

    def test_status_reports_configuration(self, client, configured):
        body = client.get("/agent/status").json()
        assert body["available"] is True
        assert body["daily_budget"] > 0

    def test_history_is_accepted(self, client, configured, monkeypatch):
        monkeypatch.setattr(agent.requests, "post", lambda *a, **k: _answer("Follow-up answer."))
        response = client.post("/agent/ask", json={
            "question": "and Ukraine?",
            "history": [{"role": "user", "content": "Colombia?"},
                        {"role": "assistant", "content": "An earthquake."}],
        })
        assert response.status_code == 200
        assert response.json()["answer"] == "Follow-up answer."
