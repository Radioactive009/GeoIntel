"""
Live news channel resolution.

Embeds official broadcaster 24/7 streams via YouTube's iframe player. Two
things were established by testing before this was written:

  * ``/embed/live_stream?channel=<UC id>`` is unreliable — only 4 of 10 major
    channels played, and it resolved Al Jazeera English to an unrelated
    stream. Resolving the *current live video id* first and embedding
    ``/embed/<video id>`` played 6 of 7.
  * A page cannot detect a failed embed: the iframe is cross-origin and opaque
    to the parent. Liveness therefore has to be resolved server-side and
    stored, which is what ``refresh_channels`` does.

Channel IDs are never hardcoded — they are resolved from the channel handle at
seed time, because a recalled ID is silently wrong (a wrong ID renders
"video unavailable" rather than erroring).

Two resolution paths:
  * YouTube Data API v3 when ``YOUTUBE_API_KEY`` is set — authoritative, and
    reports ``status.embeddable`` directly.
  * A keyless fallback otherwise, using the public ``/live`` canonical URL plus
    the oEmbed endpoint as an embeddability check.
"""

from __future__ import annotations

import concurrent.futures as futures
import logging
import os
import re
from datetime import datetime, timedelta

import requests
from sqlalchemy.orm import Session

from .. import models

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT = 20
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)
HEADERS = {"User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9"}

YOUTUBE_API = "https://www.googleapis.com/youtube/v3"

# How stale a liveness record may be before the scheduler refreshes it.
CHANNEL_REFRESH_MINUTES = max(5, int(os.getenv("CHANNEL_REFRESH_MINUTES", "30")))

# search.list costs 100 quota units against a 10,000/day free allowance.
# A per-refresh cap is not a real bound (it scales with the refresh interval),
# so spending is tracked against a per-UTC-day budget persisted in the DB.
# 40 searches = 4,000 units, leaving plenty of headroom for the 1-unit
# videos.list calls that do the actual verification.
SEARCH_BUDGET_PER_DAY = max(0, int(os.getenv("YOUTUBE_SEARCH_DAILY_BUDGET", "40")))
SEARCH_BUDGET_PER_REFRESH = max(0, int(os.getenv("YOUTUBE_SEARCH_BUDGET", "4")))
_BUDGET_KEY = "youtube_search_budget"


def _budget_state(db: Session) -> tuple[str, int]:
    """(utc_date, searches_used_today) from the system_state table."""
    today = datetime.utcnow().strftime("%Y-%m-%d")
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    if not row or not row.value or ":" not in row.value:
        return today, 0
    day, _, used = row.value.partition(":")
    if day != today:
        return today, 0  # new UTC day resets the allowance
    try:
        return today, int(used)
    except ValueError:
        return today, 0


def _record_searches(db: Session, count: int) -> None:
    if count <= 0:
        return
    today, used = _budget_state(db)
    row = db.query(models.SystemState).filter(models.SystemState.key == _BUDGET_KEY).first()
    value = f"{today}:{used + count}"
    if row:
        row.value = value
    else:
        db.add(models.SystemState(key=_BUDGET_KEY, value=value))
    db.commit()


def api_key() -> str | None:
    return os.getenv("YOUTUBE_API_KEY") or None


