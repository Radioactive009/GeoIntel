"""
GeoIntel AI — FastAPI application.

Assembles the app, schedules ingestion and exposes the read API. The ingestion
pipeline itself lives in app/services/ingest.py and the country catalog in
app/countries.py.
"""

from __future__ import annotations

import hashlib
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from html import escape

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import (
    Depends, FastAPI, File, Header, HTTPException, Query, Request, Response, UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from . import models, schemas
from .countries import COUNTRIES
from .database import Base, SessionLocal, engine
from .migrations import run_migrations
from .services import agent, alerts, brief, channels, events, framing, ingest, speech

# =========================================================
# LOGGING / ENV
# =========================================================
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

# override=True: a .env file sitting in the project directory is a more
# deliberate statement of intent than whatever is lingering in the shell or the
# user's OS environment. Without it a stale GROQ_API_KEY set once as a Windows
# user variable silently shadowed the working key in .env, and the only symptom
# was a 401 surfacing as "the assistant could not answer that". Production sets
# real environment variables and ships no .env, so this is a no-op there.
load_dotenv(override=True)

INGEST_INTERVAL_MINUTES = max(5, int(os.getenv("INGEST_INTERVAL_MINUTES", "30")))
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "true").lower() not in ("0", "false", "no")
STARTUP_INGEST_DELAY = max(0, int(os.getenv("STARTUP_INGEST_DELAY", "10")))

# Shared secret for the endpoints that write, ingest or spend third-party
# quota. Unset leaves them open, which keeps local development frictionless
# but is logged loudly at startup — with ALLOWED_ORIGINS=* an open
# /ingest-all can be used to drain the GNews and YouTube allowances.
ADMIN_API_KEY = os.getenv("ADMIN_API_KEY") or ""

# How long the feed may go unrefreshed before /health reports it stale. Set a
# little above INGEST_INTERVAL_MINUTES so a normally-running cycle never trips
# it, but a container that was stopped overnight does.
STALE_AFTER_MINUTES = max(5, int(os.getenv("STALE_AFTER_MINUTES", "45")))


# =========================================================
# HTTP CACHING
# =========================================================
# The archive changes when a cycle finishes, not when someone opens a page,
# so most reads here are the same bytes served repeatedly. Nothing said so:
# every navigation re-fetched in full from a host that may have been asleep,
# and a reader moving between pages paid for it each time.
#
# An allowlist rather than a blanket rule. Whether a response may be reused
# is a property of the endpoint, and defaulting to cacheable is how a private
# or fast-moving one quietly gets stored somewhere it should not be.
CACHEABLE: dict[str, int] = {
    "/brief": 300,          # recomposed only when the archive moves
    "/events": 180,
    "/contested": 300,
    "/relations": 300,
    "/trends": 300,
    "/history-frames": 600,
    "/alert-analysis": 120,
    "/articles": 60,        # the feed a reader watches most closely
    "/countries": 3600,     # the catalog, which effectively never changes
    "/sources": 1800,
    "/feed.xml": 600,
    "/sitemap.xml": 3600,
}

# Serve the stale copy while revalidating behind it. On a free tier that
# sleeps, this is the difference between a reader waiting out a cold start
# and not noticing one happened.
STALE_WHILE_REVALIDATE = 600


def _cache_seconds(path: str) -> int | None:
    """Longest matching prefix, so /events/{key} inherits /events."""
    best = None
    for prefix, seconds in CACHEABLE.items():
        if path == prefix or path.startswith(prefix + "/"):
            if best is None or len(prefix) > len(best[0]):
                best = (prefix, seconds)
    return best[1] if best else None


# =========================================================
# DB SETUP + MIGRATIONS
# =========================================================
Base.metadata.create_all(bind=engine)
run_migrations(engine)


# =========================================================
# SCHEDULER
# =========================================================
scheduler = BackgroundScheduler(timezone="UTC")
_startup_lock = threading.Lock()
_startup_done = False

# Only one ingest cycle may run at a time. The scheduler and a manual
# /ingest-batch used to be able to run concurrently over the same feeds, which
# raced on the UNIQUE articles.url constraint and shared ingest cursor.
_ingest_lock = threading.Lock()
_ingest_state: dict = {
    "running": False,
    "started_at": None,
    "finished_at": None,
    "last_summary": None,
    "last_error": None,
}


def run_ingest(batch_size: int | None = None) -> dict:
    """
    Run one full cycle: articles, then live-channel liveness.

    Returns immediately with ``{"skipped": True}`` if a cycle is already in
    flight, rather than queueing a second one behind it.
    """
    if not _ingest_lock.acquire(blocking=False):
        logger.info("[SKIP] Ingest already running - not starting another")
        return {"skipped": True, "reason": "already_running"}

    _ingest_state.update(
        running=True, started_at=datetime.utcnow(), finished_at=None, last_error=None
    )
    summary: dict = {}
    try:
        db = SessionLocal()
        try:
            logger.info("[TIMER] Ingestion starting...")
            summary = ingest.run_ingest_cycle(db, batch_size=batch_size)
            logger.info("[TIMER] Ingestion complete: %s saved", summary["total_saved"])
            _ingest_state["last_summary"] = summary
        except Exception as e:
            logger.exception("[ERR] Ingestion failed: %s", e)
            _ingest_state["last_error"] = str(e)
        finally:
            db.close()

        # Live-stream liveness is independent of article ingestion; a failure
        # here must never mark the ingest cycle as failed.
        db = SessionLocal()
        try:
            channels.seed_channels(db)
            channels.refresh_channels(db)
        except Exception as e:
            logger.warning("[ERR] Channel refresh failed: %s", e)
        finally:
            db.close()
    finally:
        _ingest_state.update(running=False, finished_at=datetime.utcnow())
        _ingest_lock.release()

    return summary


