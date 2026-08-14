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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import models
from ..countries import COUNTRIES, build_query, find_country_config
from . import alerts
from . import events as event_grouping
from . import llm_classifier
from .country_resolver import resolve_countries
from .gnews_service import fetch_gnews
from .reliability import reliability_for
from .risk_engine import score_article
from .rss_service import fetch_country_rss, fetch_global_rss
from .story import story_key

logger = logging.getLogger(__name__)

NEWSAPI_PAGE_SIZE = 20
NEWSAPI_TIMEOUT = 15

# How far back a story stays "the same story". Beyond this a matching headline
# is treated as a new event rather than a duplicate — recurring headlines
# ("Russian attacks kill 9 in Ukraine") do describe different days.
STORY_CLUSTER_DAYS = 3


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


_LAST_INGEST_KEY = "last_ingest_at"


def record_ingest_time(db: Session, moment: datetime | None = None) -> None:
    """
    Remember when a cycle last completed.

    Persisted rather than kept in memory because the point of the record is to
    survive a restart: on a host that stops the container when idle, the
    in-process value is gone exactly when something needs to ask how long the
    feed has been unattended.
    """
    stamp = (moment or datetime.utcnow()).isoformat()
    row = (
        db.query(models.SystemState)
        .filter(models.SystemState.key == _LAST_INGEST_KEY)
        .first()
    )
    if row:
        row.value = stamp
    else:
        db.add(models.SystemState(key=_LAST_INGEST_KEY, value=stamp))
    db.commit()


def last_ingest_at(db: Session) -> datetime | None:
    row = (
        db.query(models.SystemState)
        .filter(models.SystemState.key == _LAST_INGEST_KEY)
        .first()
    )
    if not row or not row.value:
        return None
    try:
        return datetime.fromisoformat(row.value)
    except ValueError:
        return None


def get_country_batch(db: Session, size: int) -> tuple[list[dict], int]:
    """
    Next slice of the rotating catalog.

    The cursor is *not* advanced here — the caller advances it once the batch
    has actually been ingested. Advancing up front meant a batch that died
    mid-cycle was skipped until the cursor wrapped all 249 countries.
    """
    if not COUNTRIES:
        return [], 0
    size = max(1, min(size, len(COUNTRIES)))
    current = load_cursor(db) % len(COUNTRIES)
    batch = [COUNTRIES[(current + i) % len(COUNTRIES)] for i in range(size)]
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


def _clean_image_url(item: dict) -> str | None:
    """
    Normalise the lead image across providers.

    NewsAPI calls it urlToImage, GNews calls it image, and the RSS layer
    resolves one from whichever media element the feed used. Only absolute
    http(s) URLs are kept: a relative or data: URL cannot be rendered from the
    dashboard's origin, and storing one just produces a broken card.
    """
    raw = item.get("image") or item.get("urlToImage")
    url = (raw or "").strip()
    if not url.lower().startswith(("http://", "https://")):
        return None
    return url[:1000] if len(url) > 1000 else url


def _source_ids(db: Session, names: set[str]) -> dict[str, int]:
    """
    Fetch or create every source in one pass instead of one commit each.

    Committed rather than flushed: the article insert below may have to roll
    back (a racing writer can claim a URL between the duplicate check and the
    insert), and a rollback would take uncommitted sources with it, leaving
    the article rows pointing at ids that no longer exist. A source with no
    articles yet is harmless — prune_orphan_sources clears it.
    """
    if not names:
        return {}

    def lookup() -> dict[str, int]:
        return {
            name: sid
            for sid, name in db.query(models.Source.id, models.Source.name)
            .filter(models.Source.name.in_(list(names)))
            .all()
        }

    existing = lookup()
    missing = names - set(existing)
    if not missing:
        return existing

    for name in missing:
        db.add(models.Source(name=name, reliability=reliability_for(name)))
    try:
        db.commit()
    except IntegrityError:
        # Another ingest thread created the same outlet first.
        db.rollback()
    return lookup()


