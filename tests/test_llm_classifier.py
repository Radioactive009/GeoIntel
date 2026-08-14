"""
LLM adjudication.

The network is never touched: every test stubs the HTTP call. What matters
here is not that the model is clever but that the layer is *safe* — an
unreachable, rate-limited, over-budget or incoherent classifier must never
degrade ingestion, and must never produce a category the rest of the system
does not understand.
"""

import json

import pytest
import requests

from app.services import llm_classifier as llm
from app.services.classifier import CATEGORIES, NOISE


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setenv("GROQ_API_KEY", "test-key")
    monkeypatch.setattr(llm, "MODE", "all")
    monkeypatch.setattr(llm, "DAILY_REQUEST_BUDGET", 50)


class _Response:
    def __init__(self, status=200, payload=None, text=""):
        self.status_code = status
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("no json")
        return self._payload


def _reply(mapping):
    """Build a Groq-shaped envelope carrying id -> category."""
    body = json.dumps({"results": [{"id": i, "category": c} for i, c in mapping.items()]})
    return _Response(payload={"choices": [{"message": {"content": body}}]})


ARTICLES = [
    ("15 Beirut cats rescued from Lebanon's war find refuge in NJ", None),
    ("Russian shelling kills nine in Kharkiv", None),
]


class TestFallbackSafety:
    def test_no_api_key_uses_keyword_results(self, monkeypatch, db):
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        results = llm.classify_batch(db, ARTICLES)
        assert len(results) == len(ARTICLES)
        assert all(r.reason != "llm" for r in results)

    def test_network_failure_falls_back(self, enabled, db, monkeypatch):
        def boom(*args, **kwargs):
            raise requests.ConnectionError("unreachable")
        monkeypatch.setattr(llm.requests, "post", boom)

        results = llm.classify_batch(db, ARTICLES)
        assert len(results) == len(ARTICLES)
        assert all(r.reason != "llm" for r in results)

    def test_rate_limit_falls_back(self, enabled, db, monkeypatch):
        monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _Response(status=429, text="slow down"))
        assert all(r.reason != "llm" for r in llm.classify_batch(db, ARTICLES))

    def test_malformed_json_falls_back(self, enabled, db, monkeypatch):
        monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _Response(
            payload={"choices": [{"message": {"content": "sorry, I cannot help"}}]}))
        assert all(r.reason != "llm" for r in llm.classify_batch(db, ARTICLES))

    def test_invented_category_is_rejected(self, enabled, db, monkeypatch):
        """A hallucinated label must not reach the database."""
        monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _reply({0: "sportsball", 1: "conflict"}))
        results = llm.classify_batch(db, ARTICLES)
        assert results[0].reason != "llm", "unknown label should be discarded"
        assert results[1].category == "conflict"
        assert all(r.category in set(CATEGORIES) | {NOISE} for r in results)

    def test_partial_response_keeps_the_rest(self, enabled, db, monkeypatch):
        monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _reply({1: "conflict"}))
        results = llm.classify_batch(db, ARTICLES)
        assert results[1].reason == "llm"
        assert results[0].reason != "llm"


class TestCorrection:
    def test_llm_overrides_a_keyword_mistake(self, enabled, db, monkeypatch):
        """
        The case the layer exists for: real conflict vocabulary in a story
        that is not about conflict.
        """
        monkeypatch.setattr(llm.requests, "post", lambda *a, **k: _reply({0: NOISE, 1: "conflict"}))
        results = llm.classify_batch(db, ARTICLES)
        assert results[0].category == NOISE
        assert results[0].is_relevant is False
        assert results[1].category == "conflict"


class TestBudget:
    def test_requests_are_batched(self, enabled, db, monkeypatch):
        calls = []
        monkeypatch.setattr(llm, "BATCH_SIZE", 20)
        monkeypatch.setattr(llm.requests, "post",
                            lambda *a, **k: calls.append(1) or _reply({}))

        llm.classify_batch(db, ARTICLES * 10)   # 20 articles
        assert len(calls) == 1, "20 articles should cost one request, not twenty"

    def test_budget_is_recorded_and_enforced(self, enabled, db, monkeypatch):
        monkeypatch.setattr(llm, "DAILY_REQUEST_BUDGET", 1)
        monkeypatch.setattr(llm, "BATCH_SIZE", 1)
        calls = []
        monkeypatch.setattr(llm.requests, "post",
                            lambda *a, **k: calls.append(1) or _reply({}))

        llm.classify_batch(db, ARTICLES)
        assert len(calls) == 1, "the second batch must be refused by the budget"

        calls.clear()
        llm.classify_batch(db, ARTICLES)
        assert calls == [], "budget already spent for the day"

    def test_review_mode_only_sends_uncertain_stories(self, enabled, db, monkeypatch):
        monkeypatch.setattr(llm, "MODE", "review")
        sent = []

        def capture(*args, **kwargs):
            sent.append(kwargs["json"]["messages"][1]["content"])
            return _reply({})
        monkeypatch.setattr(llm.requests, "post", capture)

        # An unambiguous conflict story plus something the keywords cannot place.
        llm.classify_batch(db, [
            ("Russian shelling kills nine in Kharkiv as artillery hits the front line", None),
            ("Fear game", None),
        ])
        if sent:
            assert "Kharkiv" not in sent[0], "a confident result should not be re-asked"


class TestParsing:
    @pytest.mark.parametrize("content", [
        '{"results":[{"id":0,"category":"conflict"}]}',
        'Here you go:\n```json\n{"results":[{"id":0,"category":"conflict"}]}\n```',
        '  {"results": [{"id": "0", "category": "CONFLICT"}]}  ',
    ])
    def test_tolerates_wrapped_and_untidy_json(self, content):
        assert llm._parse(content) == {0: "conflict"}

    @pytest.mark.parametrize("content", ["", "no json here", "{broken", None])
    def test_unreadable_content_yields_nothing(self, content):
        assert llm._parse(content) == {}
