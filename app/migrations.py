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

# Marks the one-shot purge of pre-window risk snapshots.
_HISTORY_RESET_KEY = "migration_risk_history_windowed"
# One-shot backfills for columns added after articles were already stored.
_CLUSTER_BACKFILL_KEY = "migration_story_clusters"
_SECONDARY_BACKFILL_KEY = "migration_secondary_countries"

ARTICLE_COLUMNS = {
    "sentiment_score": "FLOAT",
    "sentiment_label": "VARCHAR",
    "geo_risk_score": "FLOAT",
    "geo_risk_level": "VARCHAR",
    "event_type": "VARCHAR",
    "category": "VARCHAR",
    "country_id": "INTEGER",
    "country_id_secondary": "INTEGER",
    "provider": "VARCHAR",
    "image_url": "VARCHAR",
    "story_key": "VARCHAR",
    "is_duplicate": "BOOLEAN DEFAULT 0",
}

SOURCE_COLUMNS = {
    "reliability": "FLOAT DEFAULT 1.0",
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


def _column_types(conn, table: str) -> dict[str, str]:
    inspector = inspect(conn)
    if table not in inspector.get_table_names():
        return {}
    return {col["name"]: str(col["type"]).upper() for col in inspector.get_columns(table)}


def _flag(conn, key: str) -> bool:
    """Has this one-shot data migration already run?"""
    if "system_state" not in inspect(conn).get_table_names():
        return False
    row = conn.execute(
        text("SELECT value FROM system_state WHERE key = :k"), {"k": key}
    ).fetchone()
    return bool(row)


def _set_flag(conn, key: str, value: str = "done") -> None:
    if "system_state" not in inspect(conn).get_table_names():
        return
    conn.execute(
        text("DELETE FROM system_state WHERE key = :k"), {"k": key}
    )
    conn.execute(
        text("INSERT INTO system_state (key, value) VALUES (:k, :v)"),
        {"k": key, "v": value},
    )


def _add_missing_columns(conn) -> None:
    for table, spec in (("articles", ARTICLE_COLUMNS), ("sources", SOURCE_COLUMNS)):
        columns = _existing_columns(conn, table)
        if not columns:
            continue
        for name, sql_type in spec.items():
            if name not in columns:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}"))
                logger.info("[MIGRATE] Added %s.%s", table, name)


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


def _fix_channel_booleans(conn) -> None:
    """
    Bring channels.is_enabled / is_live in line with the Boolean model columns.

    These were declared Integer originally and the tables in the wild were
    created that way. SQLite hides the difference through type affinity, so
    the mismatch is invisible locally — but Postgres rejects a Python bool
    bound to an INTEGER column ("column is of type integer but expression is
    of type boolean") and fails `.is_(True)` filters the same way. Changing
    the model alone does not touch an existing table: create_all only creates,
    it never alters, so without this step a deployed Postgres instance keeps
    failing exactly as before.
    """
    columns = _column_types(conn, "channels")
    if not columns:
        return

    # The model declares these NOT NULL; legacy rows may hold NULL.
    for name, default in (("is_enabled", 1), ("is_live", 0)):
        if name in columns:
            conn.execute(
                text(f"UPDATE channels SET {name} = :d WHERE {name} IS NULL"),
                {"d": default},
            )

    if conn.dialect.name != "postgresql":
        return  # SQLite stores bool and int in the same affinity

    for name in ("is_enabled", "is_live"):
        current = columns.get(name)
        if not current or "BOOL" in current:
            continue
        conn.execute(text(
            f"ALTER TABLE channels ALTER COLUMN {name} "
            f"TYPE BOOLEAN USING ({name} <> 0)"
        ))
        conn.execute(text(f"ALTER TABLE channels ALTER COLUMN {name} SET NOT NULL"))
        logger.info("[MIGRATE] channels.%s converted to BOOLEAN", name)


def _reset_cumulative_risk_history(conn) -> None:
    """
    Drop risk snapshots captured before the window fix.

    Those rows hold the cumulative all-time mean over the whole corpus rather
    than a reading for their hour, so they are not on the same scale as the
    windowed rows that replace them. Leaving them in place would make the
    first real snapshot look like an enormous step change and poison every
    z-score in compute_movers until they aged out.
    """
    if _flag(conn, _HISTORY_RESET_KEY):
        return
    if "country_risk_history" not in inspect(conn).get_table_names():
        return
    deleted = conn.execute(text("DELETE FROM country_risk_history")).rowcount or 0
    _set_flag(conn, _HISTORY_RESET_KEY)
    if deleted:
        logger.info(
            "[MIGRATE] Cleared %s pre-window risk snapshots; history rebuilds from "
            "the next ingest cycle", deleted,
        )


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


