import feedparser
import logging
from datetime import datetime
from email.utils import parsedate_to_datetime

# =========================================================
# LOGGING SETUP
# =========================================================
logger = logging.getLogger(__name__)

# ── Global RSS feed sources ──────────────────────────────
RSS_FEEDS = [
    {"name": "BBC World",       "url": "https://feeds.bbci.co.uk/news/world/rss.xml"},
    {"name": "Reuters World",   "url": "https://www.reutersagency.com/feed/?taxonomy=best-sectors&post_type=best"},
    {"name": "Al Jazeera",      "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "The Hindu",       "url": "https://www.thehindu.com/news/national/feeder/default.rss"},
    {"name": "TASS",            "url": "https://tass.com/rss/v2.xml"},
    {"name": "NDTV World",      "url": "https://feeds.feedburner.com/ndtvnews-world-news"},
]

# ── Google News RSS sources (Country-specific) ──────────
GOOGLE_NEWS_RSS = [
    {"name": "Google News US",    "url": "https://news.google.com/rss/search?q=United+States+geopolitics", "is_google": True},
    {"name": "Google News India", "url": "https://news.google.com/rss/search?q=India+politics+war", "is_google": True},
    {"name": "Google News China", "url": "https://news.google.com/rss/search?q=China+geopolitics", "is_google": True},
    {"name": "Google News Russia","url": "https://news.google.com/rss/search?q=Russia+conflict", "is_google": True},
    {"name": "Google News Iran",  "url": "https://news.google.com/rss/search?q=Iran+sanctions", "is_google": True},
]

# Combine all feeds
ALL_RSS_FEEDS = RSS_FEEDS + GOOGLE_NEWS_RSS


def _parse_date(entry) -> str | None:
    """Try to extract an ISO date string from an RSS entry."""
    raw = entry.get("published") or entry.get("updated") or None
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        return dt.isoformat()
    except Exception:
        pass
    # feedparser sometimes pre-parses into a struct
    if hasattr(entry, "published_parsed") and entry.published_parsed:
        try:
            dt = datetime(*entry.published_parsed[:6])
            return dt.isoformat()
        except Exception:
            pass
    return None


def fetch_rss(country_query: str = None) -> list[dict]:
    """
    Fetch articles from all configured RSS feeds (including Google News RSS)
    and return them in NewsAPI-compatible format.

    Args:
        country_query: Optional country name/keyword to filter entries
                       (case-insensitive match in title+summary).

    Returns:
        List of article dicts: {title, description, url, source, publishedAt}
    """
    all_articles = []
    google_articles_count = 0
    query_lower = country_query.lower() if country_query else None

    logger.info("📡 Starting RSS ingestion (including Google RSS)...")

    for feed_cfg in ALL_RSS_FEEDS:
        feed_name = feed_cfg["name"]
        is_google = feed_cfg.get("is_google", False)

        if is_google and google_articles_count == 0:
            logger.info("📡 Google RSS ingestion running...")

        try:
            feed = feedparser.parse(feed_cfg["url"])
        except Exception as e:
            logger.warning(f"  ⚠️ RSS parse failed for {feed_name}: {e}")
            continue

        count = 0
        for entry in feed.entries[:15]:  # cap per feed
            title = entry.get("title", "")
            summary = entry.get("summary", entry.get("description", ""))
            link = entry.get("link", "")

            if not link:
                continue

            # Optional country filter — skip non-matching entries
            if query_lower:
                combined = (title + " " + summary).lower()
                if query_lower not in combined:
                    continue

            source_name = f"{feed_name} (Google RSS)" if is_google else f"{feed_name} (RSS)"

            all_articles.append({
                "title": title,
                "description": summary,
                "url": link,
                "publishedAt": _parse_date(entry),
                "source": {"name": source_name},
            })
            count += 1
            if is_google:
                google_articles_count += 1

        if count > 0:
            logger.info(f"  📡 RSS {feed_name}: {count} articles")

    logger.info(f"✅ Google RSS total: {google_articles_count} articles fetched")
    logger.info(f"✅ RSS combined total: {len(all_articles)} articles")
    
    return all_articles
