"""
GNews API service — secondary news source for geopolitical intelligence.

Fetches articles from https://gnews.io/api/v4/search and normalizes them
into the same format used by the NewsAPI pipeline so they can be merged
directly into the existing process_and_store loop.
"""
import os
import requests


def fetch_gnews(query: str, country_code: str = None, max_results: int = 10) -> list[dict]:
    """
    Fetch articles from GNews API and return them in NewsAPI-compatible format.

    Args:
        query: Search query string
        country_code: ISO 2-letter country code (e.g. "us", "in")
        max_results: Number of articles to fetch (max 10 on free tier)

    Returns:
        List of article dicts matching the NewsAPI structure:
        {title, description, url, source: {name}, publishedAt}
    """
    api_key = os.getenv("GNEWS_API_KEY")
    if not api_key:
        print("  ⚠️ GNEWS_API_KEY not set — skipping GNews")
        return []

    params = {
        "q": query,
        "lang": "en",
        "max": max_results,
        "apikey": api_key,
    }

    # GNews supports country filter natively
    if country_code:
        params["country"] = country_code.lower()

    try:
        response = requests.get(
            "https://gnews.io/api/v4/search",
            params=params,
            timeout=15,
        )
        print(f"  [NET] GNews response: {response.status_code}")

        if response.status_code != 200:
            print(f"  [ERR] GNews error: {response.status_code} {response.text[:200]}")
            return []

    except requests.exceptions.RequestException as e:
        print(f"  [ERR] GNews request failed: {e}")
        return []

    data = response.json()
    raw_articles = data.get("articles", [])
    print(f"  [NET] GNews articles received: {len(raw_articles)}")

    # ── Normalize to NewsAPI format ──────────────────────
    normalized = []
    for item in raw_articles:
        normalized.append({
            "title": item.get("title"),
            "description": item.get("description"),
            "url": item.get("url"),
            "publishedAt": item.get("publishedAt"),
            "source": {
                "name": (item.get("source", {}).get("name") or "Unknown") + " (GNews)"
            },
        })

    return normalized
