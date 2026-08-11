"""
Ingestion pipeline.

Pulls articles from every configured provider, resolves the country each
article is actually about, scores it with the risk engine and stores it.

Notable fixes over the previous implementation:
  * Country comes from the article text, not from the ingest batch.
  * Duplicate detection is one batched query instead of one query per article.
  * Sources are stored per outlet, not per (outlet, ingest country) pair.
  * RSS is wired up correctly and is the keyless fallback when APIs are
    unavailable or out of quota.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..countries import COUNTRIES, build_query, find_country_config
from . import alerts
from .country_resolver import resolve_primary_country
from .gnews_service import fetch_gnews
from .risk_engine import score_article
from .rss_service import fetch_country_rss, fetch_global_rss

logger = logging.getLogger(__name__)

NEWSAPI_PAGE_SIZE = 20
NEWSAPI_TIMEOUT = 15


def _env_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def ingest_batch_size() -> int:
    return _env_int("INGEST_BATCH_SIZE", 15)


def retention_days() -> int:
    return _env_int("RETENTION_DAYS", 30)


# ─────────────────────────────────────────────────────────
# CATALOG / CURSOR
# ─────────────────────────────────────────────────────────
def ensure_country_catalog_in_db(db: Session) -> None:
    """Keep the DB catalog aligned with the ISO catalog (names and regions)."""
    existing = {c.iso_code: c for c in db.query(models.Country).all()}
    changed = False

    for cfg in COUNTRIES:
        current = existing.get(cfg["code"])
        if current:
            if current.name != cfg["name"]:
                current.name = cfg["name"]
                changed = True
            if current.region != cfg["region"]:
                current.region = cfg["region"]
                changed = True
        else:
            db.add(models.Country(
                name=cfg["name"], iso_code=cfg["code"], region=cfg["region"],
            ))
            changed = True

    if changed:
        db.commit()


def load_cursor(db: Session) -> int:
    state = (
        db.query(models.SystemState)
        .filter(models.SystemState.key == "ingest_cursor")
        .first()
    )
    if state and state.value:
        try:
            return int(state.value)
        except ValueError:
            pass
    return 0


def save_cursor(db: Session, cursor: int) -> None:
    state = (
        db.query(models.SystemState)
        .filter(models.SystemState.key == "ingest_cursor")
        .first()
    )
    if state:
        state.value = str(cursor)
    else:
        db.add(models.SystemState(key="ingest_cursor", value=str(cursor)))
    db.commit()


def get_country_batch(db: Session, size: int) -> tuple[list[dict], int]:
    if not COUNTRIES:
        return [], 0
    size = max(1, min(size, len(COUNTRIES)))
    current = load_cursor(db) % len(COUNTRIES)
    batch = [COUNTRIES[(current + i) % len(COUNTRIES)] for i in range(size)]
    save_cursor(db, (current + size) % len(COUNTRIES))
    return batch, current


# ─────────────────────────────────────────────────────────
# PROVIDERS
# ─────────────────────────────────────────────────────────
def _fetch_newsapi(query_string: str) -> list[dict]:
    api_key = os.getenv("NEWS_API_KEY")
    if not api_key:
        return []
    try:
        response = requests.get(
            "https://newsapi.org/v2/everything",
            params={
                "q": query_string,
                "language": "en",
                "sortBy": "publishedAt",
                "pageSize": NEWSAPI_PAGE_SIZE,
                "apiKey": api_key,
            },
            timeout=NEWSAPI_TIMEOUT,
        )
        if response.status_code != 200:
            # 426/429 here means the free plan is blocked in production.
            logger.warning("  [ERR] NewsAPI %s: %s", response.status_code, response.text[:160])
            return []
        articles = response.json().get("articles", [])
        for item in articles:
            item["provider"] = "newsapi"
        logger.info("  [NET] NewsAPI: %s articles", len(articles))
        return articles
    except requests.exceptions.RequestException as e:
        logger.warning("  [ERR] NewsAPI request failed: %s", e)
        return []


# ─────────────────────────────────────────────────────────
# STORAGE HELPERS
# ─────────────────────────────────────────────────────────
def _parse_published(raw: str | None) -> datetime:
    if not raw:
        return datetime.utcnow()
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return datetime.utcnow()
    # Store naive UTC so comparisons against utcnow() stay valid.
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return parsed


def _clean_source_name(raw: str | None) -> str:
    name = (raw or "").strip()
    return name or "Unknown Source"


def _get_source_map(db: Session, names: set[str]) -> dict[str, models.Source]:
    """Fetch or create every source in one pass instead of one commit each."""
    if not names:
        return {}
    existing = {
        s.name: s
        for s in db.query(models.Source).filter(models.Source.name.in_(list(names))).all()
    }
    missing = names - set(existing)
    for name in missing:
        source = models.Source(name=name)
        db.add(source)
        existing[name] = source
    if missing:
        db.flush()  # assign ids without committing
    return existing


def _existing_urls(db: Session, urls: list[str]) -> set[str]:
    """One batched query replaces the old per-article duplicate check."""
    found: set[str] = set()
    for chunk_start in range(0, len(urls), 400):
        chunk = urls[chunk_start:chunk_start + 400]
        rows = (
            db.query(models.Article.url)
            .filter(models.Article.url.in_(chunk))
            .all()
        )
        found.update(row[0] for row in rows)
    return found


def store_articles(
    db: Session,
    items: list[dict],
    country_iso_to_id: dict[str, int],
    fallback_country_id: int | None = None,
) -> int:
    """
    Score, attribute and persist a batch of provider articles.

    ``fallback_country_id`` is used only when the text names no country at all;
    pass None to leave such articles unattributed rather than misfiled.
    """
    if not items:
        return 0

    # Deduplicate within the batch first — the same wire story arrives from
    # several feeds at once.
    by_url: dict[str, dict] = {}
    for item in items:
        url = (item.get("url") or "").strip()
        title = (item.get("title") or "").strip()
        if not url or not title or title == "[Removed]":
            continue
        by_url.setdefault(url, item)

    if not by_url:
        return 0

    already_stored = _existing_urls(db, list(by_url))
    fresh = {url: item for url, item in by_url.items() if url not in already_stored}
    if not fresh:
        return 0

    source_names = {
        _clean_source_name((item.get("source") or {}).get("name"))
        for item in fresh.values()
    }
    sources = _get_source_map(db, source_names)

    saved = 0
    for url, item in fresh.items():
        title = item.get("title")
        description = item.get("description")

        iso = resolve_primary_country(title, description)
        country_id = country_iso_to_id.get(iso) if iso else None
        if country_id is None:
            country_id = fallback_country_id

        text = f"{title or ''} {description or ''}"
        geo_risk_score, geo_risk_level, event_type, category = score_article(text)

        # Legacy sentiment fields kept as aliases for older clients.
        sentiment_score = (
            geo_risk_score / 100.0 * -1
            if geo_risk_level in ("high", "medium")
            else geo_risk_score / 100.0
        )

        db.add(models.Article(
            title=title,
            description=description,
            url=url,
            source_id=sources[_clean_source_name((item.get("source") or {}).get("name"))].id,
            country_id=country_id,
            provider=item.get("provider", "rss"),
            published_at=_parse_published(item.get("publishedAt")),
            sentiment_score=sentiment_score,
            sentiment_label=geo_risk_level,
            geo_risk_score=geo_risk_score,
            geo_risk_level=geo_risk_level,
            event_type=event_type,
            category=category,
        ))
        saved += 1

    db.commit()
    return saved


def country_iso_to_id(db: Session) -> dict[str, int]:
    return {
        iso: cid
        for cid, iso in db.query(models.Country.id, models.Country.iso_code).all()
    }


# ─────────────────────────────────────────────────────────
# INGEST ENTRY POINTS
# ─────────────────────────────────────────────────────────
def ingest_news_for_country(country_iso: str, db: Session) -> int:
    """Ingest for one country from every available provider."""
    country_cfg = find_country_config(country_iso)
    iso_map = country_iso_to_id(db)
    logger.info("[INGEST] %s (%s)", country_cfg["name"], country_cfg["code"])

    query_string = build_query(country_cfg["query"])

    items: list[dict] = []
    items += _fetch_newsapi(query_string)
    items += fetch_gnews(query_string, country_cfg["code"])
    # Country-targeted Google News feed: free, keyless, always available.
    items += fetch_country_rss(country_cfg["name"])

    if not items:
        logger.warning("[WARN] No articles from any source for %s", country_cfg["name"])
        return 0

    # These results were requested for this country, so it is a sound fallback
    # when the text itself names no country.
    fallback_id = iso_map.get(country_cfg["code"])
    saved = store_articles(db, items, iso_map, fallback_country_id=fallback_id)
    logger.info("[OK] %s: %s new articles (%s fetched)", country_cfg["name"], saved, len(items))
    return saved


def ingest_global_feeds(db: Session) -> int:
    """
    Ingest the global wire feeds once per cycle.

    Attribution comes purely from the text — an article naming no country is
    stored unattributed rather than misfiled against an arbitrary one.
    """
    items = fetch_global_rss()
    if not items:
        return 0
    saved = store_articles(db, items, country_iso_to_id(db), fallback_country_id=None)
    logger.info("[OK] Global feeds: %s new articles (%s fetched)", saved, len(items))
    return saved


def delete_old_articles(db: Session) -> int:
    """Drop articles past the retention window."""
    threshold = datetime.utcnow() - timedelta(days=retention_days())
    deleted = (
        db.query(models.Article)
        .filter(models.Article.published_at < threshold)
        .delete(synchronize_session=False)
    )
    db.commit()
    if deleted:
        logger.info("[CLEANUP] Removed %s articles older than %s days", deleted, retention_days())
    return deleted


def prune_orphan_sources(db: Session) -> int:
    """Remove sources that no longer have any articles."""
    subquery = db.query(models.Article.source_id).distinct()
    deleted = (
        db.query(models.Source)
        .filter(~models.Source.id.in_(subquery))
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def run_ingest_cycle(db: Session, batch_size: int | None = None) -> dict:
    """One scheduled cycle: global feeds, then a rotating slice of countries."""
    ensure_country_catalog_in_db(db)

    global_saved = ingest_global_feeds(db)

    batch, start_idx = get_country_batch(db, batch_size or ingest_batch_size())
    results: dict[str, int] = {}
    for country_cfg in batch:
        try:
            results[country_cfg["code"]] = ingest_news_for_country(country_cfg["code"], db)
        except Exception as e:
            db.rollback()
            logger.warning("[ERR] Ingest failed for %s: %s", country_cfg["code"], e)
            results[country_cfg["code"]] = 0

    delete_old_articles(db)
    prune_orphan_sources(db)

    # Record where every country stands now, so the next cycle can say what
    # changed. Never let a history failure abort an otherwise good ingest.
    snapshots = 0
    try:
        snapshots = alerts.capture_snapshot(db)
        alerts.prune_snapshots(db)
    except Exception as e:
        db.rollback()
        logger.warning("[ERR] Risk snapshot failed: %s", e)

    total = global_saved + sum(results.values())
    logger.info(
        "[CYCLE] batch_start=%s size=%s global=%s country=%s total_saved=%s snapshots=%s",
        start_idx, len(batch), global_saved, sum(results.values()), total, snapshots,
    )
    return {
        "batch_start_index": start_idx,
        "batch_size": len(batch),
        "global_saved": global_saved,
        "results": results,
        "total_saved": total,
        "snapshots_captured": snapshots,
    }


def article_count(db: Session) -> int:
    return db.query(func.count(models.Article.id)).scalar() or 0