def _known_story_keys(db: Session, keys: list[str]) -> set[str]:
    """Which of these stories the feed already carries a canonical copy of."""
    if not keys:
        return set()
    horizon = datetime.utcnow() - timedelta(days=STORY_CLUSTER_DAYS)
    found: set[str] = set()
    for start in range(0, len(keys), 400):
        rows = (
            db.query(models.Article.story_key)
            .filter(
                models.Article.story_key.in_(keys[start:start + 400]),
                models.Article.is_duplicate.is_(False),
                models.Article.published_at >= horizon,
            )
            .all()
        )
        found.update(row[0] for row in rows)
    return found


def _assign_events(
    db: Session,
    ordered: list[tuple],
    topics: list,
    country_iso_to_id: dict[str, int],
    fallback_country_id: int | None,
) -> dict[str, str]:
    """
    Give each incoming article an event key.

    Recently stored articles are grouped alongside the new batch so a
    follow-up ("Death toll rises to 200") joins the event it continues rather
    than founding a new one. Only the trailing window is loaded — regrouping
    the whole archive every cycle would be pointless work, and events older
    than the window are closed to new members anyway.
    """
    if not ordered:
        return {}

    horizon = datetime.utcnow() - timedelta(days=event_grouping.WINDOW_DAYS * 2)
    recent = (
        db.query(
            models.Article.id, models.Article.title, models.Article.description,
            models.Article.country_id, models.Article.event_type,
            models.Article.published_at, models.Article.event_key,
        )
        .filter(models.Article.published_at >= horizon)
        .all()
    )

    # Existing articles are keyed by database id; incoming ones by their URL,
    # which is unique and available before the row exists.
    rows = [(r.id, r.title, r.description, r.country_id, r.event_type, r.published_at)
            for r in recent]
    existing_keys = {r.id: r.event_key for r in recent if r.event_key}

    for (url, item), topic in zip(ordered, topics):
        codes = resolve_countries(item.get("title"), item.get("description"))
        country_id = (country_iso_to_id.get(codes[0]) if codes else None) or fallback_country_id
        rows.append((
            url, item.get("title"), item.get("description"),
            country_id, topic.category, _parse_published(item.get("publishedAt")),
        ))

    assignment = event_grouping.group_articles(rows, known=existing_keys)
    return {url: assignment[url] for url, _ in ordered if url in assignment}


def _insert_articles(db: Session, prepared: list[dict]) -> int:
    """
    Persist prepared article rows, tolerating a racing duplicate URL.

    articles.url is UNIQUE and the duplicate check upstream is a
    check-then-insert, so a concurrent cycle (the scheduler overlapping a
    manual /ingest-batch) can claim a URL in between. One collision used to
    abort the flush and discard the *whole* batch — verified: five items, one
    conflict, four good rows lost — and the caller logged it as "0 saved".

    The bulk path stays the fast default; only a conflict falls back to
    per-row savepoints, so the cost is paid only when it is actually needed.
    """
    if not prepared:
        return 0

    try:
        db.add_all([models.Article(**row) for row in prepared])
        db.commit()
        return len(prepared)
    except IntegrityError:
        db.rollback()
        logger.info("  [RACE] Duplicate URL in batch - retrying %s rows individually", len(prepared))

    saved = 0
    for row in prepared:
        try:
            with db.begin_nested():  # SAVEPOINT: a conflict rolls back this row only
                db.add(models.Article(**row))
            saved += 1
        except IntegrityError:
            continue  # another writer stored this URL first
    db.commit()
    return saved


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


