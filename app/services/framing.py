"""
Event analytics: how outlets framed a happening, and how attention moved.

Both were impossible before articles were grouped into events. With one report
per group there is nothing to compare and no curve to draw; with 76 reports
from 31 outlets about one earthquake, there is.

Two questions are answered here.

**Who framed it how.** Outlets score the same event very differently — on a
Syrian court sentencing, BBC's coverage scored 88 while Al Jazeera's scored 30.
Some of that gap is editorial stance and some is noise, and the distinction
matters enough to be built into the measurement rather than left to the reader.

**How long anyone cared.** A Colombian earthquake drew 64% of its coverage in
the first half of four days; strikes on Ukraine drew 3% in the first half of
nine. Burst and slow-burn are different shapes, and the difference is the
quantitative form of "forgotten crisis".
"""

from __future__ import annotations

import statistics
from collections import defaultdict
from datetime import datetime, timedelta

# An outlet needs more than one report before its average means anything, and
# an event needs several outlets before there is a consensus to diverge from.
MIN_OUTLETS_FOR_CONSENSUS = 3

# Below this a difference is not worth showing as a framing signal.
NOTABLE_DIVERGENCE = 8.0


def outlet_framing(articles: list) -> dict:
    """
    How each outlet scored an event, against the consensus of all of them.

    Compared by outlet *mean*, not by article. Scoring varies between an
    outlet's own headlines — one Liberian paper scored its four reports on a
    single story 95.6, 94.4, 93.0 and 87.8 — so comparing individual articles
    measures headline wording as much as editorial stance, and an outlet that
    filed four times would swamp one that filed once.

    ``spread`` is reported alongside each outlet for exactly that reason: a
    large divergence from an outlet whose own reports vary just as much is
    noise, and the number to distrust is visible rather than hidden.
    """
    scores: dict[str, list[float]] = defaultdict(list)
    for article in articles:
        name = getattr(getattr(article, "source", None), "name", None)
        score = getattr(article, "geo_risk_score", None)
        if name and score is not None:
            scores[name].append(float(score))

    if len(scores) < MIN_OUTLETS_FOR_CONSENSUS:
        return {"available": False, "reason": "too few outlets", "outlets": []}

    means = {name: statistics.fmean(values) for name, values in scores.items()}
    # Mean of outlet means, so prolific outlets do not define the consensus
    # they are then measured against.
    consensus = statistics.fmean(means.values())

    outlets = [
        {
            "source": name,
            "score": round(means[name], 1),
            "divergence": round(means[name] - consensus, 1),
            "reports": len(values),
            # An outlet's own variance: high means its headlines disagree with
            # each other, so read its divergence with suspicion.
            "spread": round(statistics.pstdev(values), 1) if len(values) > 1 else 0.0,
        }
        for name, values in scores.items()
    ]
    outlets.sort(key=lambda o: -o["score"])

    divergences = [o["divergence"] for o in outlets]
    return {
        "available": True,
        "consensus": round(consensus, 1),
        "spread": round(statistics.pstdev(list(means.values())), 1),
        "contested": max(divergences) - min(divergences) >= NOTABLE_DIVERGENCE,
        "highest": outlets[0],
        "lowest": outlets[-1],
        "outlets": outlets,
    }


def coverage_curve(articles: list, buckets: int = 24) -> dict:
    """
    When coverage arrived, and how quickly it stopped.

    ``half_life_hours`` is the point at which half of everything ever written
    about the event had been written — the honest measure of how long it held
    attention, and much more informative than the raw span, which one late
    follow-up can stretch by days.
    """
    stamps = sorted(
        article.published_at for article in articles
        if getattr(article, "published_at", None)
    )
    if len(stamps) < 2:
        return {"available": False, "points": [], "shape": "single report"}

    start, end = stamps[0], stamps[-1]
    span_hours = max((end - start).total_seconds() / 3600, 0.5)
    width = span_hours / buckets

    counts = [0] * buckets
    for stamp in stamps:
        offset = (stamp - start).total_seconds() / 3600
        index = min(buckets - 1, int(offset / width)) if width else 0
        counts[index] += 1

    # Time by which half the coverage had landed.
    half, running, half_life = len(stamps) / 2, 0, span_hours
    for stamp in stamps:
        running += 1
        if running >= half:
            half_life = (stamp - start).total_seconds() / 3600
            break

    peak_index = counts.index(max(counts))
    front_loaded = sum(counts[: max(1, buckets // 4)]) / len(stamps)

    if front_loaded >= 0.5:
        shape = "burst"          # broke hard, faded fast
    elif half_life > span_hours * 0.6:
        shape = "slow burn"      # built over time
    else:
        shape = "sustained"

    return {
        "available": True,
        "points": [
            {"hour": round(i * width, 1), "count": count}
            for i, count in enumerate(counts)
        ],
        "span_hours": round(span_hours, 1),
        "half_life_hours": round(half_life, 1),
        "peak_hour": round(peak_index * width, 1),
        "shape": shape,
        "first_seen": start,
        "last_seen": end,
    }


# Ranking needs enough outlets for a spread to mean anything. Below this an
# event is two or three opinions, not a disagreement.
MIN_OUTLETS_TO_RANK = 5


def contested_events(grouped: dict[str, list], limit: int = 12) -> list[dict]:
    """
    Events outlets disagreed about, ranked by the spread across *all* of them.

    Not by the gap between the highest and lowest outlet, which was tried and
    ranked almost entirely on noise. Extremes are the least stable statistic
    available: on this corpus every top result was two outlets with one report
    each, and the lowest was repeatedly exactly 25.0 — the risk engine's
    baseline for a headline containing no scoring keywords. That ranks "one
    outlet wrote a soft headline" as the most contested story of the week.

    The standard deviation of outlet means uses every outlet, so one unusual
    headline moves it a little instead of deciding it. The extremes are still
    reported, because "BBC 88, Al Jazeera 30" is what a reader can actually
    check — they are illustration, not evidence, and each carries the report
    count backing it so a single-article claim is visible as one.
    """
    results = []
    for key, articles in grouped.items():
        framing = outlet_framing(articles)
        if not framing.get("available") or not framing.get("contested"):
            continue
        if len(framing["outlets"]) < MIN_OUTLETS_TO_RANK:
            continue

        ordered = sorted(articles, key=lambda a: a.published_at or datetime.min)
        results.append({
            "event_key": key,
            "title": ordered[0].title or "Untitled",
            "article_count": len(articles),
            "outlet_count": len(framing["outlets"]),
            "consensus": framing["consensus"],
            # Spread across all outlets — what the ranking is on.
            "spread": framing["spread"],
            "gap": round(framing["highest"]["divergence"] - framing["lowest"]["divergence"], 1),
            "highest": framing["highest"],
            "lowest": framing["lowest"],
            "first_seen": ordered[0].published_at,
        })

    results.sort(key=lambda r: -r["spread"])
    return results[:limit]