def scheduled_ingest() -> None:
    """Scheduled job entry point."""
    run_ingest()


def _start_background_ingest(size: int) -> None:
    """Kick off a cycle without waiting for it.

    A cycle routinely runs for minutes; held open it would outlast both the
    request and the gateway. The lock inside run_ingest is what stops two
    cycles racing, so starting a second one here is safe and returns at once.
    """
    threading.Thread(target=run_ingest, kwargs={"batch_size": size}, daemon=True).start()


# The assistant can refresh the feed on request. Ingestion owns its lock and
# run state here rather than in the service, so the handles are passed in;
# importing main from the agent would be circular.
agent.set_ingest_handlers(_start_background_ingest, lambda: dict(_ingest_state))


def _bootstrap() -> None:
    """
    Seed the catalog and, if the feed is empty, ingest immediately.

    A cold database used to show an empty dashboard for the first 30 minutes.
    """
    db = SessionLocal()
    try:
        ingest.ensure_country_catalog_in_db(db)
        logger.info("[OK] Country catalog synced (%s countries)", len(COUNTRIES))
        empty = ingest.article_count(db) == 0
    finally:
        db.close()

    if empty:
        logger.info("[SYNC] Empty database - ingesting immediately")
    elif STARTUP_INGEST_DELAY:
        # Let the server finish binding before the first heavy cycle.
        time.sleep(STARTUP_INGEST_DELAY)

    scheduled_ingest()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _startup_done

    if ENABLE_SCHEDULER:
        with _startup_lock:
            # Guard against uvicorn --reload invoking startup twice.
            if not _startup_done:
                _startup_done = True
                if not scheduler.get_jobs():
                    scheduler.add_job(
                        scheduled_ingest,
                        "interval",
                        minutes=INGEST_INTERVAL_MINUTES,
                        id="auto_ingest_job",
                        replace_existing=True,
                        max_instances=1,
                        coalesce=True,
                    )
                if not scheduler.running:
                    scheduler.start()
                logger.info(
                    "[OK] Scheduler started - ingestion every %s minutes",
                    INGEST_INTERVAL_MINUTES,
                )
                threading.Thread(target=_bootstrap, daemon=True).start()
    else:
        logger.info("[SKIP] Scheduler disabled via ENABLE_SCHEDULER")

    if not ADMIN_API_KEY:
        logger.warning(
            "[WARN] ADMIN_API_KEY is not set - /ingest-*, /snapshot and the channel "
            "write endpoints are unauthenticated, and anyone can have the assistant "
            "refresh the feed on demand. Set it before exposing this host."
        )

    yield

    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("[STOP] Scheduler shut down")


# =========================================================
# APP INIT
# =========================================================
app = FastAPI(
    title="GeoIntel AI",
    description="Geopolitical news intelligence API",
    version="2.0.0",
    lifespan=lifespan,
)

# Comma-separated origin list; "*" keeps local development frictionless.
_origins = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "*").split(",") if o.strip()]
@app.middleware("http")
async def cache_reads(request: Request, call_next):
    """Attach validators and freshness to cacheable reads.

    An ETag lets a repeat visit answer with 304 and no body at all, which
    matters more than the max-age here: the archive is mostly unchanged
    between visits, and a conditional request costs a header exchange rather
    than a payload.
    """
    response = await call_next(request)
    seconds = _cache_seconds(request.url.path)
    if request.method != "GET" or response.status_code != 200 or seconds is None:
        return response

    body = b"".join([chunk async for chunk in response.body_iterator])
    etag = '"' + hashlib.md5(body).hexdigest() + '"'

    headers = {
        k: v for k, v in response.headers.items()
        # Recomputed by the response below; a stale one truncates the body.
        if k.lower() not in ("content-length", "etag", "cache-control")
    }
    headers["ETag"] = etag
    headers["Cache-Control"] = (
        f"public, max-age={seconds}, stale-while-revalidate={STALE_WHILE_REVALIDATE}"
    )

    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=body,
        status_code=200,
        headers=headers,
        media_type=response.media_type,
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=_origins != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def require_admin(x_api_key: str | None = Header(default=None)) -> None:
    """Guard for endpoints that write, ingest, or spend third-party quota."""
    if not ADMIN_API_KEY:
        return  # open by choice; the startup warning says so
    if x_api_key != ADMIN_API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key")


