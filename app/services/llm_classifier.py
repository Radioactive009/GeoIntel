"""
Optional LLM adjudication of story topics, via Groq.

The keyword classifier reaches 87% against a hand-labelled sample. What it
cannot do is read meaning, and the errors it has left all turn on meaning
rather than vocabulary:

    "15 Beirut cats rescued from Lebanon's war find refuge in NJ"  -> conflict
    "Caspian tiger declared extinct due to hunting by the military" -> conflict
    "Cameroon's Biya reshuffles military leadership"                -> conflict

Every one contains genuine conflict vocabulary and none is a conflict story.
No amount of additional keywords fixes that class of error, so this layer
exists — and equally, it is why the keyword classifier stays: it is free,
instant, deterministic, and handles the large majority correctly.

Design constraints, all of which come from this running on a free tier:

  * Batched. One request carries many headlines, so the cost scales with
    cycles rather than articles.
  * Budgeted per UTC day, persisted in system_state, following the same
    pattern as the YouTube search allowance.
  * Never load-bearing. No key, exhausted budget, network failure, malformed
    JSON or an unrecognised label all fall back to the keyword result. A
    classifier outage must never stop ingestion.
"""

from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime

import requests
from sqlalchemy.orm import Session

from .. import models
from .classifier import CATEGORIES, NOISE, Classification, classify

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Small, fast and free-tier friendly. Topic labelling does not need a large
# model, and a smaller one keeps the ingest cycle quick.
DEFAULT_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")
REQUEST_TIMEOUT = 30

BATCH_SIZE = max(1, int(os.getenv("LLM_BATCH_SIZE", "20")))
DAILY_REQUEST_BUDGET = max(0, int(os.getenv("LLM_DAILY_BUDGET", "400")))
_BUDGET_KEY = "llm_classify_budget"

# off    — never call out; keyword classifier only
# review — only stories the keyword classifier was unsure about (cheapest)
# all    — every story, which is the most accurate
MODE = os.getenv("LLM_CLASSIFY", "review").strip().lower()

VALID = set(CATEGORIES) | {NOISE}

SYSTEM_PROMPT = (
    "You label geopolitical news headlines by topic. Reply with JSON only.\n\n"
    "Categories:\n"
    "- conflict: armed violence between states or organised forces — strikes, "
    "shelling, invasions, battles, military casualties.\n"
    "- security: terrorism, insurgency, organised crime, trafficking, "
    "kidnapping, cyberattacks, espionage, policing of these.\n"
    "- diplomacy: talks, negotiations, treaties, summits, mediation, embassies.\n"
    "- economy: trade, tariffs, sanctions, markets, energy prices, inflation, "
    "central banks, national finances.\n"
    "- politics: elections, governments, parliaments, courts, appointments, "
    "protests, domestic political disputes.\n"
    "- disaster: natural or industrial catastrophe — earthquakes, floods, "
    "wildfires, storms, dam failures.\n"
    "- humanitarian: famine, displacement, refugees, epidemics, aid operations.\n"
    "- other: not geopolitical news. Sport, entertainment, celebrity, business "
    "deals with no state involvement, consumer stories, local human interest.\n\n"
    "Judge what the story is ABOUT, not which words it contains. "
    "'15 cats rescued from Lebanon's war' is other, not conflict. "
    "'Bidding war for a media company' is other, not conflict. "
    "'Army leads earthquake rescues' is disaster, not conflict. "
    "'Minister reshuffles military leadership' is politics, not conflict.\n\n"
    'Respond as {"results":[{"id":<int>,"category":"<category>"}]} '
    "with one entry per input id, and nothing else."
)


# ─────────────────────────────────────────────────────────
# BUDGET
# ─────────────────────────────────────────────────────────
def _budget_state(db: Session) -> tuple[str, int]:
    today = datetime.utcnow().strftime("%Y-%m-%d")
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    if not row or not row.value or ":" not in row.value:
        return today, 0
    day, _, used = row.value.partition(":")
    if day != today:
        return today, 0            # a new UTC day resets the allowance
    try:
        return today, int(used)
    except ValueError:
        return today, 0


def _record_requests(db: Session, count: int) -> None:
    if count <= 0:
        return
    today, used = _budget_state(db)
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    value = f"{today}:{used + count}"
    if row:
        row.value = value
    else:
        db.add(models.SystemState(key=_BUDGET_KEY, value=value))
    db.commit()