def _backfill_images(db: Session, by_url: dict[str, str]) -> int:
    """Attach artwork to already-stored articles that have none."""
    if not by_url:
        return 0

    urls = list(by_url)
    updated = 0
    for start in range(0, len(urls), 400):
        chunk = urls[start:start + 400]
        rows = (
            db.query(models.Article)
            .filter(models.Article.url.in_(chunk), models.Article.image_url.is_(None))
            .all()
        )
        for article in rows:
            article.image_url = by_url[article.url]
            updated += 1

    if updated:
        db.commit()
        logger.info("  [IMG] Backfilled artwork for %s existing articles", updated)
    return updated


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

    # Articles seen before are skipped as duplicates, so a row stored while a
    # feed was omitting artwork — or before image_url existed at all — would
    # stay blank forever even though the feed now carries one. Fill those in
    # on the way past; it is the newest articles that are still in the feeds,
    # which is exactly what the dashboard shows first.
    _backfill_images(db, {
        url: img for url in already_stored
        if (img := _clean_image_url(by_url[url]))
    })

    fresh = {url: item for url, item in by_url.items() if url not in already_stored}
    if not fresh:
        return 0

    source_names = {
        _clean_source_name((item.get("source") or {}).get("name"))
        for item in fresh.values()
    }
    sources = _source_ids(db, source_names)

    # One story arrives from many outlets at once, so the batch is clustered
    # against itself as well as against what is already stored; otherwise the
    # five copies in a single fetch would all be canonical.
    keys_in_batch = {url: story_key(item.get("title")) for url, item in fresh.items()}
    seen_keys = _known_story_keys(db, sorted({k for k in keys_in_batch.values() if k}))

    # Topic is decided for the whole batch at once. The LLM adjudication layer
    # is batched, so classifying per article would turn one request into
    # hundreds; doing it here keeps the cost proportional to cycles.
    ordered = list(fresh.items())
    topics = llm_classifier.classify_batch(
        db, [(item.get("title"), item.get("description")) for _url, item in ordered]
    )

    # Event grouping runs against recent stored articles as well as the batch,
    # so a follow-up joins the event it belongs to rather than starting a new
    # one. Only the trailing window is loaded — grouping the whole archive on
    # every cycle would be pointless work.
    event_keys = _assign_events(db, ordered, topics, country_iso_to_id, fallback_country_id)

    prepared: list[dict] = []
    for (url, item), topic in zip(ordered, topics):
        title = item.get("title")
        description = item.get("description")

        source_id = sources.get(_clean_source_name((item.get("source") or {}).get("name")))
        if source_id is None:
            continue  # source row lost a create race and is gone; skip rather than orphan

        # The resolver ranks every country it finds; the runner-up is what
        # makes a story bilateral ("India and China hold border talks").
        codes = resolve_countries(title, description)
        country_id = country_iso_to_id.get(codes[0]) if codes else None
        if country_id is None:
            country_id = fallback_country_id
        secondary_id = country_iso_to_id.get(codes[1]) if len(codes) > 1 else None
        if secondary_id == country_id:
            secondary_id = None

        key = keys_in_batch[url]
        # An unkeyable headline is too generic to cluster, so it stands alone.
        duplicate = bool(key) and key in seen_keys
        if key:
            seen_keys.add(key)

        text = f"{title or ''} {description or ''}"
        geo_risk_score, geo_risk_level, _event_type, category = score_article(text)

        # Legacy sentiment fields kept as aliases for older clients.
        sentiment_score = (
            geo_risk_score / 100.0 * -1
            if geo_risk_level in ("high", "medium")
            else geo_risk_score / 100.0
        )

        prepared.append(dict(
            title=title,
            description=description,
            url=url,
            image_url=_clean_image_url(item),
            source_id=source_id,
            country_id=country_id,
            country_id_secondary=secondary_id,
            story_key=key,
            event_key=event_keys.get(url),
            is_duplicate=duplicate,
            provider=item.get("provider", "rss"),
            published_at=_parse_published(item.get("publishedAt")),
            sentiment_score=sentiment_score,
            sentiment_label=geo_risk_level,
            geo_risk_score=geo_risk_score,
            geo_risk_level=geo_risk_level,
            event_type=topic.category,
            topic_confidence=topic.confidence,
            category=category,
        ))

    return _insert_articles(db, prepared)


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
    """
    Remove sources that no longer have any articles.

    The NULL filter is load-bearing: `NOT IN (subquery containing NULL)`
    evaluates to NULL for every row, so a single article with no source_id
    used to silently disable pruning entirely.
    """
    subquery = (
        db.query(models.Article.source_id)
        .filter(models.Article.source_id.isnot(None))
        .distinct()
    )
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

    # Advance only after the batch has been attempted, so a crash mid-cycle
    # retries these countries next time instead of skipping them.
    if batch:
        save_cursor(db, (start_idx + len(batch)) % len(COUNTRIES))

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

    record_ingest_time(db)

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