def is_admin(x_api_key: str | None) -> bool:
    """Same rule as require_admin, as an answer rather than an exception.

    The assistant is a public route that offers one privileged tool, so it
    needs to know whether the caller is entitled rather than to refuse the
    whole request. Deliberately the same rule, so there is one definition of
    who may spend the site's provider quota.
    """
    if not ADMIN_API_KEY:
        return True  # open by choice; the startup warning says so
    return bool(x_api_key) and x_api_key == ADMIN_API_KEY


def _like_escape(term: str) -> str:
    """
    Escape LIKE wildcards in user input.

    Unescaped, `?q=100%` searched for "100" followed by anything and returned
    articles containing neither — the search silently reported matches it had
    not made.
    """
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _conflict(db: Session, detail: str) -> HTTPException:
    db.rollback()
    return HTTPException(status_code=409, detail=detail)


# =========================================================
# ROOT / HEALTH
# =========================================================
@app.get("/")
def root():
    return {"message": "Geopolitical News Intelligence Backend Running"}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """
    Whether the pipeline is actually producing data, and how recently.

    The freshness fields exist so an external scheduler can decide for itself
    whether to trigger a cycle. That matters on a host that stops the
    container when idle: the in-process scheduler stops with it, so nothing
    runs between visits, and a cron that fires blindly would either
    over-ingest or miss.
    """
    total = ingest.article_count(db)
    latest = (
        db.query(func.max(models.Article.published_at)).scalar()
        if total else None
    )
    attributed = (
        db.query(func.count(models.Article.id))
        .filter(models.Article.country_id.isnot(None))
        .scalar()
    )

    # Time since the last completed *cycle*, not since the newest article.
    # An article's timestamp is the publisher's, so a quiet news hour would
    # otherwise look identical to a pipeline that has stopped running.
    checked_at = ingest.last_ingest_at(db)
    age_minutes = (
        round((datetime.utcnow() - checked_at).total_seconds() / 60, 1)
        if checked_at else None
    )

    return {
        "status": "ok",
        "articles": total,
        "attributed_articles": attributed,
        "latest_article": latest,
        "last_ingest_at": checked_at,
        "minutes_since_ingest": age_minutes,
        # Never ingested, or overdue. An external scheduler acts on this.
        "stale": age_minutes is None or age_minutes > STALE_AFTER_MINUTES,
        "stale_after_minutes": STALE_AFTER_MINUTES,
        "ingest_running": bool(_ingest_state["running"]),
        "countries": db.query(func.count(models.Country.id)).scalar(),
        "sources": db.query(func.count(models.Source.id)).scalar(),
        "scheduler_running": scheduler.running,
        "providers": {
            "newsapi": bool(os.getenv("NEWS_API_KEY")),
            "gnews": bool(os.getenv("GNEWS_API_KEY")),
            "rss": True,
        },
    }


# =========================================================
# COUNTRY ROUTES
# =========================================================
@app.post("/countries", response_model=schemas.CountryResponse, dependencies=[Depends(require_admin)])
def create_country(country: schemas.CountryCreate, db: Session = Depends(get_db)):
    db_country = models.Country(**country.model_dump())
    db.add(db_country)
    try:
        db.commit()
    except IntegrityError as e:
        raise _conflict(db, "A country with that name or ISO code already exists") from e
    db.refresh(db_country)
    return db_country


@app.get("/countries", response_model=list[schemas.CountryResponse])
def get_countries(db: Session = Depends(get_db)):
    ingest.ensure_country_catalog_in_db(db)
    return db.query(models.Country).order_by(models.Country.name).all()


@app.get("/country-catalog")
def get_country_catalog():
    return {"total": len(COUNTRIES), "sample": COUNTRIES[:20]}


# =========================================================
# SOURCE ROUTES
# =========================================================
@app.post("/sources", response_model=schemas.SourceResponse, dependencies=[Depends(require_admin)])
def create_source(source: schemas.SourceCreate, db: Session = Depends(get_db)):
    db_source = models.Source(**source.model_dump())
    db.add(db_source)
    try:
        db.commit()
    except IntegrityError as e:
        raise _conflict(db, "A source with that name already exists") from e
    db.refresh(db_source)
    return db_source


@app.get("/sources", response_model=list[schemas.SourceResponse])
def get_sources(db: Session = Depends(get_db)):
    return db.query(models.Source).order_by(models.Source.name).all()


# =========================================================
# ARTICLE ROUTES
# =========================================================
@app.post("/articles", response_model=schemas.ArticleResponse, dependencies=[Depends(require_admin)])
def create_article(article: schemas.ArticleCreate, db: Session = Depends(get_db)):
    payload = article.model_dump()

    # Checked here as well as by the database: SQLite only enforces foreign
    # keys when asked, so an unknown source_id used to be accepted locally and
    # rejected in production.
    if not db.get(models.Source, payload["source_id"]):
        raise HTTPException(status_code=400, detail=f"No source with id {payload['source_id']}")
    if payload.get("country_id") is not None and not db.get(models.Country, payload["country_id"]):
        raise HTTPException(status_code=400, detail=f"No country with id {payload['country_id']}")

    db_article = models.Article(**payload)
    db.add(db_article)
    try:
        db.commit()
    except IntegrityError as e:
        raise _conflict(db, "An article with that URL already exists") from e
    db.refresh(db_article)
    return db_article


