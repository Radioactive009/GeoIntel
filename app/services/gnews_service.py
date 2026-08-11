"""
GNews API service — secondary news source for geopolitical intelligence.

Fetches articles from https://gnews.io/api/v4/search and normalises them into
the same shape used by the NewsAPI pipeline so they can be merged directly.

Note: the free plan serves news on a 12-hour delay and allows 100 requests per
day, so this is a supplement to the keyless RSS pipeline rather than the
primary source.
"""

from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

GNEWS_TIMEOUT = 15


def fetch_gnews(query: str, country_code: str | None = None, max_results: int = 10) -> list[dict]:
    """
    Fetch articles from GNews and return them in NewsAPI-compatible format.

    Args:
        query: Search query string
        country_code: ISO 2-letter country code (e.g. "us", "in")
        max_results: Number of articles to fetch (max 10 on the free tier)

    Returns:
        List of dicts: {title, description, url, source: {name}, publishedAt, provider}
    """
    api_key = os.getenv("GNEWS_API_KEY")
    if not api_key:
        logger.debug("  GNEWS_API_KEY not set - skipping GNews")
        return []

    params = {
        "q": query,
        "lang": "en",
        "max": max_results,
        "apikey": api_key,
    }
    if country_code:
        params["country"] = country_code.lower()

    try:
        response = requests.get(
            "https://gnews.io/api/v4/search",
            params=params,
            timeout=GNEWS_TIMEOUT,
        )
        if response.status_code != 200:
            # 403 here usually means the daily quota is spent.
            logger.warning("  [ERR] GNews %s: %s", response.status_code, response.text[:160])
            return []
    except requests.exceptions.RequestException as e:
        logger.warning("  [ERR] GNews request failed: %s", e)
        return []

    try:
        raw_articles = response.json().get("articles", [])
    except ValueError:
        logger.warning("  [ERR] GNews returned a non-JSON body")
        return []

    normalized = [
        {
            "title": item.get("title"),
            "description": item.get("description"),
            "url": item.get("url"),
            "publishedAt": item.get("publishedAt"),
            "source": {"name": (item.get("source") or {}).get("name") or "Unknown"},
            "provider": "gnews",
        }
        for item in raw_articles
    ]
    logger.info("  [NET] GNews: %s articles", len(normalized))
    return normalized
