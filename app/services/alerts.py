"""
Alert scoring, risk history and escalation detection.

Every metric in the dashboard used to be a snapshot of "right now", computed
over whatever happened to be inside the retention window. Nothing was ever
recorded, so the system could not answer the question a monitoring product
exists to answer: *what changed?*

This module owns three things:

  * ``compute_alert_status``  — the per-country alert level (moved out of
    main.py so the scheduler can call it without importing the app).
  * ``capture_snapshot``      — writes one hourly row per active country.
  * ``compute_movers``        — z-scored escalation against each country's own
    recent baseline, so a noisy low-volume country cannot dominate the board.
"""

from __future__ import annotations

import logging
import os
import statistics
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from .. import models

logger = logging.getLogger(__name__)

HIGH_RISK_THRESHOLD = 70
MEDIUM_RISK_THRESHOLD = 40

# Pseudo-count for the alert average. A country with a single alarming article
# would otherwise top the global ranking on a sample of one; each country's
# mean is pulled toward the global mean until it has enough reports to stand
# on its own. Higher = more conservative.
ALERT_CONFIDENCE_WEIGHT = max(0.0, float(os.getenv("ALERT_CONFIDENCE_WEIGHT", "5")))

# History is bucketed by hour: an ingest cycle runs every 30 minutes, and one
# row per country per hour keeps the table small enough for SQLite while still
# populating a usable trend within a day.
TREND_RETENTION_DAYS = max(1, int(os.getenv("TREND_RETENTION_DAYS", "30")))

# Escalation needs a baseline to compare against.
MIN_BASELINE_POINTS = 3
# Floor on the baseline spread, so a perfectly flat country doesn't produce a
# divide-by-zero style infinite z-score on its first wobble.
MIN_BASELINE_STDEV = 3.0


# ─────────────────────────────────────────────────────────
# ALERT LEVELS
# ─────────────────────────────────────────────────────────
def risk_level(score: float) -> str:
    if score >= HIGH_RISK_THRESHOLD:
        return "high"
    if score >= MEDIUM_RISK_THRESHOLD:
        return "medium"
    return "low"


def compute_alert_status(db: Session) -> list[dict]:
    """
    Weighted geopolitical alert level per country.

    Computed by the database in a single aggregate query; this used to load
    every article into Python on each request.
    """
    risk_expr = func.coalesce(
        models.Article.geo_risk_score,
        func.abs(func.coalesce(models.Article.sentiment_score, 0.0)) * 100,
    )
    high_expr = case((models.Article.geo_risk_level == "high", 1), else_=0)

    rows = (
        db.query(
            models.Country.id,
            models.Country.name,
            models.Country.iso_code,
            models.Country.region,
            func.count(models.Article.id).label("total"),
            func.avg(risk_expr).label("avg_risk"),
            func.sum(high_expr).label("high_count"),
        )
        .outerjoin(models.Article, models.Article.country_id == models.Country.id)
        .group_by(
            models.Country.id,
            models.Country.name,
            models.Country.iso_code,
            models.Country.region,
        )
        .all()
    )

    # Corpus-wide mean, weighted by article count, used as the shrinkage prior.
    scored = [(int(t or 0), float(a)) for *_, t, a, _ in rows if t and a is not None]
    total_articles = sum(t for t, _ in scored)
    global_mean = (
        sum(t * a for t, a in scored) / total_articles if total_articles else 0.0
    )

    results = []
    for country_id, name, iso_code, region, total, avg_risk, high_count in rows:
        total = int(total or 0)
        raw_score = float(avg_risk) if total and avg_risk is not None else 0.0

        if total:
            # Bayesian shrinkage: a mean over one article is not evidence of a
            # national threat level, so pull it toward the global mean.
            score = (
                (total * raw_score + ALERT_CONFIDENCE_WEIGHT * global_mean)
                / (total + ALERT_CONFIDENCE_WEIGHT)
            )
        else:
            score = 0.0

        score = round(score, 2)
        results.append({
            "country_id": country_id,
            "country": name,
            "iso_code": iso_code,
            "region": region,
            "total_articles": total,
            "critical_alerts": int(high_count or 0),
            "alert_level": score,
            "raw_alert_level": round(raw_score, 2),
            "alert_status": risk_level(score),
        })

    results.sort(key=lambda r: r["alert_level"], reverse=True)
    return results


# ─────────────────────────────────────────────────────────
# HISTORY CAPTURE
# ─────────────────────────────────────────────────────────
def _hour_bucket(moment: datetime | None = None) -> datetime:
    moment = moment or datetime.utcnow()
    return moment.replace(minute=0, second=0, microsecond=0)


def capture_snapshot(db: Session, moment: datetime | None = None) -> int:
    """
    Record the current risk level of every country that has articles.

    Idempotent within an hour: re-running an ingest cycle updates that hour's
    row rather than appending a duplicate.
    """
    bucket = _hour_bucket(moment)
    statuses = [row for row in compute_alert_status(db) if row["total_articles"] > 0]
    if not statuses:
        return 0

    existing = {
        snap.country_id: snap
        for snap in db.query(models.CountryRiskSnapshot)
        .filter(models.CountryRiskSnapshot.captured_at == bucket)
        .all()
    }

    written = 0
    for row in statuses:
        snapshot = existing.get(row["country_id"])
        if snapshot is None:
            snapshot = models.CountryRiskSnapshot(
                country_id=row["country_id"], captured_at=bucket
            )
            db.add(snapshot)
        snapshot.risk_score = row["alert_level"]
        snapshot.raw_risk_score = row["raw_alert_level"]
        snapshot.article_count = row["total_articles"]
        snapshot.high_count = row["critical_alerts"]
        written += 1

    db.commit()
    logger.info("[TREND] Captured %s country snapshots at %s", written, bucket.isoformat())
    return written