def api_key() -> str | None:
    return os.getenv("GROQ_API_KEY") or None


def is_enabled() -> bool:
    return MODE in ("review", "all") and bool(api_key())


# ─────────────────────────────────────────────────────────
# CALL
# ─────────────────────────────────────────────────────────
def _parse(content: str) -> dict[int, str]:
    """
    Pull id/category pairs out of the reply.

    Tolerant by design: models wrap JSON in prose or fences often enough that
    insisting on a clean body would discard usable answers. Anything that
    still cannot be read returns empty, and the caller keeps its fallback.
    """
    if not content:
        return {}
    match = re.search(r"\{.*\}", content, re.S)
    if not match:
        return {}
    try:
        payload = json.loads(match.group(0))
    except (ValueError, TypeError):
        return {}

    results = {}
    for row in payload.get("results") or []:
        try:
            index = int(row["id"])
        except (KeyError, TypeError, ValueError):
            continue
        category = str(row.get("category", "")).strip().lower()
        if category in VALID:       # an invented label is not usable
            results[index] = category
    return results


def _call_groq(headlines: list[str], key: str) -> dict[int, str]:
    numbered = "\n".join(f"{i}. {h[:240]}" for i, h in enumerate(headlines))
    try:
        response = requests.post(
            GROQ_URL,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={
                "model": DEFAULT_MODEL,
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": numbered},
                ],
                "temperature": 0,               # labelling should be repeatable
                "response_format": {"type": "json_object"},
                "max_tokens": 60 + 20 * len(headlines),
            },
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.warning("  [LLM] request failed: %s", e)
        return {}

    if response.status_code == 429:
        logger.warning("  [LLM] rate limited — falling back to keywords for this batch")
        return {}
    if response.status_code != 200:
        logger.warning("  [LLM] %s: %s", response.status_code, response.text[:160])
        return {}

    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError):
        logger.warning("  [LLM] unreadable response envelope")
        return {}
    return _parse(content)


# ─────────────────────────────────────────────────────────
# PUBLIC
# ─────────────────────────────────────────────────────────
def classify_batch(
    db: Session,
    articles: list[tuple[str | None, str | None]],
) -> list[Classification]:
    """
    Classify (title, description) pairs, using the LLM where it is worth it.

    Always returns one Classification per input, in order. The keyword result
    is computed first and stands as the answer unless the LLM supplies a
    usable label for that item, so every failure path degrades quietly.
    """
    baseline = [classify(title, description) for title, description in articles]

    if not articles or not is_enabled():
        return baseline

    if MODE == "review":
        candidates = [i for i, result in enumerate(baseline) if result.needs_review]
    else:
        candidates = list(range(len(articles)))
    if not candidates:
        return baseline

    _, used_today = _budget_state(db)
    remaining = DAILY_REQUEST_BUDGET - used_today
    if remaining <= 0:
        logger.info("  [LLM] daily budget spent — keyword results stand")
        return baseline

    key = api_key()
    spent = 0
    for start in range(0, len(candidates), BATCH_SIZE):
        if spent >= remaining:
            logger.info("  [LLM] budget reached mid-cycle; %s items keep keyword labels",
                        len(candidates) - start)
            break

        chunk = candidates[start:start + BATCH_SIZE]
        headlines = [
            f"{articles[i][0] or ''} — {(articles[i][1] or '')[:160]}".strip(" —")
            for i in chunk
        ]
        verdicts = _call_groq(headlines, key)
        spent += 1

        for position, article_index in enumerate(chunk):
            category = verdicts.get(position)
            if not category:
                continue                       # keep the keyword answer
            previous = baseline[article_index]
            baseline[article_index] = Classification(
                category=category,
                # The model does not report calibrated uncertainty, so this
                # records "an LLM decided it" rather than pretending to a
                # probability. Kept below 1.0 because it can still be wrong.
                confidence=0.9,
                scores=previous.scores,
                is_relevant=category != NOISE,
                reason="llm",
            )

    _record_requests(db, spent)
    if spent:
        logger.info("  [LLM] %s request(s) for %s stories (%s/%s today)",
                    spent, len(candidates), used_today + spent, DAILY_REQUEST_BUDGET)
    return baseline
