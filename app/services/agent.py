"""
Question answering over the archive.

A chat box wired straight to a language model would answer news questions from
whatever the model remembers, which for current events is a training cutoff
and a confident guess. This one cannot do that: it is given tools that query
this site's own data, and the prompt tells it to use them and to say when it
is not.

That distinction is the whole point. The interesting thing here is not that a
model can talk — it is that the pipeline already knows which country a story
is about, which happening it belongs to, how widely it was carried and how
that country's risk has moved, and none of that was reachable by asking a
question until now.

Three constraints shape the implementation:

  * **It spends money and it is public.** Rate limited per caller and budgeted
    per UTC day in system_state, the same pattern as the YouTube and
    classifier allowances.
  * **It must not invent.** Every factual claim about current events comes
    from a tool result, and the articles behind an answer are returned
    alongside it so a reader can check.
  * **It must degrade.** No key, spent budget or an upstream failure returns a
    plain refusal, never a fabricated answer.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta

import requests
from sqlalchemy.orm import Session, joinedload

from .. import models
from . import alerts
from .events import extract_figures

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"

# Whisper turbo: accurate enough for a spoken question and fast enough that the
# round trip is not the slow part. Used only where the browser has no speech
# recognition of its own (Safari, Firefox); Chrome and Edge never reach here.
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "whisper-large-v3-turbo")
MAX_AUDIO_BYTES = 4_000_000

# llama-3.3-70b-versatile rejects these tool definitions with a 400
# ("Failed to call a function"), so the default is a model verified to handle
# them against this schema.
MODEL = os.getenv("AGENT_MODEL", "openai/gpt-oss-120b")
REQUEST_TIMEOUT = 45

# Groq's free tier allows 8,000 tokens a minute. A three-round exchange with
# generous tool payloads spent most of that on a single question, so one user
# could rate-limit the next. These bounds keep a full question near ~3k.
MAX_TOOL_ROUNDS = 3          # enough to search, then refine once
MAX_QUESTION_CHARS = 500
MAX_HISTORY_TURNS = 6

DAILY_BUDGET = max(0, int(os.getenv("AGENT_DAILY_BUDGET", "300")))
_BUDGET_KEY = "agent_request_budget"

# Per-caller throttle. In-process and therefore per-worker, which is the right
# shape for a single free-tier instance; a fleet would need shared state.
RATE_LIMIT_REQUESTS = max(1, int(os.getenv("AGENT_RATE_LIMIT", "8")))
RATE_LIMIT_WINDOW_SECONDS = 300
_recent_calls: dict[str, deque] = defaultdict(deque)

SYSTEM_PROMPT = """You are the research assistant for GeoIntel, a geopolitical \
news monitor. You answer from the site's own archive.

Rules:
- For anything about current or recent events, call a tool first. Never answer \
from memory about what is happening now.
- Cite what you used: refer to outlets by name and mention how many reports \
support a claim.
- If the tools return nothing relevant, say the archive has no coverage of it. \
Do not fill the gap with your own recollection of the news.
- You may answer historical or background questions from your own knowledge, \
but say plainly that you are doing so and that it is not from the archive.
- The archive holds roughly the last 30 days. Anything older is out of scope \
and you should say so.
- Be concise. Two or three short paragraphs at most. No preamble.
- Write plain prose. Never emit citation markers, footnote symbols or source ids — the interface shows the articles beside your answer.

You can also refresh the feed. When asked to update the site, fetch the latest \
news, or check for new stories, call refresh_feed.
- A refresh takes several minutes and runs in the background. Say it has \
started, never that it has finished, and never describe articles it might \
bring in. Offer that they can ask you how it is going.
- If refresh_feed reports it is not permitted, say plainly that refreshing is \
limited to the site owner. Do not retry it and do not suggest workarounds.
- Use feed_status when asked whether a refresh is done or how the last one went.
"""

# Appended for readers preparing for competitive examinations — in India, the
# civil services papers, where international relations is examined as "India
# and its neighbourhood", "groupings and agreements involving India" and the
# mandates of international institutions.
#
# It changes the shape of an answer, never its sourcing. The tools, the refusal
# to invent, and the articles shown beside the answer all still apply: a
# confidently wrong fact is worse for someone memorising it for an exam than
# for a reader who is merely browsing.
EXAM_PROMPT = """
The reader is preparing for a competitive examination and is studying this \
topic, not just following it. Answer accordingly:

- Structure the answer: what happened, why it matters, and what it bears on. \
Use short labelled lines rather than one block of prose.
- Give the facts that can be cited — dates, figures, the parties involved, the \
institutions or agreements named. Prefer specifics over adjectives.
- Where a development touches India's interests, say how, plainly and without \
overstating it. If it does not, do not invent a connection.
- Name the wider theme it belongs to (energy security, maritime trade, border \
management, multilateral reform) so it can be filed alongside related material.
- Where informed people disagree, give both readings rather than one.
- Still no more than three short paragraphs or eight lines. This is a study \
note, not an essay.
"""

# Models sometimes emit retrieval markers of their own ("【3†id=141】"), which
# are meaningless once the interface lists the sources itself.
_CITATION_NOISE = re.compile(r"[【\[]\s*\d+\s*[†:#][^】\]]*[】\]]|【[^】]*】")


def _clean_answer(text: str | None) -> str | None:
    if not text:
        return None
    cleaned = _CITATION_NOISE.sub("", text)
    cleaned = re.sub(r"[ 	]{2,}", " ", cleaned)
    return cleaned.strip() or None


# Why an answer is missing, as a machine-readable kind alongside the prose.
#
# The interface has to tell "come back in a minute" apart from "this server is
# broken" — they read identically as red boxes otherwise, and only one of them
# is worth the reader's attention. Matching on the message text would work
# until someone reworded it, so the distinction is carried explicitly.
#
#   config   — the operator has to fix something; no reader action will help
#   limit    — a budget is spent, and resets
#   busy     — momentary; asking again shortly works
#   upstream — the provider failed or was unreachable
#   input    — the question itself is the problem, and rephrasing it helps
def _failed(error: str, kind: str, sources=None, tools=None) -> dict:
    tools = tools or []
    return {
        "answer": None,
        "sources": sources or [],
        "tools_used": tools,
        "from_archive": bool(tools),
        "error": error,
        "error_kind": kind,
    }

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "search_news",
            "description": (
                "Search the archive's headlines and summaries. Use for any question "
                "about what happened, what is going on somewhere, or a named topic."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Keywords, e.g. 'earthquake' or 'sanctions'"},
                    "country": {"type": "string", "description": "Country name or ISO alpha-2 code"},
                    "days": {"type": "integer", "description": "How far back to look, 1-30"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "country_briefing",
            "description": (
                "Current risk standing and latest headlines for one country. Use when "
                "asked how a country is doing or how dangerous somewhere is."
            ),
            "parameters": {
                "type": "object",
                "properties": {"country": {"type": "string"}},
                "required": ["country"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "major_events",
            "description": (
                "The biggest happenings by how many outlets covered them, with any "
                "reported death tolls. Use for 'what is the big news' questions."
            ),
            "parameters": {
                "type": "object",
                "properties": {"hours": {"type": "integer", "description": "Window, default 168"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "escalating_countries",
            "description": (
                "Countries whose risk has moved most against their own recent baseline. "
                "Use for 'where is it getting worse' questions."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "refresh_feed",
            "description": (
                "Pull the latest news from the upstream providers into the site. Use "
                "when asked to update the site, refresh, or fetch the newest stories. "
                "Runs in the background and takes several minutes; it does not return "
                "articles. Restricted to the site owner."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "countries": {
                        "type": "integer",
                        "description": "How many countries to cover this cycle, 1-100. Default 15.",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "feed_status",
            "description": (
                "Whether a refresh is currently running, and how the last one went. "
                "Use to answer 'is it done yet' after a refresh was started."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

# ─────────────────────────────────────────────────────────
# ACTIONS
# ─────────────────────────────────────────────────────────
# Ingestion lives in main, which owns the lock that stops two cycles racing on
# the same feeds and the state the status endpoint reports. Importing it here
# would be circular, so main hands these over at import time and this module
# holds nothing but the handles.
_ingest_trigger = None
_ingest_reader = None


def set_ingest_handlers(trigger, reader) -> None:
    """Give the agent the means to start a refresh and to see how it is going."""
    global _ingest_trigger, _ingest_reader
    _ingest_trigger = trigger
    _ingest_reader = reader


def _feed_status() -> dict:
    if _ingest_reader is None:
        return {"error": "Feed status is unavailable on this server."}
    state = _ingest_reader()
    summary = state.get("last_summary") or {}
    return {
        "running": bool(state.get("running")),
        "started_at": str(state.get("started_at") or ""),
        "finished_at": str(state.get("finished_at") or ""),
        "articles_saved_last_run": summary.get("total_saved"),
        "last_error": state.get("last_error"),
    }


def _refresh_feed(allowed: bool, countries: int = 15) -> dict:
    """Start an ingest cycle, if the caller is entitled to spend on one.

    The check is here rather than only at the endpoint because this is reached
    through a public, unauthenticated route. A cycle makes dozens of upstream
    requests per country against metered provider allowances, so an open
    version of this would let anyone drain the site's GNews and NewsAPI quota
    by asking a chatbot to refresh in a loop.
    """
    if not allowed:
        return {
            "permitted": False,
            "error": "Refreshing the feed is restricted to the site owner.",
        }
    if _ingest_trigger is None:
        return {"error": "Refreshing is not available on this server."}

    state = _ingest_reader() if _ingest_reader else {}
    if state.get("running"):
        # Not an error: the caller asked for a refresh and one is happening.
        return {
            "started": False,
            "already_running": True,
            "message": "A refresh is already in progress.",
        }

    countries = max(1, min(100, int(countries or 15)))
    _ingest_trigger(countries)
    return {
        "started": True,
        "countries": countries,
        "message": (
            "A refresh has started in the background and takes a few minutes. "
            "It has not finished yet."
        ),
    }


# ─────────────────────────────────────────────────────────
# BUDGET AND THROTTLE
# ─────────────────────────────────────────────────────────
def api_key() -> str | None:
    return os.getenv("GROQ_API_KEY") or None


def is_available() -> bool:
    return bool(api_key())


def _budget_state(db: Session) -> tuple[str, int]:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    if not row or not row.value or ":" not in row.value:
        return today, 0
    day, _, used = row.value.partition(":")
    if day != today:
        return today, 0
    try:
        return today, int(used)
    except ValueError:
        return today, 0


def _record_request(db: Session) -> None:
    today, used = _budget_state(db)
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    value = f"{today}:{used + 1}"
    if row:
        row.value = value
    else:
        db.add(models.SystemState(key=_BUDGET_KEY, value=value))
    db.commit()


def rate_limited(caller: str) -> bool:
    """True when this caller has asked too often lately."""
    now = time.monotonic()
    calls = _recent_calls[caller]
    while calls and now - calls[0] > RATE_LIMIT_WINDOW_SECONDS:
        calls.popleft()
    if len(calls) >= RATE_LIMIT_REQUESTS:
        return True
    calls.append(now)
    return False


# ─────────────────────────────────────────────────────────
# TOOLS
# ─────────────────────────────────────────────────────────
def _article_brief(article) -> dict:
    return {
        "id": article.id,
        "title": article.title,
        "source": article.source.name if article.source else "Unknown",
        "country": article.country,
        "published": article.published_at.strftime("%Y-%m-%d %H:%M") if article.published_at else None,
        "risk": round(article.geo_risk_score, 1) if article.geo_risk_score is not None else None,
        "topic": article.event_type,
    }


def _search_news(db: Session, query: str, country: str = "", days: int = 14, limit: int = 5) -> dict:
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.is_duplicate.isnot(True))
    )
    term = (query or "").strip()
    if term:
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        pattern = f"%{escaped}%"
        rows = rows.filter(
            models.Article.title.ilike(pattern, escape="\\")
            | models.Article.description.ilike(pattern, escape="\\")
        )
    if country:
        code = country.strip()
        rows = rows.join(models.Article.country_rel).filter(
            (models.Country.iso_code == code.upper()) | (models.Country.name.ilike(code))
        )
    if days:
        rows = rows.filter(
            models.Article.published_at >= datetime.utcnow() - timedelta(days=min(max(days, 1), 30))
        )

    found = rows.order_by(models.Article.published_at.desc()).limit(limit).all()
    return {"count": len(found), "articles": [_article_brief(a) for a in found]}


def _country_briefing(db: Session, country: str) -> dict:
    code = (country or "").strip()
    row = (
        db.query(models.Country)
        .filter((models.Country.iso_code == code.upper()) | (models.Country.name.ilike(code)))
        .first()
    )
    if not row:
        return {"error": f"No country matching {country!r}."}

    standing = next(
        (r for r in alerts.compute_alert_status(db) if r["iso_code"] == row.iso_code), None
    )
    latest = _search_news(db, "", row.iso_code, days=14, limit=4)
    return {
        "country": row.name,
        "region": row.region,
        "risk_level": standing["alert_level"] if standing else 0,
        "status": standing["alert_status"] if standing else "unknown",
        "articles_held": standing["total_articles"] if standing else 0,
        "latest": latest["articles"],
    }


def _major_events(db: Session, hours: int = 168) -> dict:
    since = datetime.utcnow() - timedelta(hours=min(max(hours, 1), 24 * 30))
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.event_key.isnot(None), models.Article.published_at >= since)
        .all()
    )
    grouped: dict[str, list] = {}
    for article in rows:
        grouped.setdefault(article.event_key, []).append(article)

    summaries = []
    for key, articles in grouped.items():
        if len(articles) < 3:
            continue
        ordered = sorted(articles, key=lambda a: a.published_at or datetime.min)
        outlets = {a.source.name for a in ordered if a.source}
        figures: dict[str, int] = {}
        for article in ordered:
            for kind, value in extract_figures(article.title).items():
                figures[kind] = max(figures.get(kind, 0), value)
        summaries.append({
            "title": ordered[0].title,
            "reports": len(ordered),
            "outlets": len(outlets),
            "countries": sorted({a.country for a in ordered if a.country})[:4],
            "figures": figures,
            "first_reported": ordered[0].published_at.strftime("%Y-%m-%d"),
        })

    summaries.sort(key=lambda e: -e["reports"])
    return {"events": summaries[:4]}


def _escalating(db: Session) -> dict:
    board = alerts.compute_movers(db, hours=168, limit=5)
    trim = lambda rows: [
        {"country": m["country"], "from": m["baseline"], "to": m["current"], "sigma": m["z_score"]}
        for m in rows
    ]
    return {
        "rising": trim(board.get("rising", [])),
        "falling": trim(board.get("falling", [])),
        "note": "Movement is measured against each country's own recent baseline.",
    }


def _dispatch(db: Session, name: str, args: dict, can_admin: bool = False) -> dict:
    try:
        if name == "search_news":
            return _search_news(
                db, args.get("query", ""), args.get("country", ""), int(args.get("days") or 14)
            )
        if name == "country_briefing":
            return _country_briefing(db, args.get("country", ""))
        if name == "major_events":
            return _major_events(db, int(args.get("hours") or 168))
        if name == "escalating_countries":
            return _escalating(db)
        if name == "refresh_feed":
            return _refresh_feed(can_admin, args.get("countries") or 15)
        if name == "feed_status":
            return _feed_status()
    except Exception as e:                       # a broken tool must not break the answer
        logger.warning("[AGENT] tool %s failed: %s", name, e)
        return {"error": "That lookup failed."}
    return {"error": f"Unknown tool {name!r}."}


def transcribe(
    db: Session,
    audio: bytes,
    filename: str = "speech.webm",
    language: str = "en",
) -> dict:
    """
    Turn a spoken question into text.

    Charged against the same daily budget as answering: a caller who can spend
    transcription without limit can drain the account just as easily.

    `language` is an ISO-639-1 code, or "auto" to let Whisper detect it. Naming
    the language is worth doing where it is known — detection costs accuracy on
    short utterances, and a spoken question is nearly always short — but
    hard-coding English quietly made voice input English-only for the browsers
    that reach here at all.
    """
    key = api_key()
    if not key:
        return {"text": None, "error": "Voice input is not configured on this server.",
                "error_kind": "config"}
    if not audio:
        return {"text": None, "error": "No audio received.", "error_kind": "input"}
    if len(audio) > MAX_AUDIO_BYTES:
        return {"text": None, "error": "That recording is too long. Keep it under a minute.",
                "error_kind": "input"}

    _, used = _budget_state(db)
    if used >= DAILY_BUDGET:
        return {"text": None, "error": "The assistant has reached today's limit.",
                "error_kind": "limit"}

    form = {"model": TRANSCRIBE_MODEL, "response_format": "json"}
    code = (language or "").strip().lower()[:5]
    # Anything else is left off entirely, which is what asks Whisper to detect.
    if code and code != "auto":
        form["language"] = code

    try:
        response = requests.post(
            TRANSCRIBE_URL,
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (filename, audio, "application/octet-stream")},
            data=form,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.warning("[AGENT] transcription failed: %s", e)
        return {"text": None, "error": "Could not reach the transcription service.",
                "error_kind": "upstream"}

    if response.status_code in (401, 403):
        logger.error("[AGENT] transcription rejected the API key (%s).", response.status_code)
        return {"text": None, "error": "The assistant's API key is missing or invalid on this server.",
                "error_kind": "config"}
    if response.status_code != 200:
        logger.warning("[AGENT] transcription %s: %s", response.status_code, response.text[:160])
        return {"text": None, "error": "Could not transcribe that.", "error_kind": "upstream"}

    try:
        text = (response.json().get("text") or "").strip()
    except ValueError:
        return {"text": None, "error": "Could not transcribe that.", "error_kind": "upstream"}

    _record_request(db)
    return {
        "text": text or None,
        "error": None if text else "Nothing was picked up.",
        "error_kind": None if text else "input",
    }


# ─────────────────────────────────────────────────────────
# LOOP
# ─────────────────────────────────────────────────────────
def ask(
    db: Session,
    question: str,
    history: list[dict] | None = None,
    can_admin: bool = False,
    mode: str = "default",
) -> dict:
    """
    Answer a question, using the archive.

    Returns {answer, sources, tools_used, error}. `sources` are the articles
    the tools actually returned, so the reader can check the answer rather
    than trust it.

    `can_admin` decides whether the tools that spend money are allowed to do
    anything. It defaults to False because this is reached through a public
    route, and a default that has to be turned off is the wrong way round for
    something that drains a metered quota.
    """
    key = api_key()
    if not key:
        return _failed("The assistant is not configured on this server.", "config")

    question = (question or "").strip()[:MAX_QUESTION_CHARS]
    if not question:
        return _failed("Ask a question.", "input")

    _, used = _budget_state(db)
    if used >= DAILY_BUDGET:
        return _failed(
            "The assistant has reached today's question limit. Try again tomorrow.", "limit"
        )

    system = SYSTEM_PROMPT + (EXAM_PROMPT if mode == "exam" else "")
    messages = [{"role": "system", "content": system}]
    for turn in (history or [])[-MAX_HISTORY_TURNS:]:
        role = turn.get("role")
        content = (turn.get("content") or "")[:2000]
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    sources: list[dict] = []
    tools_used: list[str] = []

    for _round in range(MAX_TOOL_ROUNDS):
        try:
            response = requests.post(
                GROQ_URL,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
                json={
                    "model": MODEL,
                    "messages": messages,
                    "tools": TOOLS,
                    "tool_choice": "auto",
                    "temperature": 0.2,
                    "max_tokens": 600,
                },
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning("[AGENT] request failed: %s", e)
            return _failed("The assistant is unreachable right now.", "upstream",
                           sources, tools_used)

        if response.status_code == 429:
            return _failed("The assistant is busy right now. Try again in a moment.", "busy",
                           sources, tools_used)
        if response.status_code in (401, 403):
            # A misconfigured key is an operator problem and needs saying so —
            # reported as "could not answer that", it looks like the question
            # was at fault and nobody goes looking at the key.
            logger.error("[AGENT] upstream rejected the API key (%s). Check GROQ_API_KEY.",
                         response.status_code)
            return _failed("The assistant's API key is missing or invalid on this server.",
                           "config", sources, tools_used)
        if response.status_code != 200:
            logger.warning("[AGENT] %s: %s", response.status_code, response.text[:200])
            return _failed("The assistant could not answer that.", "upstream",
                           sources, tools_used)

        try:
            message = response.json()["choices"][0]["message"]
        except (ValueError, KeyError, IndexError):
            return _failed("The assistant returned something unreadable.", "upstream",
                           sources, tools_used)

        calls = message.get("tool_calls") or []
        if not calls:
            _record_request(db)
            return {
                "answer": _clean_answer(message.get("content")),
                "sources": sources[:12],
                "tools_used": tools_used,
                # Determined by whether a tool actually ran, not by asking the
                # model to admit it. The prompt instructs it to flag answers
                # drawn from its own knowledge and it reliably does not, so the
                # distinction a reader needs is derived here instead.
                "from_archive": bool(tools_used),
                "error": None,
                "error_kind": None,
            }

        # Echo the assistant turn back before the results, as the API requires.
        messages.append({
            "role": "assistant",
            "content": message.get("content") or "",
            "tool_calls": calls,
        })

        for call in calls:
            name = call.get("function", {}).get("name", "")
            try:
                args = json.loads(call.get("function", {}).get("arguments") or "{}")
            except ValueError:
                args = {}

            result = _dispatch(db, name, args, can_admin=can_admin)
            tools_used.append(name)
            for article in result.get("articles", []) or result.get("latest", []) or []:
                if article not in sources:
                    sources.append(article)

            messages.append({
                "role": "tool",
                "tool_call_id": call.get("id"),
                "name": name,
                "content": json.dumps(result)[:2500],
            })

    _record_request(db)
    return _failed(
        "That took too many lookups to answer. Try asking something narrower.",
        "input", sources[:12], tools_used,
    )