def prune_snapshots(db: Session) -> int:
    threshold = datetime.utcnow() - timedelta(days=TREND_RETENTION_DAYS)
    deleted = (
        db.query(models.CountryRiskSnapshot)
        .filter(models.CountryRiskSnapshot.captured_at < threshold)
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


# ─────────────────────────────────────────────────────────
# HISTORY READS
# ─────────────────────────────────────────────────────────
def _load_window(db: Session, hours: int, iso_code: str | None = None):
    since = datetime.utcnow() - timedelta(hours=hours)
    query = (
        db.query(
            models.Country.iso_code,
            models.Country.name,
            models.CountryRiskSnapshot.captured_at,
            models.CountryRiskSnapshot.risk_score,
            models.CountryRiskSnapshot.article_count,
        )
        .join(models.Country, models.Country.id == models.CountryRiskSnapshot.country_id)
        .filter(models.CountryRiskSnapshot.captured_at >= since)
    )
    if iso_code:
        query = query.filter(models.Country.iso_code == iso_code.strip().upper())
    return query.order_by(models.CountryRiskSnapshot.captured_at.asc()).all()


def _downsample(points: list[dict], max_points: int) -> list[dict]:
    """Evenly thin a series — a sparkline needs shape, not every reading."""
    if max_points <= 0 or len(points) <= max_points:
        return points
    step = len(points) / max_points
    thinned = [points[min(int(i * step), len(points) - 1)] for i in range(max_points)]
    if thinned[-1] is not points[-1]:
        thinned[-1] = points[-1]  # always keep the latest reading
    return thinned


def trend_series(
    db: Session,
    hours: int = 168,
    max_points: int = 24,
    iso_code: str | None = None,
) -> dict[str, list[dict]]:
    """Return {iso_code: [{t, score, articles}, ...]} for sparklines."""
    grouped: dict[str, list[dict]] = defaultdict(list)
    for iso, _name, captured_at, score, articles in _load_window(db, hours, iso_code):
        grouped[iso].append({
            "t": captured_at.isoformat(),
            "score": round(float(score or 0.0), 2),
            "articles": int(articles or 0),
        })
    return {iso: _downsample(points, max_points) for iso, points in grouped.items()}


def compute_movers(db: Session, hours: int = 168, limit: int = 8) -> dict:
    """
    Countries whose risk moved most against their own recent baseline.

    A raw delta would just surface whichever country is noisiest, so the move
    is expressed as a z-score against that country's own spread. Countries
    without enough history yet are skipped rather than guessed at.
    """
    series: dict[str, dict] = {}
    for iso, name, captured_at, score, articles in _load_window(db, hours):
        entry = series.setdefault(iso, {"name": name, "points": []})
        entry["points"].append((captured_at, float(score or 0.0), int(articles or 0)))

    movers = []
    for iso, entry in series.items():
        points = entry["points"]
        if len(points) < MIN_BASELINE_POINTS + 1:
            continue

        *baseline_points, latest = points
        baseline_scores = [score for _, score, _ in baseline_points]
        baseline = statistics.fmean(baseline_scores)
        spread = (
            statistics.pstdev(baseline_scores)
            if len(baseline_scores) > 1
            else 0.0
        )
        delta = latest[1] - baseline
        z = delta / max(spread, MIN_BASELINE_STDEV)

        movers.append({
            "iso_code": iso,
            "country": entry["name"],
            "current": round(latest[1], 2),
            "baseline": round(baseline, 2),
            "delta": round(delta, 2),
            "z_score": round(z, 2),
            "article_count": latest[2],
            "observations": len(points),
            "direction": "up" if delta > 0 else "down" if delta < 0 else "flat",
        })

    rising = sorted([m for m in movers if m["delta"] > 0], key=lambda m: -m["z_score"])
    falling = sorted([m for m in movers if m["delta"] < 0], key=lambda m: m["z_score"])

    return {
        "window_hours": hours,
        "tracked_countries": len(series),
        "eligible_countries": len(movers),
        "rising": rising[:limit],
        "falling": falling[:limit],
    }


def history_status(db: Session) -> dict:
    """How much history exists — used by the UI to explain an empty panel."""
    total = db.query(func.count(models.CountryRiskSnapshot.id)).scalar() or 0
    oldest, newest = db.query(
        func.min(models.CountryRiskSnapshot.captured_at),
        func.max(models.CountryRiskSnapshot.captured_at),
    ).first()
    distinct_buckets = (
        db.query(func.count(func.distinct(models.CountryRiskSnapshot.captured_at))).scalar()
        or 0
    )
    return {
        "snapshots": total,
        "distinct_observations": distinct_buckets,
        "oldest": oldest,
        "newest": newest,
        "retention_days": TREND_RETENTION_DAYS,
        "ready": distinct_buckets > MIN_BASELINE_POINTS,
    }