# ─────────────────────────────────────────────────────────
# SEED CATALOG
#
# Handles, not IDs — IDs are resolved at seed time and verified. A handle that
# no longer resolves is skipped with a warning rather than failing the seed.
# ─────────────────────────────────────────────────────────
SEED_CHANNELS = [
    # (display name, youtube handle, ISO alpha-2, language)
    # Handles below were vetted with `preview_handle` — each one resolved and
    # was observed running an embeddable live stream. Channels that resolve but
    # rarely stream (CNBC, NBC News, CTV) are deliberately left out: they would
    # sit permanently offline in the rail.
    ("Al Jazeera English", "aljazeeraenglish", "QA", "en"),
    ("France 24 English", "France24_en", "FR", "en"),
    ("DW News", "dwnews", "DE", "en"),
    ("Sky News", "SkyNews", "GB", "en"),
    ("Reuters", "Reuters", "GB", "en"),
    ("GB News", "GBNewsOnline", "GB", "en"),
    ("ABC News (Australia)", "abcnewsaustralia", "AU", "en"),
    ("NDTV", "ndtv", "IN", "en"),
    ("WION", "WION", "IN", "en"),
    ("India Today", "IndiaToday", "IN", "en"),
    ("Times Now", "TimesNow", "IN", "en"),
    ("Firstpost", "Firstpost", "IN", "en"),
    ("CNN News18", "CNNnews18", "IN", "en"),
    ("Aaj Tak", "aajtak", "IN", "hi"),
    ("Zee News", "ZeeNews", "IN", "hi"),
    ("Republic World", "RepublicWorld", "IN", "en"),
    ("TRT World", "trtworld", "TR", "en"),
    ("CNA", "channelnewsasia", "SG", "en"),
    ("Euronews", "euronews", "BE", "en"),
    ("Bloomberg Television", "markets", "US", "en"),
    ("ABC News (US)", "ABCNews", "US", "en"),
    ("CBS News", "CBSNews", "US", "en"),
    ("Global News", "globalnews", "CA", "en"),
    ("CBC News", "cbcnews", "CA", "en"),
    ("NHK World-Japan", "nhkworldjapan", "JP", "en"),
    ("CGTN", "CGTN", "CN", "en"),
    ("TVBS News", "TVBSNEWS01", "TW", "zh"),
    ("Africanews", "africanews", "KE", "en"),
    ("Citizen TV Kenya", "CitizenTVKenya", "KE", "en"),
    ("Arise News", "AriseNewsChannel", "NG", "en"),
    ("eNCA", "eNCAnews", "ZA", "en"),
    ("TVP World", "TVPWorld", "PL", "en"),
    ("Al Arabiya", "AlArabiyaEnglish", "AE", "ar"),
    ("Sky News Arabia", "skynewsarabia", "AE", "ar"),
    ("ANC 24/7", "ANCalerts", "PH", "en"),
    ("GMA Integrated News", "gmanews", "PH", "en"),
    ("RTVE Noticias", "rtvenoticias", "ES", "es"),
    ("Milenio", "milenio", "MX", "es"),
]


