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

# llama-3.3-70b-versatile rejects these tool definitions with a 400
# ("Failed to call a function"), so the default is a model verified to handle
# them against this schema.
MODEL = os.getenv("AGENT_MODEL", "openai/gpt-oss-120b")
REQUEST_TIMEOUT = 45

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
]


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


def _search_news(db: Session, query: str, country: str = "", days: int = 14, limit: int = 8) -> dict:
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
    latest = _search_news(db, "", row.iso_code, days=14, limit=6)
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
    return {"events": summaries[:6]}


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


def _dispatch(db: Session, name: str, args: dict) -> dict:
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
    except Exception as e:                       # a broken tool must not break the answer
        logger.warning("[AGENT] tool %s failed: %s", name, e)
        return {"error": "That lookup failed."}
    return {"error": f"Unknown tool {name!r}."}


# ─────────────────────────────────────────────────────────
# LOOP
# ─────────────────────────────────────────────────────────
def ask(db: Session, question: str, history: list[dict] | None = None) -> dict:
    """
    Answer a question, using the archive.

    Returns {answer, sources, tools_used, error}. `sources` are the articles
    the tools actually returned, so the reader can check the answer rather
    than trust it.
    """
    key = api_key()
    if not key:
        return {"answer": None, "sources": [], "tools_used": [], "from_archive": False,
                "error": "The assistant is not configured on this server."}

    question = (question or "").strip()[:MAX_QUESTION_CHARS]
    if not question:
        return {"answer": None, "sources": [], "tools_used": [], "from_archive": False,
                "error": "Ask a question."}

    _, used = _budget_state(db)
    if used >= DAILY_BUDGET:
        return {"answer": None, "sources": [], "tools_used": [], "from_archive": False,
                "error": "The assistant has reached today's question limit. Try again tomorrow."}

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
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
                    "max_tokens": 900,
                },
                timeout=REQUEST_TIMEOUT,
            )
        except requests.RequestException as e:
            logger.warning("[AGENT] request failed: %s", e)
            return {"answer": None, "sources": sources, "tools_used": tools_used, "from_archive": bool(tools_used),
                    "error": "The assistant is unreachable right now."}

        if response.status_code == 429:
            return {"answer": None, "sources": sources, "tools_used": tools_used, "from_archive": bool(tools_used),
                    "error": "The assistant is busy. Try again in a moment."}
        if response.status_code != 200:
            logger.warning("[AGENT] %s: %s", response.status_code, response.text[:200])
            return {"answer": None, "sources": sources, "tools_used": tools_used, "from_archive": bool(tools_used),
                    "error": "The assistant could not answer that."}

        try:
            message = response.json()["choices"][0]["message"]
        except (ValueError, KeyError, IndexError):
            return {"answer": None, "sources": sources, "tools_used": tools_used, "from_archive": bool(tools_used),
                    "error": "The assistant returned something unreadable."}

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

            result = _dispatch(db, name, args)
            tools_used.append(name)
            for article in result.get("articles", []) or result.get("latest", []) or []:
                if article not in sources:
                    sources.append(article)

            messages.append({
                "role": "tool",
                "tool_call_id": call.get("id"),
                "name": name,
                "content": json.dumps(result)[:6000],
            })

    _record_request(db)
    return {"answer": None, "sources": sources[:12], "tools_used": tools_used, "from_archive": bool(tools_used),
            "error": "That took too many lookups to answer. Try asking something narrower."}