def _backfill_story_clusters(conn) -> None:
    """
    Assign a story key to every article and flag the redundant copies.

    Existing rows predate clustering, so without this the feed keeps showing
    the same wire story several times until the whole corpus rotates out.
    Canonical copy = the earliest published of a cluster, so the feed keeps
    whichever outlet broke it.
    """
    if _flag(conn, _CLUSTER_BACKFILL_KEY):
        return
    columns = _existing_columns(conn, "articles")
    if "story_key" not in columns:
        return

    from .services.story import story_key

    rows = conn.execute(
        text("SELECT id, title, published_at FROM articles ORDER BY published_at ASC, id ASC")
    ).fetchall()
    if not rows:
        _set_flag(conn, _CLUSTER_BACKFILL_KEY)
        return

    seen: set[str] = set()
    updates = []
    for article_id, title, _published in rows:
        key = story_key(title)
        duplicate = bool(key) and key in seen
        if key:
            seen.add(key)
        updates.append({"aid": article_id, "key": key, "dup": 1 if duplicate else 0})

    statement = text("UPDATE articles SET story_key = :key, is_duplicate = :dup WHERE id = :aid")
    for start in range(0, len(updates), 500):
        conn.execute(statement, updates[start:start + 500])

    _set_flag(conn, _CLUSTER_BACKFILL_KEY)
    logger.info(
        "[MIGRATE] Clustered %s articles; %s flagged as duplicate reports",
        len(updates), sum(u["dup"] for u in updates),
    )


def _backfill_secondary_countries(conn) -> None:
    """Resolve the runner-up country for articles that have none recorded."""
    if _flag(conn, _SECONDARY_BACKFILL_KEY):
        return
    if "country_id_secondary" not in _existing_columns(conn, "articles"):
        return

    from .services.country_resolver import resolve_countries

    rows = conn.execute(
        text("SELECT id, title, description, country_id FROM articles")
    ).fetchall()
    iso_to_id = {
        iso: cid
        for cid, iso in conn.execute(text("SELECT id, iso_code FROM countries")).fetchall()
    }

    updates = []
    for article_id, title, description, primary_id in rows:
        codes = resolve_countries(title, description)
        for code in codes[1:]:
            candidate = iso_to_id.get(code)
            if candidate and candidate != primary_id:
                updates.append({"cid": candidate, "aid": article_id})
                break

    for start in range(0, len(updates), 500):
        conn.execute(
            text("UPDATE articles SET country_id_secondary = :cid WHERE id = :aid"),
            updates[start:start + 500],
        )

    _set_flag(conn, _SECONDARY_BACKFILL_KEY)
    logger.info("[MIGRATE] Recorded a second country for %s articles", len(updates))


def _backfill_source_reliability(conn) -> None:
    """Score every stored outlet. Re-runs cheaply when the tier list changes."""
    if "reliability" not in _existing_columns(conn, "sources"):
        return

    from .services.reliability import DEFAULT_RELIABILITY, reliability_for

    rows = conn.execute(text("SELECT id, name FROM sources")).fetchall()
    updates = [
        {"w": reliability_for(name), "sid": source_id}
        for source_id, name in rows
    ]
    changed = sum(1 for u in updates if u["w"] != DEFAULT_RELIABILITY)
    for start in range(0, len(updates), 500):
        conn.execute(
            text("UPDATE sources SET reliability = :w WHERE id = :sid"),
            updates[start:start + 500],
        )
    if changed:
        logger.info("[MIGRATE] Weighted %s/%s sources away from neutral", changed, len(updates))


def run_migrations(engine: Engine) -> None:
    """Bring an existing database up to the current schema. Safe to re-run."""
    with engine.begin() as conn:
        _add_missing_columns(conn)
        _create_indexes(conn)
        _dedupe_sources(conn)
        _drop_source_country(conn)

    # Each of these can fail independently on a backend-specific quirk without
    # invalidating the structural work above, so they get their own transaction.
    for step in (
        _fix_channel_booleans,
        _reset_cumulative_risk_history,
        _backfill_source_reliability,
        _backfill_story_clusters,
        _backfill_secondary_countries,
    ):
        try:
            with engine.begin() as conn:
                step(conn)
        except Exception as e:
            logger.warning("[MIGRATE] %s skipped: %s", step.__name__, e)

    # Backfill runs in its own transaction so a resolver failure cannot roll
    # back the structural changes above.
    try:
        with engine.begin() as conn:
            _backfill_article_countries(conn)
    except Exception as e:
        logger.warning("[MIGRATE] Country backfill skipped: %s", e)
