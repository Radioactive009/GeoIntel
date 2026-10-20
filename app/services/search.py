"""
Ranked full-text search over the archive.

Search was `ILIKE '%term%'` ordered by publication date. That has three
problems, and they compound: a leading wildcard cannot use an index, so every
query scanned the table; there is no relevance, so searching "sanctions"
returned the *newest* article containing the word rather than the one most
about it; and there is no notion of a phrase, a prefix or a word stem, so
"sanction" missed "sanctions" while "ban" matched "Albania" and "urban".

SQLite ships FTS5, which fixes all three with BM25 ranking. The catch is that
it is SQLite-only and this project also runs on Postgres, so everything here
degrades: when the index is absent the caller gets the old LIKE behaviour and
the site works exactly as before, just less well.

The index is external-content — it stores no copy of the text, only the terms,
pointing back at `articles` by rowid. That keeps the database roughly the size
it already was rather than doubling the article text.
"""

from __future__ import annotations

import logging
import re

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

FTS_TABLE = "articles_fts"

# Enough to answer a query, small enough to stay cheap: the ranked ids are
# fetched then filtered/paginated by the ordinary query, so this bounds how
# deep relevance can reach rather than how many results a reader sees.
MAX_MATCHES = 2000


def is_available(db: Session) -> bool:
    """Whether this database has the full-text index."""
    if db.bind.dialect.name != "sqlite":
        return False
    try:
        found = db.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name=:n"),
            {"n": FTS_TABLE},
        ).first()
        return bool(found)
    except Exception:
        return False


# FTS5 treats a pile of punctuation as syntax: bare `-` is NOT, `"` opens a
# phrase, `*` is a prefix and `:` is a column filter. A reader typing
# "Israel-Palestine" or "100%" means those literally, so the query is rebuilt
# from its words rather than passed through.
_WORD = re.compile(r"[^\W_]+", re.UNICODE)


def to_match_query(term: str) -> str:
    """
    Turn what someone typed into an FTS5 MATCH expression.

    Quoted runs are kept as phrases, because that is what quoting means to
    everyone. Everything else becomes an AND of prefix-matched words, so
    "sanction" finds "sanctions" and a two-word query narrows rather than
    widens.
    """
    term = (term or "").strip()
    if not term:
        return ""

    parts: list[str] = []
    for phrase in re.findall(r'"([^"]+)"', term):
        words = _WORD.findall(phrase)
        if words:
            parts.append('"' + " ".join(words) + '"')

    remainder = re.sub(r'"[^"]*"', " ", term)
    for word in _WORD.findall(remainder):
        # Single characters match nearly everything and cost the most.
        if len(word) > 1:
            parts.append(f'"{word}"*')

    return " AND ".join(parts)


def ranked_ids(db: Session, term: str, limit: int = MAX_MATCHES) -> list[int] | None:
    """
    Article ids for `term`, best first.

    Returns None when full-text search is unavailable, which tells the caller
    to fall back rather than to treat it as "no results".
    """
    if not is_available(db):
        return None

    match = to_match_query(term)
    if not match:
        return None

    try:
        rows = db.execute(
            text(
                f"SELECT rowid FROM {FTS_TABLE} WHERE {FTS_TABLE} MATCH :m "
                f"ORDER BY bm25({FTS_TABLE}, 10.0, 1.0) LIMIT :lim"
            ),
            {"m": match, "lim": limit},
        ).fetchall()
    except Exception as e:
        # A malformed expression must degrade to the old search, not 500.
        logger.warning("[SEARCH] full-text query failed for %r: %s", term, e)
        return None

    return [int(r[0]) for r in rows]
