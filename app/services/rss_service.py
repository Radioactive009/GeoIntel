"""
RSS ingestion.

Previously this module was effectively dead: main.py passed the full boolean
query (``"United Arab Emirates" OR "..." OR AE``) as ``country_query`` and the
filter did a plain substring test of that whole string against the article
text, so it matched nothing. Zero RSS articles ever reached the database.

RSS is now the primary source, because it is free, unlimited and keyless:

  * ``fetch_global_rss()``  — wire feeds from major international outlets.
  * ``fetch_country_rss()`` — a Google News search feed per country, which
    gives real per-country coverage without an API quota.

Country attribution is no longer done here; ``country_resolver`` reads it from
the article text after ingestion.
"""

from __future__ import annotations

import concurrent.futures as futures
import logging
import threading
import time
from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.parse import quote_plus

import feedparser
import requests

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 12
MAX_ENTRIES_PER_FEED = 25
USER_AGENT = (
    "Mozilla/5.0 (compatible; GeoIntelBot/1.0; +https://github.com/Radioactive009/GeoIntel)"
)

GLOBAL_CACHE_TTL = 300      # 5 minutes
COUNTRY_CACHE_TTL = 1800    # 30 minutes

# Verified reachable. The old Reuters agency feed 301-redirects to an empty
# document and the rsshub AP mirror returns 403, so both were dropped.
RSS_FEEDS = [
    {"name": "BBC World", "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    {"name": "Al Jazeera", "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "The Guardian World", "url": "https://www.theguardian.com/world/rss"},
    {"name": "France 24", "url": "https://www.france24.com/en/rss"},
    {"name": "Deutsche Welle", "url": "https://rss.dw.com/rdf/rss-en-world"},
    # UN News was dropped: news.un.org now 404s on every published feed path.
    {"name": "Channel News Asia", "url": "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml"},
    {"name": "Sky News World", "url": "https://feeds.skynews.com/feeds/rss/world.xml"},
    {"name": "The Hindu", "url": "https://www.thehindu.com/news/national/feeder/default.rss"},
    {"name": "Times of India World", "url": "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms"},
    {"name": "TASS", "url": "https://tass.com/rss/v2.xml"},
    {"name": "NDTV World", "url": "https://feeds.feedburner.com/ndtvnews-world-news"},
    {"name": "Jerusalem Post", "url": "https://www.jpost.com/rss/rssfeedsfrontpage.aspx"},
    {"name": "Google News World", "url": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en"},
]

# Terms appended to each country's Google News query to keep the feed on topic.
COUNTRY_FEED_TERMS = "politics OR war OR conflict OR sanctions OR diplomacy OR military OR crisis"

_global_cache: dict = {"articles": [], "fetched_at": 0.0}
_global_lock = threading.Lock()

_country_cache: dict[str, dict] = {}
_country_lock = threading.Lock()


# ─────────────────────────────────────────────────────────
# PARSING HELPERS
# ─────────────────────────────────────────────────────────
def _parse_date(entry) -> str | None:
    """Extract an ISO date string from an RSS entry."""
    raw = entry.get("published") or entry.get("updated")
    if raw:
        try:
            return parsedate_to_datetime(raw).isoformat()
        except Exception:
            pass
    parsed = entry.get("published_parsed") or entry.get("updated_parsed")
    if parsed:
        try:
            return datetime(*parsed[:6]).isoformat()
        except Exception:
            pass
    return None


def _clean_summary(entry) -> str:
    """RSS summaries often carry markup; strip it down to plain text."""
    raw = entry.get("summary") or entry.get("description") or ""
    if not raw:
        return ""
    import re
    text = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", text).strip()


def _publisher_name(entry, fallback: str) -> str:
    """
    Google News wraps the real outlet: the title reads "Headline - Publisher"
    and the publisher is repeated in <source>. Prefer the real outlet name so
    sources stay meaningful.
    """
    source = entry.get("source")
    if isinstance(source, dict):
        title = source.get("title")
        if title:
            return title.strip()
    return fallback


def _clean_google_title(title: str, publisher: str) -> str:
    if publisher and title.endswith(f" - {publisher}"):
        return title[: -len(f" - {publisher}")].strip()
    return title


def _fetch_feed(url: str):
    """Fetch a feed with a hard timeout; feedparser alone has none."""
    response = requests.get(
        url,
        timeout=REQUEST_TIMEOUT,
        headers={"User-Agent": USER_AGENT, "Accept": "application/rss+xml, application/xml, text/xml, */*"},
    )
    response.raise_for_status()
    return feedparser.parse(response.content)


def _entries_to_articles(feed, feed_name: str, is_google: bool) -> list[dict]:
    articles = []
    for entry in feed.entries[:MAX_ENTRIES_PER_FEED]:
        link = entry.get("link")
        title = entry.get("title", "")
        if not link or not title:
            continue

        publisher = _publisher_name(entry, feed_name) if is_google else feed_name
        if is_google:
            title = _clean_google_title(title, publisher)

        articles.append({
            "title": title,
            "description": _clean_summary(entry),
            "url": link,
            "publishedAt": _parse_date(entry),
            "source": {"name": publisher},
            "provider": "rss",
        })
    return articles


def _collect(feed_configs: list[dict]) -> list[dict]:
    """Fetch several feeds concurrently; a bad feed never blocks the rest."""
    collected: list[dict] = []

    def work(cfg: dict) -> list[dict]:
        try:
            feed = _fetch_feed(cfg["url"])
        except Exception as e:
            logger.warning("  [WARN] RSS fetch failed for %s: %s", cfg["name"], e)
            return []
        items = _entries_to_articles(feed, cfg["name"], cfg.get("is_google", False))
        if items:
            logger.info("  [RSS] %s: %s articles", cfg["name"], len(items))
        return items

    with futures.ThreadPoolExecutor(max_workers=8) as pool:
        for items in pool.map(work, feed_configs):
            collected.extend(items)

    return collected


# ─────────────────────────────────────────────────────────
# PUBLIC API
# ─────────────────────────────────────────────────────────
def fetch_global_rss() -> list[dict]:
    """
    Wire feeds from major international outlets, cached for 5 minutes.

    The lock guards the cache dict only — it is deliberately released across
    the network fetch. Holding it through ``_collect`` serialised every caller
    behind a full round of feed timeouts, so a manual refresh could sit idle
    for the length of a scheduled one. The cost is that two callers arriving
    on a cold cache may both fetch; that is cheaper than blocking, and the
    second one's result simply replaces the first.
    """
    now = time.time()
    with _global_lock:
        if now - _global_cache["fetched_at"] <= GLOBAL_CACHE_TTL and _global_cache["articles"]:
            logger.debug("[CACHE] Global RSS cache hit")
            return list(_global_cache["articles"])

    logger.info("[NET] Refreshing global RSS feeds...")
    articles = _collect(RSS_FEEDS)
    logger.info("[RSS] Global total: %s articles", len(articles))

    with _global_lock:
        if articles:
            _global_cache["articles"] = articles
            _global_cache["fetched_at"] = now
        # Every feed failing (offline host) falls back to the last good set.
        return list(articles or _global_cache["articles"])


def fetch_country_rss(country_name: str) -> list[dict]:
    """
    Google News search feed for one country, cached for 30 minutes.

    This is the only source that gives real per-country coverage without an
    API key or quota.
    """
    if not country_name:
        return []

    key = country_name.lower()
    now = time.time()

    with _country_lock:
        cached = _country_cache.get(key)
        if cached and now - cached["fetched_at"] <= COUNTRY_CACHE_TTL:
            return list(cached["articles"])

    query = quote_plus(f'"{country_name}" ({COUNTRY_FEED_TERMS})')
    url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"
    articles = _collect([{"name": f"Google News {country_name}", "url": url, "is_google": True}])

    with _country_lock:
        _country_cache[key] = {"articles": articles, "fetched_at": now}

    return articles


def fetch_rss(country_name: str | None = None) -> list[dict]:
    """
    Backwards-compatible entry point.

    Returns the global feed set, plus the country feed when a country name is
    given. Callers must pass a plain country name — passing a boolean query
    string is what silently broke the previous implementation.
    """
    articles = fetch_global_rss()
    if country_name:
        articles = articles + fetch_country_rss(country_name)
    return articles