@app.get("/articles", response_model=schemas.ArticlePage)
def get_articles(
    country: str | None = None,
    region: str | None = None,
    level: str | None = Query(default=None, pattern="^(low|medium|high)$"),
    event_type: str | None = Query(
        default=None,
        pattern="^(conflict|security|diplomacy|economy|politics|disaster|humanitarian|other)$",
    ),
    tone: str | None = Query(
        default=None, pattern="^(uplifting|serious|neutral)$",
        description="Emotional register, so a reader can choose one",
    ),
    q: str | None = None,
    days: int | None = Query(default=None, ge=1, le=365),
    include_duplicates: bool = Query(
        default=False,
        description="Include syndicated re-reports of a story already in the feed",
    ),
    limit: int = Query(default=60, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """
    Paginated article feed.

    This used to return the entire table with joins on every request; the
    frontend then paginated in the browser.
    """
    query = (
        db.query(models.Article)
        .options(
            joinedload(models.Article.source),
            joinedload(models.Article.country_rel),
        )
    )

    country_term = (country or "").strip()
    region_term = (region or "").strip()

    if country_term or region_term:
        query = query.join(models.Article.country_rel)
        if country_term:
            query = query.filter(
                (models.Country.iso_code == country_term.upper())
                | (models.Country.name.ilike(_like_escape(country_term), escape="\\"))
            )
        if region_term:
            query = query.filter(models.Country.region == region_term)

    if level:
        query = query.filter(models.Article.geo_risk_level == level)

    if event_type:
        query = query.filter(models.Article.event_type == event_type)

    if tone:
        query = query.filter(models.Article.tone == tone)

    if not include_duplicates:
        # One event, one card. `isnot(True)` keeps rows stored before the
        # column existed, whose flag is NULL.
        query = query.filter(models.Article.is_duplicate.isnot(True))

    q_term = (q or "").strip()
    if q_term:
        pattern = f"%{_like_escape(q_term)}%"
        query = query.filter(
            models.Article.title.ilike(pattern, escape="\\")
            | models.Article.description.ilike(pattern, escape="\\")
        )

    if days:
        query = query.filter(
            models.Article.published_at >= datetime.utcnow() - timedelta(days=days)
        )

    total = query.with_entities(func.count(models.Article.id)).order_by(None).scalar() or 0
    items = (
        query.order_by(models.Article.published_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # How many outlets carried each story on this page. One extra grouped
    # query for the whole page rather than a correlated subquery per row.
    keys = [a.story_key for a in items if a.story_key]
    counts: dict[str, int] = {}
    if keys:
        counts = dict(
            db.query(models.Article.story_key, func.count(models.Article.id))
            .filter(models.Article.story_key.in_(list(set(keys))))
            .group_by(models.Article.story_key)
            .all()
        )

    payload = []
    for article in items:
        row = schemas.ArticleResponse.model_validate(article)
        row.duplicate_count = max(0, counts.get(article.story_key, 1) - 1)
        payload.append(row)

    return {"items": payload, "total": total, "limit": limit, "offset": offset}


@app.get("/articles/{article_id}", response_model=schemas.ArticleDetail)
def get_article(article_id: int, db: Session = Depends(get_db)):
    """
    One article plus its related coverage.

    Two relationships already exist in the data and were never surfaced: the
    story cluster (the same event as carried by other outlets) and the
    country links. Together they make a real article page possible without
    any new analysis.
    """
    article = (
        db.query(models.Article)
        .options(
            joinedload(models.Article.source),
            joinedload(models.Article.country_rel),
            joinedload(models.Article.country_secondary_rel),
        )
        .filter(models.Article.id == article_id)
        .first()
    )
    if not article:
        raise HTTPException(status_code=404, detail="Article not found")

    def _decorate(rows):
        return [schemas.ArticleResponse.model_validate(row) for row in rows]

    base = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.id != article.id)
    )

    # Same event, different outlet.
    also_reported = []
    if article.story_key:
        also_reported = base.filter(models.Article.story_key == article.story_key).limit(8).all()

    # Same country, different event.
    related = []
    if article.country_id:
        query = base.filter(
            models.Article.country_id == article.country_id,
            models.Article.is_duplicate.isnot(True),
        )
        if article.story_key:
            # Exclude this event's cluster. Written as an explicit NULL check
            # rather than `isnot(value)`: that renders `IS NOT 'key'`, which
            # SQLite tolerates but Postgres rejects as a syntax error.
            query = query.filter(
                or_(
                    models.Article.story_key.is_(None),
                    models.Article.story_key != article.story_key,
                )
            )
        related = query.order_by(models.Article.published_at.desc()).limit(6).all()

    payload = schemas.ArticleDetail.model_validate(article)
    payload.also_reported_by = _decorate(also_reported)
    payload.related = _decorate(related)
    return payload


@app.get("/feed.xml", response_class=Response)
def rss_feed(
    country: str | None = None,
    limit: int = Query(default=40, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """
    The site's own RSS feed — a publication should be subscribable.

    Mirrors the default feed: canonical stories only, newest first.
    """
    query = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.is_duplicate.isnot(True))
    )
    if country:
        term = country.strip()
        query = query.join(models.Article.country_rel).filter(
            (models.Country.iso_code == term.upper())
            | (models.Country.name.ilike(_like_escape(term), escape="\\"))
        )
    articles = query.order_by(models.Article.published_at.desc()).limit(limit).all()

    site = os.getenv("SITE_URL", "https://geointel.app").rstrip("/")

    def esc(value: str | None) -> str:
        return escape(value or "", quote=True)

    items = "".join(
        f"<item>"
        f"<title>{esc(a.title)}</title>"
        f"<link>{esc(a.url)}</link>"
        f"<guid isPermaLink=\"false\">geointel-{a.id}</guid>"
        f"<description>{esc(a.description)}</description>"
        f"<pubDate>{format_datetime(a.published_at.replace(tzinfo=timezone.utc))}</pubDate>"
        f"<source url=\"{site}\">{esc(a.source.name if a.source else 'GeoIntel')}</source>"
        + (f"<category>{esc(a.country_rel.name)}</category>" if a.country_rel else "")
        + "</item>"
        for a in articles
    )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel>'
        "<title>GeoIntel — Global Conflict &amp; Risk Monitor</title>"
        f"<link>{site}</link>"
        "<description>Geopolitical news attributed to a country and scored for risk.</description>"
        "<language>en</language>"
        f"{items}"
        "</channel></rss>"
    )
    return Response(content=xml, media_type="application/rss+xml")


@app.get("/sitemap.xml", response_class=Response)
def sitemap(db: Session = Depends(get_db)):
    """
    Sitemap covering the standing pages, every covered country, and recent
    stories. Generated rather than static because the content changes hourly.
    """
    site = os.getenv("SITE_URL", "https://geointel.app").rstrip("/")
    urls: list[tuple[str, str | None]] = [
        (f"{site}/", None),
        (f"{site}/brief", None),
        (f"{site}/about", None),
        (f"{site}/methodology", None),
        (f"{site}/sources", None),
    ]
    urls += [(f"{site}/topic/{topic}", None) for topic in
             ("military", "diplomatic", "economic", "political", "hazard")]

    covered = (
        db.query(models.Country.iso_code)
        .join(models.Article, models.Article.country_id == models.Country.id)
        .distinct()
        .all()
    )
    urls += [(f"{site}/country/{row[0]}", None) for row in covered]

    recent = (
        db.query(models.Article.id, models.Article.published_at)
        .filter(models.Article.is_duplicate.isnot(True))
        .order_by(models.Article.published_at.desc())
        .limit(2000)
        .all()
    )
    urls += [
        (f"{site}/story/{article_id}", published.date().isoformat() if published else None)
        for article_id, published in recent
    ]

    body = "".join(
        f"<url><loc>{escape(loc)}</loc>"
        + (f"<lastmod>{lastmod}</lastmod>" if lastmod else "")
        + "</url>"
        for loc, lastmod in urls
    )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"{body}</urlset>"
    )
    return Response(content=xml, media_type="application/xml")