# ─────────────────────────────────────────────────────────
# RESOLUTION HELPERS
# ─────────────────────────────────────────────────────────
def _resolve_channel_id_api(handle: str, key: str) -> str | None:
    """channels.list?forHandle — 1 quota unit, authoritative, works from any IP."""
    try:
        response = requests.get(
            f"{YOUTUBE_API}/channels",
            params={"part": "id", "forHandle": handle, "key": key},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            logger.warning("  [WARN] channels.list %s for @%s: %s",
                           response.status_code, handle, response.text[:120])
            return None
        items = response.json().get("items", [])
        return items[0]["id"] if items else None
    except (requests.RequestException, ValueError, KeyError, IndexError):
        return None


def _resolve_channel_id_scrape(handle: str) -> str | None:
    """
    Fallback for when no API key is configured.

    Order matters. The page HTML contains a `"channelId"` for every channel it
    references — recommendations, shelf items, related channels — and the first
    match is frequently NOT the page's owner. That mis-resolved Al Jazeera
    English to Al Jazeera Arabic. The canonical link and `externalId` both
    identify the page owner, so they are tried first and bare `channelId` is
    used only as a last resort.
    """
    try:
        response = requests.get(
            f"https://www.youtube.com/@{handle}", headers=HEADERS, timeout=REQUEST_TIMEOUT
        )
    except requests.RequestException as e:
        logger.warning("  [WARN] Channel lookup failed for @%s: %s", handle, e)
        return None
    if response.status_code != 200:
        logger.warning("  [WARN] Channel @%s returned %s", handle, response.status_code)
        return None

    html = response.text
    for pattern in (
        r'<link rel="canonical" href="https://www\.youtube\.com/channel/(UC[\w-]{22})"',
        r'"externalId":"(UC[\w-]{22})"',
        r'"channelId":"(UC[\w-]{22})"',
    ):
        match = re.search(pattern, html)
        if match:
            return match.group(1)
    return None


def resolve_channel_id(handle: str) -> str | None:
    """
    Resolve a @handle to its UC... channel id.

    Prefers the Data API: it is authoritative, costs 1 quota unit, and — unlike
    scraping — is not blocked from datacenter IPs, which is what makes channel
    seeding work on a host like Render.
    """
    handle = (handle or "").strip().lstrip("@")
    if not handle:
        return None

    key = api_key()
    if key:
        resolved = _resolve_channel_id_api(handle, key)
        if resolved:
            return resolved
        logger.info("  [CHANNEL] API could not resolve @%s, falling back to page lookup", handle)

    return _resolve_channel_id_scrape(handle)


def _keyless_live_video(channel_id: str) -> tuple[str | None, str | None]:
    """
    Resolve the channel's current live video without an API key.

    A live channel's /live page canonicalises to the watch URL of the running
    stream; when nothing is live there is no canonical watch URL.
    """
    try:
        response = requests.get(
            f"https://www.youtube.com/channel/{channel_id}/live",
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException:
        return None, None
    if response.status_code != 200:
        return None, None

    match = re.search(
        r'<link rel="canonical" href="https://www\.youtube\.com/watch\?v=([\w-]{11})"',
        response.text,
    )
    if not match:
        return None, None
    return match.group(1), None


def _oembed_check(video_id: str) -> tuple[bool, str | None]:
    """oEmbed returns 200 only for embeddable videos — our keyless embed test."""
    try:
        response = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
    except requests.RequestException:
        return False, None
    if response.status_code != 200:
        return False, None
    try:
        return True, (response.json().get("title") or "")[:200]
    except ValueError:
        return True, None


def _resolve_keyless(channel_id: str) -> dict:
    video_id, _ = _keyless_live_video(channel_id)
    if not video_id:
        return {"is_live": False, "video_id": None, "title": None}
    embeddable, title = _oembed_check(video_id)
    return {
        "is_live": embeddable,   # not embeddable == unusable for us
        "video_id": video_id if embeddable else None,
        "title": title,
    }


def _videos_list(video_ids: list[str], key: str) -> dict[str, dict]:
    """videos.list — 1 quota unit per call, up to 50 ids per call."""
    details: dict[str, dict] = {}
    for start in range(0, len(video_ids), 50):
        chunk = video_ids[start:start + 50]
        try:
            response = requests.get(
                f"{YOUTUBE_API}/videos",
                params={"part": "snippet,status", "id": ",".join(chunk), "key": key},
                timeout=REQUEST_TIMEOUT,
            )
            if response.status_code != 200:
                logger.warning("  [WARN] YouTube videos.list %s: %s",
                               response.status_code, response.text[:140])
                continue
            for item in response.json().get("items", []):
                details[item["id"]] = item
        except (requests.RequestException, ValueError) as e:
            logger.warning("  [WARN] YouTube videos.list failed: %s", e)
    return details


def _search_live(channel_id: str, key: str) -> str | None:
    """search.list — 100 quota units. Used only when discovery finds nothing."""
    try:
        response = requests.get(
            f"{YOUTUBE_API}/search",
            params={"part": "id", "channelId": channel_id, "eventType": "live",
                    "type": "video", "maxResults": 1, "key": key},
            timeout=REQUEST_TIMEOUT,
        )
        if response.status_code != 200:
            logger.warning("  [WARN] YouTube search %s: %s",
                           response.status_code, response.text[:140])
            return None
        items = response.json().get("items", [])
        return items[0]["id"]["videoId"] if items else None
    except (requests.RequestException, ValueError, KeyError):
        return None


def _resolve_via_api(db: Session, channel_rows, key: str) -> dict[str, dict]:
    """
    Authoritative resolution that stays inside the free quota.

    Naively calling search.list per channel costs 100 units each — for ~20
    channels every 30 minutes that is ~91,000 units/day against a 10,000/day
    allowance, so it would fail within hours. Instead:

      1. Discover the current live video id with the *keyless* page lookup
         (free, and measured to find streams the API search also finds).
      2. Verify liveness and embeddability with one batched videos.list
         (1 unit per 50 ids) — this is the part worth spending quota on,
         because `status.embeddable` is not otherwise observable.
      3. Fall back to search.list only for channels discovery missed, hard
         capped per refresh so a bad day cannot drain the quota.

    Steady-state cost is ~1-2 units per refresh instead of ~1,900.
    """
    results = {
        c.youtube_channel_id: {"is_live": False, "video_id": None, "title": None}
        for c in channel_rows
    }

    # 1. Free discovery via the public page.
    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        discovered = dict(zip(
            [c.youtube_channel_id for c in channel_rows],
            pool.map(lambda c: _keyless_live_video(c.youtube_channel_id)[0], channel_rows),
        ))

    # Fall back to the id we already know about. This is what lets the system
    # work on a host where page scraping is blocked (cloud IPs are commonly
    # served a consent wall): without it, every refresh re-discovers from
    # scratch, so only the handful of channels covered by the search budget
    # could ever be live, and they would flip between refreshes. 24/7 streams
    # keep the same video id for a long time, and verifying a cached id costs
    # nothing extra — it rides along in the same batched videos.list call.
    scraped = sum(1 for v in discovered.values() if v)
    for channel in channel_rows:
        if not discovered.get(channel.youtube_channel_id) and channel.live_video_id:
            discovered[channel.youtube_channel_id] = channel.live_video_id
    if not scraped and channel_rows:
        logger.warning(
            "[CHANNEL] Page discovery found nothing for any channel — this host is likely "
            "blocked from youtube.com; relying on cached ids and the API search budget."
        )

    # 2. One batched, authoritative check.
    candidates = [vid for vid in discovered.values() if vid]
    details = _videos_list(sorted(set(candidates)), key) if candidates else {}

    def apply(channel_id: str, video_id: str | None) -> bool:
        item = details.get(video_id) if video_id else None
        if not item:
            return False
        live = item.get("snippet", {}).get("liveBroadcastContent") == "live"
        embeddable = item.get("status", {}).get("embeddable", False)
        usable = bool(live and embeddable)
        results[channel_id] = {
            "is_live": usable,
            "video_id": video_id if usable else None,
            "title": (item.get("snippet", {}).get("title") or "")[:200],
        }
        return usable

    missed = [c for c in channel_rows if not apply(c.youtube_channel_id, discovered.get(c.youtube_channel_id))]

    # 3. Bounded fallback, limited by both a per-refresh cap and a per-day one.
    #
    # On a cold database (fresh deploy, or a host with an ephemeral disk) there
    # are no cached ids to fall back on, so a small per-refresh cap would take
    # many cycles to populate the rail. Allow the first fill to use the whole
    # remaining daily allowance — it is still hard-bounded, and afterwards
    # cheap verification keeps the streams alive.
    _, used_today = _budget_state(db)
    cold_start = not any(c.live_video_id for c in channel_rows)
    per_refresh_cap = SEARCH_BUDGET_PER_DAY if cold_start else SEARCH_BUDGET_PER_REFRESH
    if cold_start:
        logger.info("[CHANNEL] Cold start - allowing a larger one-off discovery burst")
    budget = min(per_refresh_cap, max(0, SEARCH_BUDGET_PER_DAY - used_today))
    searches = 0
    retry_ids = []
    for channel in missed:
        if searches >= budget:
            break
        video_id = _search_live(channel.youtube_channel_id, key)
        searches += 1
        if video_id:
            retry_ids.append((channel.youtube_channel_id, video_id))

    if retry_ids:
        details.update(_videos_list([vid for _, vid in retry_ids], key))
        for channel_id, video_id in retry_ids:
            apply(channel_id, video_id)

    _record_searches(db, searches)
    spent = 1 + searches * 100 + (1 if retry_ids else 0)
    logger.info(
        "[CHANNEL] API refresh ~%s quota units (%s searches; %s/%s used today of 10,000/day allowance)",
        spent, searches, used_today + searches, SEARCH_BUDGET_PER_DAY,
    )
    return results


# ─────────────────────────────────────────────────────────
# SEEDING + REFRESH
# ─────────────────────────────────────────────────────────
def seed_channels(db: Session) -> int:
    """Create channel rows, resolving each handle to a verified channel id."""
    rows = db.query(models.Channel).all()
    existing_handles = {c.handle for c in rows}
    # Different handles can resolve to the same channel (YouTube redirects
    # renamed handles), so dedupe on the resolved id too — otherwise the whole
    # seed transaction dies on a UNIQUE violation.
    seen_ids = {c.youtube_channel_id for c in rows}

    pending = [c for c in SEED_CHANNELS if c[1] not in existing_handles]
    if not pending:
        return 0

    iso_to_id = {
        iso: cid for cid, iso in db.query(models.Country.id, models.Country.iso_code).all()
    }

    def work(entry):
        return entry, resolve_channel_id(entry[1])

    created = 0
    with futures.ThreadPoolExecutor(max_workers=6) as pool:
        for (name, handle, iso, language), channel_id in pool.map(work, pending):
            if not channel_id:
                logger.warning("[CHANNEL] Could not resolve @%s - skipped", handle)
                continue
            if channel_id in seen_ids:
                logger.warning(
                    "[CHANNEL] @%s resolves to an already-registered channel (%s) - skipped",
                    handle, channel_id,
                )
                continue
            seen_ids.add(channel_id)
            db.add(models.Channel(
                name=name,
                handle=handle,
                youtube_channel_id=channel_id,
                country_id=iso_to_id.get(iso),
                language=language,
                is_enabled=True,
            ))
            created += 1

    db.commit()
    logger.info("[CHANNEL] Seeded %s/%s channels", created, len(pending))
    return created


def refresh_channels(db: Session, force: bool = False) -> dict:
    """Refresh which channels are currently live and embeddable."""
    channels = db.query(models.Channel).filter(models.Channel.is_enabled.is_(True)).all()
    if not channels:
        return {"checked": 0, "live": 0, "mode": "none"}

    if not force:
        cutoff = datetime.utcnow() - timedelta(minutes=CHANNEL_REFRESH_MINUTES)
        channels = [c for c in channels if not c.checked_at or c.checked_at < cutoff]
        if not channels:
            return {"checked": 0, "live": 0, "mode": "cached"}

    key = api_key()
    mode = "api" if key else "keyless"

    if key:
        resolved = _resolve_via_api(db, channels, key)
    else:
        with futures.ThreadPoolExecutor(max_workers=6) as pool:
            resolved = dict(zip(
                [c.youtube_channel_id for c in channels],
                pool.map(lambda c: _resolve_keyless(c.youtube_channel_id), channels),
            ))

    now = datetime.utcnow()
    live = 0
    for channel in channels:
        info = resolved.get(channel.youtube_channel_id) or {}
        channel.is_live = bool(info.get("is_live"))
        channel.live_video_id = info.get("video_id")
        if info.get("title"):
            channel.live_title = info["title"]
        channel.checked_at = now
        if channel.is_live:
            live += 1

    db.commit()
    logger.info("[CHANNEL] Refreshed %s channels via %s - %s live", len(channels), mode, live)
    return {"checked": len(channels), "live": live, "mode": mode}


def repair_channel_ids(db: Session) -> dict:
    """
    Re-resolve stored channel ids against the authoritative source.

    Rows seeded before the resolver was fixed can point at a *different*
    channel than their handle (the page scrape picked up a referenced channel),
    which shows up as a broadcaster playing another outlet's stream.
    """
    key = api_key()
    if not key:
        return {"repaired": 0, "checked": 0, "reason": "no_api_key"}

    rows = db.query(models.Channel).all()
    taken = {c.youtube_channel_id: c.id for c in rows}
    repaired, checked = [], 0

    for channel in rows:
        checked += 1
        correct = _resolve_channel_id_api(channel.handle, key)
        if not correct or correct == channel.youtube_channel_id:
            continue
        owner = taken.get(correct)
        if owner is not None and owner != channel.id:
            logger.warning(
                "[CHANNEL] @%s should be %s but that id is already used - skipped",
                channel.handle, correct,
            )
            continue
        repaired.append({"handle": channel.handle, "was": channel.youtube_channel_id, "now": correct})
        taken.pop(channel.youtube_channel_id, None)
        taken[correct] = channel.id
        channel.youtube_channel_id = correct
        # Cached stream belonged to the wrong channel — force a re-resolve.
        channel.live_video_id = None
        channel.live_title = None
        channel.is_live = False
        channel.checked_at = None

    db.commit()
    if repaired:
        logger.info("[CHANNEL] Repaired %s mis-resolved channel ids", len(repaired))
    return {"checked": checked, "repaired": len(repaired), "changes": repaired}


def diagnostics(db: Session) -> dict:
    """
    Why are there no live channels *here*?

    Written for deployed environments: locally everything works, but a cloud
    host can fail at a specific step (YouTube blocks datacenter IPs from page
    scraping, an API key can be HTTP-referrer restricted so server-side calls
    get 403, or the scheduler may never have run). Each dependency is probed
    separately so the failing one is named rather than guessed at.
    """
    key = api_key()
    report: dict = {
        "api_key_configured": bool(key),
        "channels_in_db": db.query(models.Channel).count(),
        "channels_live": db.query(models.Channel).filter(models.Channel.is_live.is_(True)).count(),
        "checks": {},
    }

    # 1. Can we reach youtube.com at all (page scraping path)?
    try:
        response = requests.get(
            "https://www.youtube.com/@nhkworldjapan", headers=HEADERS, timeout=REQUEST_TIMEOUT
        )
        blocked = "consent" in response.url or response.status_code != 200
        report["checks"]["youtube_page_scrape"] = {
            "ok": not blocked,
            "status": response.status_code,
            "final_url": response.url[:90],
            "note": "Datacenter IPs are often served a consent wall; keyless discovery then finds nothing."
            if blocked else "Page fetch works from this host.",
        }
    except requests.RequestException as e:
        report["checks"]["youtube_page_scrape"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}

    # 2. Does the API key work server-side (no Referer header is sent)?
    if key:
        try:
            response = requests.get(
                f"{YOUTUBE_API}/videos",
                params={"part": "status", "id": "dQw4w9WgXcQ", "key": key},
                timeout=REQUEST_TIMEOUT,
            )
            ok = response.status_code == 200
            report["checks"]["youtube_api"] = {
                "ok": ok,
                "status": response.status_code,
                "note": "OK" if ok else (
                    "403 usually means the key is HTTP-referrer restricted. Server-to-server "
                    "calls send no Referer, so restrict by IP (or leave unrestricted) instead."
                ),
                "error": None if ok else response.text[:200],
            }
        except requests.RequestException as e:
            report["checks"]["youtube_api"] = {"ok": False, "error": f"{type(e).__name__}: {e}"}
    else:
        report["checks"]["youtube_api"] = {
            "ok": False,
            "note": "YOUTUBE_API_KEY is not set on this host. Without it, seeding relies on page "
                    "scraping, which many cloud hosts are blocked from.",
        }

    # 3. Can we resolve one known handle end to end?
    resolved = resolve_channel_id("nhkworldjapan")
    report["checks"]["handle_resolution"] = {
        "ok": bool(resolved),
        "resolved": resolved,
        "note": "If this fails, seed_channels creates no rows and the player has nothing to show.",
    }

    report["scheduler_env"] = {
        "ENABLE_SCHEDULER": os.getenv("ENABLE_SCHEDULER", "true"),
        "CHANNEL_REFRESH_MINUTES": CHANNEL_REFRESH_MINUTES,
    }
    failing = [name for name, c in report["checks"].items() if not c.get("ok")]
    report["failing_checks"] = failing
    report["summary"] = (
        "All channel dependencies healthy." if not failing
        else "Failing: " + ", ".join(failing)
    )
    return report


def preview_handle(handle: str) -> dict:
    """
    Vet a YouTube handle before adding it — no database writes.

    Three things can go wrong and they need different fixes, so they are
    reported separately rather than as one "didn't work":
      * the handle does not resolve  -> wrong handle, check the channel URL
      * it resolves but nothing live -> channel does not run a 24/7 stream
      * live but not embeddable      -> broadcaster disabled embedding
    """
    handle = (handle or "").strip().lstrip("@")
    if not handle:
        return {"handle": handle, "usable": False, "reason": "empty handle"}

    channel_id = resolve_channel_id(handle)
    if not channel_id:
        return {
            "handle": handle, "usable": False, "channel_id": None,
            "reason": "handle_not_found",
            "detail": "No channel at youtube.com/@" + handle + " — check the exact handle in the channel URL.",
        }

    video_id, _ = _keyless_live_video(channel_id)
    if not video_id:
        # On a host blocked from scraping, the page lookup always comes back
        # empty; ask the API before declaring the channel offline. This is a
        # user-triggered action, so the 100-unit search is acceptable here.
        key = api_key()
        if key:
            video_id = _search_live(channel_id, key)
    if not video_id:
        return {
            "handle": handle, "usable": False, "channel_id": channel_id,
            "reason": "not_live",
            "detail": "Channel exists but is not streaming right now. Fine to add if it runs a 24/7 stream; it will appear when live.",
        }

    embeddable, title = _oembed_check(video_id)
    if not embeddable:
        return {
            "handle": handle, "usable": False, "channel_id": channel_id,
            "live_video_id": video_id, "reason": "not_embeddable",
            "detail": "Live, but the broadcaster disabled embedding — it cannot be played on the dashboard.",
        }

    return {
        "handle": handle, "usable": True, "channel_id": channel_id,
        "live_video_id": video_id, "live_title": title, "reason": "ok",
        "detail": "Live and embeddable.",
    }


def add_channel(
    db: Session,
    handle: str,
    name: str | None = None,
    country_iso: str | None = None,
    language: str | None = None,
) -> dict:
    """Vet and store a channel at runtime, so adding one needs no code change."""
    handle = (handle or "").strip().lstrip("@")
    existing = db.query(models.Channel).filter(models.Channel.handle == handle).first()
    if existing:
        return {"added": False, "reason": "already_exists", "channel_id": existing.youtube_channel_id}

    preview = preview_handle(handle)
    if not preview.get("channel_id"):
        return {"added": False, **preview}

    # A different handle may already point at this same channel.
    clash = (
        db.query(models.Channel)
        .filter(models.Channel.youtube_channel_id == preview["channel_id"])
        .first()
    )
    if clash:
        return {
            "added": False, "reason": "already_exists",
            "detail": f"Already registered as @{clash.handle} ({clash.name}).",
            "channel_id": clash.youtube_channel_id,
        }

    country_id = None
    if country_iso:
        country_id = (
            db.query(models.Country.id)
            .filter(models.Country.iso_code == country_iso.strip().upper())
            .scalar()
        )
        if country_id is None:
            return {"added": False, "reason": "unknown_country", "detail": f"No country with ISO code {country_iso!r}."}

    channel = models.Channel(
        name=name or handle,
        handle=handle,
        youtube_channel_id=preview["channel_id"],
        country_id=country_id,
        language=language,
        is_enabled=True,
        is_live=bool(preview.get("usable")),
        live_video_id=preview.get("live_video_id"),
        live_title=preview.get("live_title"),
        checked_at=datetime.utcnow(),
    )
    db.add(channel)
    db.commit()
    db.refresh(channel)

    return {
        "added": True,
        "id": channel.id,
        "name": channel.name,
        "channel_id": channel.youtube_channel_id,
        "is_live": bool(channel.is_live),
        "reason": preview.get("reason"),
        "detail": preview.get("detail"),
    }


def set_channel_enabled(db: Session, channel_id: int, enabled: bool) -> bool:
    channel = db.query(models.Channel).filter(models.Channel.id == channel_id).first()
    if not channel:
        return False
    channel.is_enabled = enabled
    db.commit()
    return True


def delete_channel(db: Session, channel_id: int) -> bool:
    channel = db.query(models.Channel).filter(models.Channel.id == channel_id).first()
    if not channel:
        return False
    db.delete(channel)
    db.commit()
    return True


def list_channels(db: Session, country: str | None = None, live_only: bool = False) -> list[dict]:
    """Channels for the UI, live ones first."""
    query = db.query(models.Channel).filter(models.Channel.is_enabled.is_(True))

    term = (country or "").strip()
    if term:
        # LIKE wildcards in the term are escaped: "%" would otherwise match
        # every country rather than the one asked for.
        escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.outerjoin(models.Country, models.Channel.country_id == models.Country.id)
        query = query.filter(
            (models.Country.iso_code == term.upper())
            | (models.Country.name.ilike(escaped, escape="\\"))
        )
    if live_only:
        query = query.filter(models.Channel.is_live.is_(True))

    rows = query.all()
    rows.sort(key=lambda c: (not c.is_live, c.name))
    return [
        {
            "id": c.id,
            "name": c.name,
            "handle": c.handle,
            "youtube_channel_id": c.youtube_channel_id,
            "live_video_id": c.live_video_id,
            "live_title": c.live_title,
            "is_live": bool(c.is_live),
            "language": c.language,
            "checked_at": c.checked_at,
            "country": c.country.name if c.country else None,
            "country_iso_code": c.country.iso_code if c.country else None,
        }
        for c in rows
    ]
