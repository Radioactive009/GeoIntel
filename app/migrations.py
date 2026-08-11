"""
Lightweight in-place schema/data migrations.

The project has no Alembic setup and ships a live SQLite file, so migrations
run at startup and must be idempotent. Each step checks the current shape of
the database before touching it.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import bindparam, inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)

# Legacy source names carried an ingest tag: "BBC News (GNews) [AE]".
SOURCE_TAG_RE = re.compile(r"\s*\((?:GNews|RSS|Google RSS)\)|\s*\[[A-Z]{2}\]\s*$")

ARTICLE_COLUMNS = {
    "sentiment_score": "FLOAT",
    "sentiment_label": "VARCHAR",
    "geo_risk_score": "FLOAT",
    "geo_risk_level": "VARCHAR",
    "event_type": "VARCHAR",
    "category": "VARCHAR",
    "country_id": "INTEGER",
    "provider": "VARCHAR",
}

INDEXES = {
    "ix_articles_published_at": "CREATE INDEX IF NOT EXISTS ix_articles_published_at ON articles (published_at)",
    "ix_articles_source_id": "CREATE INDEX IF NOT EXISTS ix_articles_source_id ON articles (source_id)",
    "ix_articles_country_id": "CREATE INDEX IF NOT EXISTS ix_articles_country_id ON articles (country_id)",
    "ix_articles_country_published": "CREATE INDEX IF NOT EXISTS ix_articles_country_published ON articles (country_id, published_at)",
}


def _existing_columns(conn, table: str) -> set[str]:
    inspector = inspect(conn)
    if table not in inspector.get_table_names():
        return set()
    return {col["name"] for col in inspector.get_columns(table)}


def _add_missing_columns(conn) -> None:
    columns = _existing_columns(conn, "articles")
    if not columns:
        return
    for name, sql_type in ARTICLE_COLUMNS.items():
        if name not in columns:
            conn.execute(text(f"ALTER TABLE articles ADD COLUMN {name} {sql_type}"))
            logger.info("[MIGRATE] Added articles.%s", name)


def _create_indexes(conn) -> None:
    for name, ddl in INDEXES.items():
        try:
            conn.execute(text(ddl))
        except Exception as e:  # index DDL differs across backends; never fatal
            logger.warning("[MIGRATE] Could not create %s: %s", name, e)


def _dedupe_sources(conn) -> None:
    """
    Collapse per-country source duplicates onto one row per outlet.

    "BBC News [AE]", "BBC News [BV]" and "BBC News (GNews) [IN]" all become
    "BBC News", with every article repointed at the surviving row.
    """
    rows = conn.execute(text("SELECT id, name FROM sources")).fetchall()
    if not rows:
        return

    keeper_by_clean: dict[str, int] = {}
    remap: dict[int, int] = {}

    for source_id, name in sorted(rows, key=lambda r: r[0]):
        clean = SOURCE_TAG_RE.sub("", name or "").strip() or "Unknown Source"
        keeper = keeper_by_clean.get(clean)
        if keeper is None:
            keeper_by_clean[clean] = source_id
        elif keeper != source_id:
            remap[source_id] = keeper

    for old_id, new_id in remap.items():
        conn.execute(
            text("UPDATE articles SET source_id = :new WHERE source_id = :old"),
            {"new": new_id, "old": old_id},
        )
    if remap:
        stale_ids = list(remap)
        delete_stmt = text("DELETE FROM sources WHERE id IN :ids").bindparams(
            bindparam("ids", expanding=True)
        )
        for chunk_start in range(0, len(stale_ids), 500):
            conn.execute(delete_stmt, {"ids": stale_ids[chunk_start:chunk_start + 500]})
        logger.info("[MIGRATE] Merged %s duplicate source rows", len(remap))

    renamed = 0
    for clean, keeper_id in keeper_by_clean.items():
        result = conn.execute(
            text("UPDATE sources SET name = :clean WHERE id = :id AND name <> :clean"),
            {"clean": clean, "id": keeper_id},
        )
        renamed += result.rowcount or 0
    if renamed:
        logger.info("[MIGRATE] Normalised %s source names", renamed)


def _drop_source_country(conn) -> None:
    """
    Retire sources.country_id.

    SQLite cannot drop a column before 3.35, and the column is harmless once
    unused, so it is simply blanked out to stop anything reading stale links.
    """
    columns = _existing_columns(conn, "sources")
    if "country_id" not in columns:
        return
    conn.execute(text("UPDATE sources SET country_id = NULL WHERE country_id IS NOT NULL"))
    logger.info("[MIGRATE] Cleared legacy sources.country_id links")


def _backfill_article_countries(conn) -> int:
    """
    Re-resolve the country of every article that has none.

    Old rows were attributed to whichever ingest batch fetched them, so the
    existing links are discarded and recomputed from the article text.
    """
    from .services.country_resolver import resolve_primary_country

    rows = conn.execute(
        text("SELECT id, title, description FROM articles WHERE country_id IS NULL")
    ).fetchall()
    if not rows:
        return 0

    iso_to_id = {
        iso: cid
        for cid, iso in conn.execute(text("SELECT id, iso_code FROM countries")).fetchall()
    }

    updates = []
    for article_id, title, description in rows:
        iso = resolve_primary_country(title, description)
        country_id = iso_to_id.get(iso) if iso else None
        if country_id:
            updates.append({"cid": country_id, "aid": article_id})

    for chunk_start in range(0, len(updates), 500):
        conn.execute(
            text("UPDATE articles SET country_id = :cid WHERE id = :aid"),
            updates[chunk_start:chunk_start + 500],
        )

    logger.info(
        "[MIGRATE] Resolved country for %s/%s previously unattributed articles",
        len(updates), len(rows),
    )
    return len(updates)


def run_migrations(engine: Engine) -> None:
    """Bring an existing database up to the current schema. Safe to re-run."""
    with engine.begin() as conn:
        _add_missing_columns(conn)
        _create_indexes(conn)
        _dedupe_sources(conn)
        _drop_source_country(conn)

    # Backfill runs in its own transaction so a resolver failure cannot roll
    # back the structural changes above.
    try:
        with engine.begin() as conn:
            _backfill_article_countries(conn)
    except Exception as e:
        logger.warning("[MIGRATE] Country backfill skipped: %s", e)