def _summarise_event(rows: list[models.Article]) -> dict:
    """
    Condense an event's articles into one description of the happening.

    The representative headline is the earliest, not the most recent: the
    first report names the event, while later ones describe developments
    ("Death toll rises to 200") that read as nonsense out of context.
    """
    ordered = sorted(rows, key=lambda a: a.published_at or datetime.min)
    lead = ordered[0]

    countries, outlets = [], []
    for article in ordered:
        name = article.country
        if name and name not in countries:
            countries.append(name)
        outlet = article.source.name if article.source else None
        if outlet and outlet not in outlets:
            outlets.append(outlet)

    # Latest reported value of each kind, and how it moved.
    timeline: dict[str, list[dict]] = {}
    for article in ordered:
        for kind, value in events.extract_figures(article.title).items():
            points = timeline.setdefault(kind, [])
            if points and points[-1]["value"] == value:
                continue          # unchanged; not a development
            points.append({
                "t": article.published_at,
                "value": value,
                "source": article.source.name if article.source else None,
                "title": article.title,
            })

    topics = [a.event_type for a in ordered if a.event_type]
    scores = [a.geo_risk_score for a in ordered if a.geo_risk_score is not None]

    return {
        "framing": framing.outlet_framing(ordered),
        "coverage": framing.coverage_curve(ordered),
        "event_key": lead.event_key,
        "title": lead.title or "Untitled",
        "article_count": len(ordered),
        "outlet_count": len(outlets),
        "countries": countries[:6],
        "topic": max(set(topics), key=topics.count) if topics else None,
        "risk": round(max(scores), 2) if scores else 0.0,
        "first_seen": ordered[0].published_at,
        "last_seen": ordered[-1].published_at,
        "image_url": next((a.image_url for a in ordered if a.image_url), None),
        "figures": {kind: points[-1]["value"] for kind, points in timeline.items()},
        "outlets": outlets,
        "timeline": timeline,
        "articles": ordered,
    }


