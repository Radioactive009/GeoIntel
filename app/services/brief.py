"""
The daily brief.

Every other page here answers a question the reader already had: what is
happening in this country, how did outlets differ, which stories are biggest.
None of them answers the question someone opening a news site actually starts
with, which is "what should I know". This composes that.

Two decisions worth stating.

It is written by rules, not by a model. A brief is the one thing on the site
that speaks in the site's own voice rather than quoting an outlet, and an
invented figure in it would be indistinguishable from a real one. Everything
below is assembled from counts the pipeline already computed, so it cannot
say anything the archive does not contain — and it costs nothing, needs no
key, and reads identically on every request.

It reports its own thinness. An archive holding four articles produces a
brief that says so, rather than a confident sentence about the day's dominant
story built on one report. Coverage is the first thing stated for that
reason.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.orm import Session, joinedload

from .. import models
from . import alerts, framing
from .events import extract_figures

# Below this an event is one outlet repeating itself, which is not a story
# the brief should lead on.
MIN_REPORTS_TO_FEATURE = 3

# A brief that lists twenty things is a feed, not a brief.
MAX_EVENTS = 5
MAX_MOVERS = 4
MAX_CONTESTED = 3

# Fewer articles than this and the window is too thin to characterise; the
# brief says so instead of describing a "dominant story" that is one report.
THIN_ARCHIVE = 12


def _events_in(db: Session, since: datetime) -> dict[str, list]:
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(
            models.Article.event_key.isnot(None),
            models.Article.published_at >= since,
            models.Article.is_duplicate.is_(False),
        )
        .all()
    )
    grouped: dict[str, list] = {}
    for article in rows:
        grouped.setdefault(article.event_key, []).append(article)
    return grouped


def _summarise(key: str, articles: list) -> dict:
    ordered = sorted(articles, key=lambda a: a.published_at or datetime.min)
    outlets = sorted({a.source.name for a in ordered if a.source})

    # The highest figure seen for each kind, not the newest: tolls are revised
    # upward as an event develops and the last headline is often not the
    # fullest one.
    figures: dict[str, int] = {}
    for article in ordered:
        for kind, value in extract_figures(article.title).items():
            figures[kind] = max(figures.get(kind, 0), value)

    scored = [a.geo_risk_score for a in ordered if a.geo_risk_score is not None]
    return {
        "event_key": key,
        "title": ordered[0].title,
        "reports": len(ordered),
        "outlets": len(outlets),
        "outlet_names": outlets[:4],
        "countries": sorted({a.country_rel.name for a in ordered if a.country_rel})[:3],
        "topic": ordered[0].event_type,
        "risk": round(sum(scored) / len(scored), 1) if scored else 0.0,
        "figures": figures,
        "image_url": next((a.image_url for a in ordered if a.image_url), None),
    }


def _coverage(db: Session, since: datetime) -> dict:
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(
            models.Article.published_at >= since,
            models.Article.is_duplicate.is_(False),
        )
        .all()
    )
    tone: dict[str, int] = {"uplifting": 0, "serious": 0, "neutral": 0}
    for article in rows:
        label = article.tone or "neutral"
        tone[label] = tone.get(label, 0) + 1

    return {
        "articles": len(rows),
        "outlets": len({a.source.name for a in rows if a.source}),
        "countries": len({a.country_rel.iso_code for a in rows if a.country_rel}),
        "tone": tone,
    }


# Naively appending "s" produced "148 countrys" in the lead sentence, which
# undoes the whole point of a page that speaks in the site's own voice.
_IRREGULAR = {"country": "countries", "story": "stories", "analysis": "analyses"}


def _plural(count: int, word: str) -> str:
    if count == 1:
        return f"{count} {word}"
    return f"{count} {_IRREGULAR.get(word, word + 's')}"


def _compose(coverage: dict, events: list[dict], movers: list[dict], hours: int) -> str:
    """The brief in prose, assembled only from figures already counted."""
    span = "the last 24 hours" if hours == 24 else f"the last {_plural(hours, 'hour')}"

    if not coverage["articles"]:
        return f"Nothing was collected in {span}."

    lines = [
        f"In {span} the archive collected {_plural(coverage['articles'], 'report')} "
        f"from {_plural(coverage['outlets'], 'outlet')} across "
        f"{_plural(coverage['countries'], 'country')}."
    ]

    if coverage["articles"] < THIN_ARCHIVE:
        lines.append(
            "That is too little to characterise the period, so what follows is "
            "what arrived rather than what mattered most."
        )
    elif events:
        lead = events[0]
        where = f" in {lead['countries'][0]}" if lead["countries"] else ""
        lines.append(
            f"The most widely carried story{where} was “{lead['title']}”, "
            f"reported by {_plural(lead['outlets'], 'outlet')}."
        )
        deaths = lead["figures"].get("deaths")
        if deaths:
            lines.append(
                f"The highest figure reported in its coverage was {deaths} dead."
            )

    if movers:
        rise = movers[0]
        lines.append(
            f"Risk rose most sharply in {rise['country']}, "
            f"{rise['sigma']} standard deviations above its own recent baseline."
        )

    total_toned = sum(coverage["tone"].values())
    if total_toned >= THIN_ARCHIVE:
        serious = coverage["tone"].get("serious", 0)
        uplifting = coverage["tone"].get("uplifting", 0)
        share = round(100 * serious / total_toned)
        if share >= 55:
            lines.append(f"Coverage was predominantly grim: {share}% of it read as serious.")
        elif uplifting > serious:
            lines.append(
                f"Unusually, more of it read as positive than negative "
                f"({uplifting} against {serious})."
            )

    return " ".join(lines)


def build_brief(db: Session, hours: int = 24, depth: int | None = None) -> dict:
    """
    Everything the brief page needs, in one pass over the window.

    `depth` overrides how many events are featured. The front page wants the
    day's handful; a month-long compilation read for revision wants everything
    that met the bar, because the point there is coverage rather than triage.
    """
    hours = max(1, min(int(hours or 24), 24 * 31))
    since = datetime.utcnow() - timedelta(hours=hours)

    grouped = _events_in(db, since)
    events = [
        _summarise(key, rows)
        for key, rows in grouped.items()
        if len(rows) >= MIN_REPORTS_TO_FEATURE
    ]
    # By reach first, then severity: a story ten outlets carried is the day's
    # story even if a nastier one was reported once.
    events.sort(key=lambda e: (-e["outlets"], -e["reports"], -e["risk"]))
    events = events[:max(1, int(depth))] if depth else events[:MAX_EVENTS]

    board = alerts.compute_movers(db, hours=max(hours, 168), limit=MAX_MOVERS)
    movers = [
        {
            "country": row["country"],
            "iso_code": row.get("iso_code"),
            "baseline": row["baseline"],
            "current": row["current"],
            "sigma": row["z_score"],
        }
        for row in board.get("rising", [])[:MAX_MOVERS]
    ]

    disputed = [
        {
            "event_key": row["event_key"],
            "title": row["title"],
            "outlets": row["outlet_count"],
            "spread": row["spread"],
            "consensus": row["consensus"],
        }
        for row in framing.contested_events(grouped, limit=MAX_CONTESTED)
    ]

    coverage = _coverage(db, since)

    return {
        "generated_at": datetime.utcnow(),
        "window_hours": hours,
        "summary": _compose(coverage, events, movers, hours),
        "coverage": coverage,
        "events": events,
        "escalating": movers,
        "contested": disputed,
    }
