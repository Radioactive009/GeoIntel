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
import re
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
    {"name": "The Hindu International", "url": "https://www.thehindu.com/news/international/feeder/default.rss"},
    {"name": "Times of India World", "url": "https://timesofindia.indiatimes.com/rssfeeds/296589292.cms"},
    {"name": "Indian Express World", "url": "https://indianexpress.com/section/world/feed/"},
    # PIB was wanted here — it is the primary record of what the Indian
    # government actually said, rather than a report of it. Its RSS serves
    # Hindi from every working parameter combination (Lang is ignored, and
    # every Regid but 3 returns nothing), and Hindi headlines would defeat a
    # classifier and a resolver that both work on English keywords.
    {"name": "TASS", "url": "https://tass.com/rss/v2.xml"},
    {"name": "NDTV World", "url": "https://feeds.feedburner.com/ndtvnews-world-news"},
    {"name": "Jerusalem Post", "url": "https://www.jpost.com/rss/rssfeedsfrontpage.aspx"},
    {"name": "Google News World", "url": "https://news.google.com/rss/headlines/section/topic/WORLD?hl=en-US&gl=US&ceid=US:en"},
]

# Constructive-journalism outlets, fetched so the uplifting section has
# something to show. A geopolitics corpus does not supply it on its own —
# measured across 5,218 stored articles, under 2% read as uplifting, and the
# few that scored highest were misreadings ("Young girl finds whale stranded
# on Australian beach"). Without these feeds the section would be a promise
# the pipeline could not keep.
#
# The Guardian's "Upside" series feed 404s and a Google News search for
# "good news" returns commentary about the phrase rather than good news, so
# neither is included.
UPLIFTING_FEEDS = [
    {"name": "Good News Network", "url": "https://www.goodnewsnetwork.org/feed/"},
    {"name": "Positive News", "url": "https://www.positive.news/feed/"},
    {"name": "Reasons to be Cheerful", "url": "https://reasonstobecheerful.world/feed/"},
    {"name": "Optimist Daily", "url": "https://www.optimistdaily.com/feed/"},
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
    text = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", text).strip()


def _widest(candidates: list[dict]) -> str | None:
    """Pick the largest declared variant; feeds often list several sizes."""
    best, best_width = None, -1
    for item in candidates:
        url = (item.get("url") or "").strip()
        if not url:
            continue
        try:
            width = int(item.get("width") or 0)
        except (TypeError, ValueError):
            width = 0
        if width > best_width:
            best, best_width = url, width
    return best


def _upscale(url: str) -> str:
    """
    Ask known CDNs for a larger rendition.

    BBC advertises a 240px-wide thumbnail, which is visibly soft in a card
    roughly 400px across. The width is a path segment on ichef, so a bigger
    one can simply be requested; anything unrecognised is returned untouched,
    and a bad guess degrades to the card's placeholder rather than breaking.
    """
    return re.sub(r"(ichef\.bbci\.co\.uk/[^ ]*?/)(?:2\d{2}|1\d{2})(/)", r"\g<1>800\g<2>", url)


def _extract_image(entry) -> str | None:
    """
    Best available image for an entry, or None.

    Feeds disagree about where this lives — media:content, media:thumbnail, an
    enclosure, a typed link, or an <img> inside the summary HTML — so each is
    tried in turn. Google News carries none of them, which is why the card has
    to render without one.
    """
    for key in ("media_content", "media_thumbnail"):
        value = entry.get(key)
        if isinstance(value, list):
            url = _widest(value)
            if url:
                return _upscale(url)

    for link in list(entry.get("links") or []) + list(entry.get("enclosures") or []):
        if str(link.get("type", "")).startswith("image"):
            url = (link.get("href") or link.get("url") or "").strip()
            if url:
                return _upscale(url)

    html = entry.get("summary") or entry.get("description") or ""
    if not html and isinstance(entry.get("content"), list) and entry["content"]:
        html = entry["content"][0].get("value") or ""
    match = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', html)
    if match:
        url = match.group(1).strip()
        # Skip the 1x1 beacons some feeds embed alongside real artwork.
        if url and not re.search(r"[?&](?:w|width)=1(?:&|$)", url):
            return _upscale(url)

    return None


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
            "image": _extract_image(entry),
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


_uplifting_cache: dict = {"articles": [], "fetched_at": 0.0}


def fetch_uplifting_rss() -> list[dict]:
    """Constructive-journalism feeds, cached like the global set."""
    now = time.time()
    with _global_lock:
        cached = _uplifting_cache
        if now - cached["fetched_at"] <= GLOBAL_CACHE_TTL and cached["articles"]:
            return list(cached["articles"])

    articles = _collect(UPLIFTING_FEEDS)
    logger.info("[RSS] Uplifting feeds: %s articles", len(articles))

    with _global_lock:
        if articles:
            _uplifting_cache["articles"] = articles
            _uplifting_cache["fetched_at"] = now
        return list(articles or _uplifting_cache["articles"])


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