@app.get("/events", response_model=schemas.EventsResponse)
def list_events(
    hours: int = Query(default=168, ge=1, le=24 * 90),
    limit: int = Query(default=20, ge=1, le=100),
    min_articles: int = Query(default=3, ge=1, le=50),
    country: str | None = None,
    db: Session = Depends(get_db),
):
    """
    Happenings ranked by how widely they were covered.

    An event is many articles about one occurrence, which is a different unit
    from the article feed: the Colombian earthquake is one entry here and 70
    entries there.
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    query = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.event_key.isnot(None), models.Article.published_at >= since)
    )
    if country:
        term = country.strip()
        query = query.join(models.Article.country_rel).filter(
            (models.Country.iso_code == term.upper())
            | (models.Country.name.ilike(_like_escape(term), escape="\\"))
        )

    grouped: dict[str, list[models.Article]] = {}
    for article in query.all():
        grouped.setdefault(article.event_key, []).append(article)

    summaries = [
        _summarise_event(rows) for rows in grouped.values() if len(rows) >= min_articles
    ]
    summaries.sort(key=lambda e: (-e["article_count"], -e["risk"]))
    return {"window_hours": hours, "events": summaries[:limit]}


@app.get("/events/{event_key}", response_model=schemas.EventDetail)
def get_event(event_key: str, db: Session = Depends(get_db)):
    """One happening: every article about it, its outlets and its figures."""
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source), joinedload(models.Article.country_rel))
        .filter(models.Article.event_key == event_key)
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Event not found")
    return _summarise_event(rows)


@app.post("/agent/ask", response_model=schemas.AgentAnswer)
def agent_ask(
    payload: schemas.AgentQuestion,
    request: Request,
    x_api_key: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """
    Answer a question using the archive.

    Public and it spends third-party quota, so it is throttled per caller and
    capped per day. Both limits return a plain message rather than an error,
    because a reader who asked a reasonable question should not be shown a
    stack trace for hitting someone else's budget.
    """
    caller = request.client.host if request.client else "unknown"
    if agent.rate_limited(caller):
        return {
            "answer": None, "sources": [], "tools_used": [],
            "error": "You have asked a lot in a short time. Give it a few minutes.",
        }

    return agent.ask(
        db,
        payload.question,
        [turn.model_dump() for turn in payload.history],
        # One privileged tool is exposed here — refreshing the feed spends the
        # site's metered provider quota, so a reader can ask for it and be told
        # no, rather than the whole question being refused.
        can_admin=is_admin(x_api_key),
    )


@app.post("/agent/transcribe")
async def agent_transcribe(
    request: Request,
    audio: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Speech to text, for browsers without their own recogniser.

    Chrome and Edge transcribe locally and never call this; Safari and Firefox
    have no SpeechRecognition, so their audio comes here.
    """
    caller = request.client.host if request.client else "unknown"
    if agent.rate_limited(caller):
        return {"text": None, "error": "You have asked a lot in a short time. Give it a few minutes."}

    payload = await audio.read()
    return agent.transcribe(db, payload, audio.filename or "speech.webm")


