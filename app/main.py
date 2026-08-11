"""
GeoIntel AI — FastAPI application.

Assembles the app, schedules ingestion and exposes the read API. The ingestion
pipeline itself lives in app/services/ingest.py and the country catalog in
app/countries.py.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from apscheduler.schedulers.background import BackgroundScheduler
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import case, func
from sqlalchemy.orm import Session, joinedload

from . import models, schemas
from .countries import COUNTRIES
from .database import Base, SessionLocal, engine
from .migrations import run_migrations
from .services import ingest

# =========================================================
# LOGGING / ENV
# =========================================================
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger(__name__)

load_dotenv()

HIGH_RISK_THRESHOLD = 70
MEDIUM_RISK_THRESHOLD = 40

# Pseudo-count for the alert average. A country with a single alarming article
# would otherwise top the global ranking on a sample of one; each country's
# mean is pulled toward the global mean until it has enough reports to stand on
# its own. Higher = more conservative.
ALERT_CONFIDENCE_WEIGHT = max(0.0, float(os.getenv("ALERT_CONFIDENCE_WEIGHT", "5")))

INGEST_INTERVAL_MINUTES = max(5, int(os.getenv("INGEST_INTERVAL_MINUTES", "30")))
ENABLE_SCHEDULER = os.getenv("ENABLE_SCHEDULER", "true").lower() not in ("0", "false", "no")
STARTUP_INGEST_DELAY = max(0, int(os.getenv("STARTUP_INGEST_DELAY", "10")))


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


def scheduled_ingest() -> None:
    """Scheduled job: refresh global feeds and a rotating country batch."""
    db = SessionLocal()
    try:
        logger.info("[TIMER] Scheduled ingestion starting...")
        summary = ingest.run_ingest_cycle(db)
        logger.info("[TIMER] Scheduled ingestion complete: %s saved", summary["total_saved"])
    except Exception as e:
        logger.exception("[ERR] Scheduled ingestion failed: %s", e)
    finally:
        db.close()


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


# =========================================================
# ROOT / HEALTH
# =========================================================
@app.get("/")
def root():
    return {"message": "Geopolitical News Intelligence Backend Running"}


@app.get("/health")
def health(db: Session = Depends(get_db)):
    """Surfaces whether the pipeline is actually producing data."""
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
    return {
        "status": "ok",
        "articles": total,
        "attributed_articles": attributed,
        "latest_article": latest,
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
@app.post("/countries", response_model=schemas.CountryResponse)
def create_country(country: schemas.CountryCreate, db: Session = Depends(get_db)):
    db_country = models.Country(**country.model_dump())
    db.add(db_country)
    db.commit()
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
@app.post("/sources", response_model=schemas.SourceResponse)
def create_source(source: schemas.SourceCreate, db: Session = Depends(get_db)):
    db_source = models.Source(**source.model_dump())
    db.add(db_source)
    db.commit()
    db.refresh(db_source)
    return db_source


@app.get("/sources", response_model=list[schemas.SourceResponse])
def get_sources(db: Session = Depends(get_db)):
    return db.query(models.Source).order_by(models.Source.name).all()


# =========================================================
# ARTICLE ROUTES
# =========================================================
@app.post("/articles", response_model=schemas.ArticleResponse)
def create_article(article: schemas.ArticleCreate, db: Session = Depends(get_db)):
    db_article = models.Article(**article.model_dump())
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article


@app.get("/articles", response_model=schemas.ArticlePage)
def get_articles(
    country: str | None = None,
    region: str | None = None,
    level: str | None = Query(default=None, pattern="^(low|medium|high)$"),
    q: str | None = None,
    days: int | None = Query(default=None, ge=1, le=365),
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

    if country or region:
        query = query.join(models.Article.country_rel)
        if country:
            term = country.strip()
            query = query.filter(
                (models.Country.iso_code == term.upper())
                | (models.Country.name.ilike(term))
            )
        if region:
            query = query.filter(models.Country.region == region.strip())

    if level:
        query = query.filter(models.Article.geo_risk_level == level)

    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter(
            models.Article.title.ilike(pattern)
            | models.Article.description.ilike(pattern)
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

    return {"items": items, "total": total, "limit": limit, "offset": offset}


# =========================================================
# INGEST ENDPOINTS
# =========================================================
@app.post("/ingest-news")
def ingest_news(country_iso: str, db: Session = Depends(get_db)):
    ingest.ensure_country_catalog_in_db(db)
    saved = ingest.ingest_news_for_country(country_iso, db)
    return {"message": "News ingestion completed", "articles_saved": saved}


@app.post("/ingest-batch")
def ingest_country_batch(
    size: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """Run one ingest cycle: global feeds plus the next slice of countries."""
    summary = ingest.run_ingest_cycle(db, batch_size=size)
    return {
        "message": "Batch ingestion completed",
        "catalog_total": len(COUNTRIES),
        **summary,
    }


@app.post("/ingest-all")
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
# INTEL ALERT ENGINE
# =========================================================
def calculate_alert_status(db: Session) -> list[dict]:
    """
    Weighted geopolitical alert level per country.

    Computed by the database in a single aggregate query; this used to load
    every article into Python on each request.
    """
    risk_expr = func.coalesce(
        models.Article.geo_risk_score,
        func.abs(func.coalesce(models.Article.sentiment_score, 0.0)) * 100,
    )
    high_expr = case((models.Article.geo_risk_level == "high", 1), else_=0)

    rows = (
        db.query(
            models.Country.name,
            models.Country.iso_code,
            models.Country.region,
            func.count(models.Article.id).label("total"),
            func.avg(risk_expr).label("avg_risk"),
            func.sum(high_expr).label("high_count"),
        )
        .outerjoin(models.Article, models.Article.country_id == models.Country.id)
        .group_by(models.Country.id, models.Country.name, models.Country.iso_code, models.Country.region)
        .all()
    )

    # Corpus-wide mean, weighted by article count, used as the shrinkage prior.
    scored = [(int(t or 0), float(a)) for *_, t, a, _ in rows if t and a is not None]
    total_articles = sum(t for t, _ in scored)
    global_mean = (
        sum(t * a for t, a in scored) / total_articles if total_articles else 0.0
    )

    results = []
    for name, iso_code, region, total, avg_risk, high_count in rows:
        total = int(total or 0)
        raw_score = float(avg_risk) if total and avg_risk is not None else 0.0

        if total:
            # Bayesian shrinkage: a mean over one article is not evidence of a
            # national threat level, so pull it toward the global mean.
            score = (
                (total * raw_score + ALERT_CONFIDENCE_WEIGHT * global_mean)
                / (total + ALERT_CONFIDENCE_WEIGHT)
            )
        else:
            score = 0.0

        score = round(score, 2)

        if score >= HIGH_RISK_THRESHOLD:
            status = "high"
        elif score >= MEDIUM_RISK_THRESHOLD:
            status = "medium"
        else:
            status = "low"

        results.append({
            "country": name,
            "iso_code": iso_code,
            "region": region,
            "total_articles": total,
            "critical_alerts": int(high_count or 0),
            "alert_level": score,
            "raw_alert_level": round(raw_score, 2),
            "alert_status": status,
        })

    results.sort(key=lambda r: r["alert_level"], reverse=True)
    return results


@app.get("/alert-analysis", response_model=list[schemas.AlertResponse])
def alert_analysis(
    active_only: bool = Query(default=False, description="Only countries with articles"),
    db: Session = Depends(get_db),
):
    """Backend-wide intelligence scan producing per-country alert statuses."""
    try:
        results = calculate_alert_status(db)
    except Exception as e:
        logger.exception("[ERR] Intelligence scan failed: %s", e)
        raise HTTPException(status_code=500, detail="Intelligence scan failed") from e

    if active_only:
        results = [r for r in results if r["total_articles"] > 0]
    logger.info("[SCAN] Intelligence scan complete - %s countries", len(results))
    return results


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