@app.post("/agent/speak")
def agent_speak(
    payload: schemas.SpeechRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Read an answer aloud in a human voice.

    Optional throughout. The interface speaks with the browser's own synthesis
    unless this returns audio, so every failure path here returns a plain JSON
    error and costs the reader a plainer voice rather than silence.

    Throttled like the other agent routes, and additionally because this one
    is billed per character — the only paid call in the project.
    """
    caller = request.client.host if request.client else "unknown"
    if agent.rate_limited(caller):
        return JSONResponse(
            {"error": "You have asked a lot in a short time. Give it a few minutes."},
            status_code=200,
        )

    result = speech.synthesise(db, payload.text, payload.voice)
    if not result["audio"]:
        return JSONResponse({"error": result["error"]}, status_code=200)

    return Response(
        content=result["audio"],
        media_type="audio/wav",
        headers={"Cache-Control": "no-store"},
    )


@app.get("/agent/status")
def agent_status(db: Session = Depends(get_db)):
    """Whether the assistant is configured, and what is left of today's budget."""
    _, used = agent._budget_state(db)
    return {
        "available": agent.is_available(),
        "model": agent.MODEL,
        "used_today": used,
        "daily_budget": agent.DAILY_BUDGET,
        # The interface needs to know before it speaks whether to expect audio
        # or to use the browser's synthesis, rather than requesting and failing.
        "speech_available": speech.is_available(),
        "speech_voice": speech.TTS_VOICE,
    }


@app.get("/brief", response_model=schemas.BriefResponse)
def daily_brief(
    hours: int = Query(default=24, ge=1, le=24 * 14),
    db: Session = Depends(get_db),
):
    """
    What to know, in the site's own voice.

    Composed from counts the pipeline already produced rather than by a model:
    a brief is the one page here that does not quote an outlet, and an invented
    figure in it would be indistinguishable from a real one. It also costs
    nothing and needs no key, so it works on any deployment.
    """
    return brief.build_brief(db, hours=hours)


@app.get("/contested", response_model=schemas.ContestedResponse)
def contested(
    hours: int = Query(default=168, ge=1, le=24 * 90),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Events outlets disagreed about.

    Only possible because articles are grouped: comparing how two outlets
    framed a story requires knowing they covered the same one.
    """
    since = datetime.utcnow() - timedelta(hours=hours)
    rows = (
        db.query(models.Article)
        .options(joinedload(models.Article.source))
        .filter(
            models.Article.event_key.isnot(None),
            models.Article.published_at >= since,
            models.Article.geo_risk_score.isnot(None),
        )
        .all()
    )
    grouped: dict[str, list[models.Article]] = {}
    for article in rows:
        grouped.setdefault(article.event_key, []).append(article)

    return {
        "window_hours": hours,
        "events": framing.contested_events(grouped, limit=limit),
    }


@app.get("/relations", response_model=schemas.RelationsResponse)
def relations(
    hours: int = Query(default=168, ge=1, le=24 * 90),
    limit: int = Query(default=12, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Active country pairs — who is in the news *with* whom.

    Built from the second country the resolver finds in each article, which
    was previously computed and discarded.
    """
    return {
        "window_hours": hours,
        "pairs": alerts.compute_relations(db, hours=hours, limit=limit),
    }


# =========================================================
# INGEST ENDPOINTS
# =========================================================
@app.post("/ingest-news", dependencies=[Depends(require_admin)])
def ingest_news(country_iso: str, db: Session = Depends(get_db)):
    ingest.ensure_country_catalog_in_db(db)
    saved = ingest.ingest_news_for_country(country_iso, db)
    return {"message": "News ingestion completed", "articles_saved": saved}


@app.post("/ingest-batch", status_code=202, dependencies=[Depends(require_admin)])
def ingest_country_batch(size: int = Query(default=15, ge=1, le=100)):
    """
    Start one ingest cycle: global feeds plus the next slice of countries.

    Runs in the background and returns straight away. Held open, a cycle makes
    dozens of upstream requests per country and routinely outlasts the 30-60s
    gateway timeout on a typical PaaS, so the caller saw a failure even when
    ingestion had succeeded. Poll /ingest-status for completion.
    """
    if _ingest_state["running"]:
        return {
            "message": "Ingestion already running",
            "started": False,
            **ingest_status(),
        }

    threading.Thread(target=run_ingest, kwargs={"batch_size": size}, daemon=True).start()
    return {
        "message": "Batch ingestion started",
        "started": True,
        "catalog_total": len(COUNTRIES),
    }


@app.get("/ingest-status")
def ingest_status():
    """Progress of the background ingest cycle started by /ingest-batch."""
    return {
        "running": _ingest_state["running"],
        "started_at": _ingest_state["started_at"],
        "finished_at": _ingest_state["finished_at"],
        "last_summary": _ingest_state["last_summary"],
        "last_error": _ingest_state["last_error"],
    }


@app.post("/ingest-all", dependencies=[Depends(require_admin)])
def ingest_all_countries(
    limit: int = Query(default=50, ge=1, le=249),
    db: Session = Depends(get_db),
):
    ingest.ensure_country_catalog_in_db(db)
    ingest.ingest_global_feeds(db)

    results = {}
    for country_cfg in COUNTRIES[:limit]:
        try:
            results[country_cfg["code"]] = ingest.ingest_news_for_country(country_cfg["code"], db)
        except Exception as e:
            db.rollback()
            logger.warning("[ERR] Ingest failed for %s: %s", country_cfg["code"], e)
            results[country_cfg["code"]] = 0

    return {
        "message": "Global ingestion completed",
        "catalog_total": len(COUNTRIES),
        "ingested_count": len(results),
        "results": results,
        "total_saved": sum(results.values()),
    }


# =========================================================
# INTEL ALERT ENGINE + RISK HISTORY
# =========================================================
@app.get("/alert-analysis", response_model=list[schemas.AlertResponse])
def alert_analysis(
    active_only: bool = Query(default=False, description="Only countries with articles"),
    hours: int | None = Query(
        default=None, ge=1, le=24 * 365,
        description="Score only articles from the last N hours (default: whole retention window)",
    ),
    db: Session = Depends(get_db),
):
    """Backend-wide intelligence scan producing per-country alert statuses."""
    since = datetime.utcnow() - timedelta(hours=hours) if hours else None
    try:
        results = alerts.compute_alert_status(db, since=since)
    except Exception as e:
        logger.exception("[ERR] Intelligence scan failed: %s", e)
        raise HTTPException(status_code=500, detail="Intelligence scan failed") from e

    if active_only:
        results = [r for r in results if r["total_articles"] > 0]
    logger.info("[SCAN] Intelligence scan complete - %s countries", len(results))
    return results


@app.get("/trends", response_model=schemas.TrendsResponse)
def trends(
    hours: int = Query(default=168, ge=1, le=24 * 90),
    points: int = Query(default=24, ge=2, le=200),
    country: str | None = Query(default=None, description="ISO alpha-2 code"),
    db: Session = Depends(get_db),
):
    """
    Risk history per country, thinned for sparklines.

    Returns {iso_code: [{t, score, articles}, ...]}.
    """
    return {
        "window_hours": hours,
        "series": alerts.trend_series(db, hours=hours, max_points=points, iso_code=country),
    }


@app.get("/history-frames", response_model=schemas.HistoryFramesResponse)
def history_frames(
    hours: int = Query(default=168, ge=1, le=24 * 90),
    frames: int = Query(default=36, ge=2, le=200),
    db: Session = Depends(get_db),
):
    """World risk levels at each captured hour, for replaying the map."""
    return {
        "window_hours": hours,
        "frames": alerts.history_frames(db, hours=hours, max_frames=frames),
    }


@app.get("/movers", response_model=schemas.MoversResponse)
def movers(
    hours: int = Query(default=168, ge=2, le=24 * 90),
    limit: int = Query(default=8, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Countries escalating or de-escalating against their own recent baseline.

    Ranked by z-score rather than raw delta, so a country that always swings
    wildly does not crowd out a genuine, unusual move somewhere quieter.
    """
    result = alerts.compute_movers(db, hours=hours, limit=limit)
    result["history"] = alerts.history_status(db)
    return result


@app.post("/snapshot", dependencies=[Depends(require_admin)])
def capture_snapshot(db: Session = Depends(get_db)):
    """Force a risk-history capture (normally runs at the end of each cycle)."""
    written = alerts.capture_snapshot(db)
    return {"message": "Snapshot captured", "countries_recorded": written}


# =========================================================
# LIVE BROADCAST CHANNELS
# =========================================================
@app.get("/channels")
def get_channels(
    country: str | None = Query(default=None, description="ISO code or country name"),
    live_only: bool = Query(default=False),
    db: Session = Depends(get_db),
):
    """
    Broadcaster streams, live ones first.

    `live_video_id` is resolved server-side — an embedded player is opaque to
    the page, so the frontend cannot discover a dead stream on its own.
    """
    rows = channels.list_channels(db, country=country, live_only=live_only)
    return {
        "total": len(rows),
        "live": sum(1 for row in rows if row["is_live"]),
        "resolution_mode": "api" if channels.api_key() else "keyless",
        "channels": rows,
    }


@app.post("/channels/refresh", dependencies=[Depends(require_admin)])
def refresh_channels(
    force: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    """Re-resolve which channels are currently live and embeddable."""
    channels.seed_channels(db)
    return channels.refresh_channels(db, force=force)


@app.get("/channels/diagnostics")
def channel_diagnostics(db: Session = Depends(get_db)):
    """
    Explain why channels are missing on *this* host.

    Deployment failures are environment-specific — a cloud host may be blocked
    from scraping YouTube, a key may be referrer-restricted, or the scheduler
    may be disabled — so each dependency is probed and reported separately.
    """
    return channels.diagnostics(db)


@app.post("/channels/repair", dependencies=[Depends(require_admin)])
def repair_channels(db: Session = Depends(get_db)):
    """Re-resolve stored channel ids that point at the wrong channel."""
    return channels.repair_channel_ids(db)


@app.get("/channels/preview")
def preview_channel(handle: str = Query(..., description="YouTube handle, with or without @")):
    """
    Check a channel before adding it — no database write.

    Distinguishes "handle is wrong" from "channel isn't streaming right now"
    from "broadcaster blocks embedding", because the fix differs for each.
    """
    return channels.preview_handle(handle)


@app.post("/channels", dependencies=[Depends(require_admin)])
def create_channel(
    handle: str = Query(..., description="YouTube handle, with or without @"),
    name: str | None = Query(default=None, description="Display name; defaults to the handle"),
    country_iso: str | None = Query(default=None, description="ISO alpha-2, e.g. IN"),
    language: str | None = Query(default=None, description="e.g. en, hi, ar"),
    db: Session = Depends(get_db),
):
    """Add a channel at runtime — no code change or redeploy needed."""
    result = channels.add_channel(db, handle, name=name, country_iso=country_iso, language=language)
    if not result.get("added"):
        raise HTTPException(status_code=400, detail=result)
    return result


@app.patch("/channels/{channel_id}", dependencies=[Depends(require_admin)])
def toggle_channel(channel_id: int, enabled: bool, db: Session = Depends(get_db)):
    """Enable or hide a channel without deleting it."""
    if not channels.set_channel_enabled(db, channel_id, enabled):
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"id": channel_id, "is_enabled": enabled}


@app.delete("/channels/{channel_id}", dependencies=[Depends(require_admin)])
def remove_channel(channel_id: int, db: Session = Depends(get_db)):
    if not channels.delete_channel(db, channel_id):
        raise HTTPException(status_code=404, detail="Channel not found")
    return {"id": channel_id, "deleted": True}


@app.get("/stats")
def stats(db: Session = Depends(get_db)):
    """Aggregate counts used by the dashboard header."""
    by_level = dict(
        db.query(models.Article.geo_risk_level, func.count(models.Article.id))
        .group_by(models.Article.geo_risk_level)
        .all()
    )
    by_event = dict(
        db.query(models.Article.event_type, func.count(models.Article.id))
        .group_by(models.Article.event_type)
        .all()
    )
    by_provider = dict(
        db.query(models.Article.provider, func.count(models.Article.id))
        .group_by(models.Article.provider)
        .all()
    )
    return {
        "total_articles": ingest.article_count(db),
        "by_risk_level": by_level,
        "by_event_type": by_event,
        "by_provider": by_provider,
    }
