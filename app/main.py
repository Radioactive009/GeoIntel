from fastapi import FastAPI, Depends, Query
from sqlalchemy.orm import Session, joinedload
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
import requests
import os
import json
from dotenv import load_dotenv
import logging
import threading
import pycountry
import pycountry_convert as pc

# =========================================================
# LOGGING SETUP
# =========================================================
logger = logging.getLogger(__name__)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(message)s"
)

from .database import engine, Base, SessionLocal
from . import models, schemas


# =========================================================
# LOAD ENV
# =========================================================
load_dotenv()


# =========================================================
# CREATE TABLES + MIGRATE
# =========================================================
Base.metadata.create_all(bind=engine)

# Auto-migrate: add sentiment columns if they don't exist
# (SQLAlchemy create_all won't alter existing tables)
from sqlalchemy import text

with engine.connect() as conn:
    columns = [row[1] for row in conn.execute(text("PRAGMA table_info(articles)"))]
    if "sentiment_score" not in columns:
        conn.execute(text("ALTER TABLE articles ADD COLUMN sentiment_score FLOAT"))
    if "sentiment_label" not in columns:
        conn.execute(text("ALTER TABLE articles ADD COLUMN sentiment_label VARCHAR"))
    conn.commit()


# =========================================================
# APP INIT
# =========================================================
app = FastAPI()


# =========================================================
# CORS
# =========================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# DB Dependency
# =========================================================
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# =========================================================
# CENTRAL COUNTRY CONFIGURATION
# =========================================================
CONTINENT_TO_REGION = {
    "AF": "Africa",
    "AS": "Asia",
    "EU": "Europe",
    "NA": "North America",
    "SA": "South America",
    "OC": "Oceania",
    "AN": "Antarctica",
}

MIDDLE_EAST_ISO = {
    "AE", "BH", "CY", "EG", "IQ", "IR", "IL", "JO", "KW",
    "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE",
}

CURSOR_FILE = os.path.join(os.path.dirname(__file__), ".ingest_cursor.json")
INGEST_BATCH_SIZE = max(1, int(os.getenv("INGEST_BATCH_SIZE", "25")))


def resolve_region(alpha2: str) -> str:
    if alpha2 in MIDDLE_EAST_ISO:
        return "Middle East"
    try:
        continent_code = pc.country_alpha2_to_continent_code(alpha2)
        return CONTINENT_TO_REGION.get(continent_code, "Global")
    except Exception:
        return "Global"


def build_country_catalog() -> list[dict]:
    countries = []
    for c in pycountry.countries:
        code = getattr(c, "alpha_2", None)
        if not code:
            continue

        # Use canonical short country name for UI/map compatibility.
        name = c.name
        query_terms = [f'"{name}"']
        if getattr(c, "official_name", None):
            query_terms.append(f'"{c.official_name}"')
        if getattr(c, "common_name", None):
            query_terms.append(f'"{c.common_name}"')
        query_terms.append(code)

        countries.append({
            "name": name,
            "code": code,
            "query": " OR ".join(dict.fromkeys(query_terms)),
            "region": resolve_region(code),
        })

    countries.sort(key=lambda x: x["name"])
    return countries


COUNTRIES = build_country_catalog()
COUNTRY_MAP = {c["code"]: c for c in COUNTRIES}

BASE_QUERY = "politics OR war OR conflict OR sanctions OR diplomacy OR military OR crisis"


def build_query(country_query: str) -> str:
    """Combine country-specific terms with geopolitical base query."""
    return f"({country_query}) AND ({BASE_QUERY})"


# =========================================================
# HELPER: GET OR CREATE COUNTRY
# =========================================================
def get_or_create_country(db: Session, country_data: dict) -> models.Country:
    country = (
        db.query(models.Country)
        .filter(models.Country.iso_code == country_data["code"])
        .first()
    )
    if not country:
        country = models.Country(
            name=country_data["name"],
            iso_code=country_data["code"],
            region=country_data.get("region", "Unknown")
        )
        db.add(country)
        db.commit()
        db.refresh(country)
        print(f"  ✅ Created country: {country.name} ({country.iso_code})")
    return country


# =========================================================
# HELPER: GET OR CREATE SOURCE
# =========================================================
def get_or_create_source(db: Session, source_name: str, country_id: int) -> models.Source:
    source = (
        db.query(models.Source)
        .filter(models.Source.name == source_name)
        .first()
    )
    if not source:
        source = models.Source(name=source_name, country_id=country_id)
        db.add(source)
        db.commit()
        db.refresh(source)
    return source


# =========================================================
# HELPER: LOOKUP COUNTRY CONFIG BY ISO CODE
# =========================================================
def find_country_config(iso_code: str) -> dict:
    """Find a country config entry by ISO code, or build a fallback."""
    iso_code = iso_code.strip().upper()
    if iso_code in COUNTRY_MAP:
        return COUNTRY_MAP[iso_code]
    # Fallback for unknown codes
    return {"name": iso_code, "code": iso_code, "query": iso_code, "region": "Unknown"}


def ensure_country_catalog_in_db(db: Session) -> None:
    """
    Ensure DB has the full ISO country catalog and normalized names/regions.
    This keeps map labels and backend country names aligned.
    """
    existing = {c.iso_code: c for c in db.query(models.Country).all()}

    for cfg in COUNTRIES:
        current = existing.get(cfg["code"])
        if current:
            changed = False
            if current.name != cfg["name"]:
                current.name = cfg["name"]
                changed = True
            if current.region != cfg["region"]:
                current.region = cfg["region"]
                changed = True
            if changed:
                db.add(current)
        else:
            db.add(models.Country(
                name=cfg["name"],
                iso_code=cfg["code"],
                region=cfg["region"],
            ))

    db.commit()


def load_cursor() -> int:
    if not os.path.exists(CURSOR_FILE):
        return 0
    try:
        with open(CURSOR_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        return int(data.get("cursor", 0))
    except Exception:
        return 0


def save_cursor(cursor: int) -> None:
    try:
        with open(CURSOR_FILE, "w", encoding="utf-8") as f:
            json.dump({"cursor": cursor}, f)
    except Exception:
        logger.warning("Could not persist ingest cursor")


def get_country_batch(size: int) -> tuple[list[dict], int]:
    if not COUNTRIES:
        return [], 0

    size = max(1, min(size, len(COUNTRIES)))
    current = load_cursor() % len(COUNTRIES)
    batch = [COUNTRIES[(current + i) % len(COUNTRIES)] for i in range(size)]
    next_cursor = (current + size) % len(COUNTRIES)
    save_cursor(next_cursor)
    return batch, current


# =========================================================
# CORE INGESTION LOGIC
# =========================================================
def ingest_news_for_country(country_iso: str, db: Session):

    from app.finbert import analyze_sentiment
    from app.services.gnews_service import fetch_gnews
    from app.services.rss_service import fetch_rss

    # ── Validate API Keys ────────────────────────────────
    NEWS_API_KEY = os.getenv("NEWS_API_KEY")
    print("🔑 NEWS_API_KEY:", "YES" if NEWS_API_KEY else "❌ NONE")

    # ── Resolve country config ───────────────────────────
    country_cfg = find_country_config(country_iso)
    country = get_or_create_country(db, country_cfg)
    print(f"🌍 Ingesting for: {country.name} ({country.iso_code})")

    # ── Build dynamic query ──────────────────────────────
    query_string = build_query(country_cfg["query"])
    print("📡 Query:", query_string)

    # ── SOURCE 1: NewsAPI ────────────────────────────────
    newsapi_articles = []
    if NEWS_API_KEY:
        try:
            response = requests.get(
                "https://newsapi.org/v2/everything",
                params={
                    "q": query_string,
                    "language": "en",
                    "sortBy": "publishedAt",
                    "pageSize": 20,
                    "apiKey": NEWS_API_KEY,
                },
                timeout=15,
            )
            if response.status_code == 200:
                data = response.json()
                newsapi_articles = data.get("articles", [])
                print(f"  📡 NewsAPI: {len(newsapi_articles)} articles")
            else:
                print(f"  ❌ NewsAPI error: {response.status_code}")
        except requests.exceptions.RequestException as e:
            print(f"  ❌ NewsAPI request failed: {e}")

    # ── SOURCE 2: GNews ──────────────────────────────────
    gnews_articles = fetch_gnews(query_string, country_cfg["code"])

    # ── SOURCE 3: RSS Feeds ──────────────────────────────
    rss_articles = fetch_rss(country_cfg["query"])

    # ── Merge all sources ────────────────────────────────
    articles = newsapi_articles + gnews_articles + rss_articles
    print(f"  📦 Combined: {len(newsapi_articles)} NewsAPI + {len(gnews_articles)} GNews + {len(rss_articles)} RSS = {len(articles)} total")

    if not articles:
        print("⚠️ No articles from any source")
        return 0

    # ── Process & store articles ──────────────────────────
    saved_count = 0

    for item in articles:
        article_url = item.get("url")
        if not article_url:
            continue

        # Duplicate protection (url is UNIQUE in DB)
        exists = db.query(models.Article).filter(models.Article.url == article_url).first()
        if exists:
            continue

        # Source → Country link
        raw_source_name = item.get("source", {}).get("name") or "Unknown Source"
        source_name = f"{raw_source_name} [{country.iso_code}]"
        source = get_or_create_source(db, source_name, country.id)

        # Parse date
        raw_date = item.get("publishedAt")
        if raw_date:
            try:
                pub_date = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            except Exception:
                pub_date = datetime.utcnow()
        else:
            pub_date = datetime.utcnow()

        # Sentiment (FinBERT + keyword override — untouched)
        text = (item.get("title") or "") + " " + (item.get("description") or "")
        sentiment_score, label = analyze_sentiment(text)

        print(f"  🧠 {label:>8} ({sentiment_score:+.3f}) │ {text[:70]}")

        new_article = models.Article(
            title=item.get("title"),
            description=item.get("description"),
            url=article_url,
            source_id=source.id,
            published_at=pub_date,
            sentiment_score=sentiment_score,
            sentiment_label=label
        )
        db.add(new_article)
        saved_count += 1

    db.commit()
    print(f"✅ {country.name}: {saved_count} articles saved")
    return saved_count


# =========================================================
# CLEANUP LOGIC (10-DAY RETENTION)
# =========================================================
def delete_old_articles(db: Session):
    threshold = datetime.utcnow() - timedelta(days=10)
    db.query(models.Article).filter(
        models.Article.published_at < threshold
    ).delete()
    db.commit()


# =========================================================
# AUTOMATIC SCHEDULER (uses COUNTRIES config)
# =========================================================
scheduler = BackgroundScheduler()


def auto_ingest_all_countries():
    """Scheduled job: ingest rotating global country batches."""
    db = SessionLocal()
    try:
        logger.info("⏰ Scheduled ingestion starting...")
        ensure_country_catalog_in_db(db)
        batch, start_idx = get_country_batch(INGEST_BATCH_SIZE)
        logger.info(
            "🌍 Ingest batch: start=%s size=%s of total=%s",
            start_idx,
            len(batch),
            len(COUNTRIES),
        )
        for country_cfg in batch:
            get_or_create_country(db, country_cfg)
            ingest_news_for_country(country_cfg["code"], db)
        delete_old_articles(db)
        logger.info("⏰ Scheduled ingestion complete")
    except Exception as e:
        logger.error(f"❌ Scheduled ingestion failed: {e}", exc_info=True)
    finally:
        db.close()


@app.on_event("startup")
def start_scheduler():
    logger.info("🚀 Starting background scheduler...")
    db = SessionLocal()
    try:
        ensure_country_catalog_in_db(db)
        logger.info("✅ Country catalog synced in DB (%s countries)", len(COUNTRIES))
    finally:
        db.close()

    if not scheduler.get_jobs():
        scheduler.add_job(
            auto_ingest_all_countries,
            "interval",
            minutes=30,
            id="auto_ingest_job",
            replace_existing=True
        )
        scheduler.start()
        logger.info("✅ Scheduler started — ingestion every 30 minutes")
    
    # Run first ingestion immediately in a background thread
    threading.Thread(target=auto_ingest_all_countries, daemon=True).start()
    logger.info("🔄 Initial ingestion triggered in background thread")


@app.on_event("shutdown")
def shutdown_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("🛑 Scheduler shut down")


# =========================================================
# ROOT
# =========================================================
@app.get("/")
def root():
    return {"message": "Geopolitical News Intelligence Backend Running"}


# =========================================================
# COUNTRY ROUTES
# =========================================================
@app.post("/countries", response_model=schemas.CountryResponse)
def create_country(country: schemas.CountryCreate, db: Session = Depends(get_db)):
    db_country = models.Country(**country.dict())
    db.add(db_country)
    db.commit()
    db.refresh(db_country)
    return db_country


@app.get("/countries", response_model=list[schemas.CountryResponse])
def get_countries(db: Session = Depends(get_db)):
    ensure_country_catalog_in_db(db)
    return db.query(models.Country).all()


# =========================================================
# SOURCE ROUTES
# =========================================================
@app.post("/sources", response_model=schemas.SourceResponse)
def create_source(source: schemas.SourceCreate, db: Session = Depends(get_db)):
    db_source = models.Source(**source.dict())
    db.add(db_source)
    db.commit()
    db.refresh(db_source)
    return db_source


@app.get("/sources", response_model=list[schemas.SourceResponse])
def get_sources(db: Session = Depends(get_db)):
    return (
        db.query(models.Source)
        .options(joinedload(models.Source.country))
        .all()
    )


# =========================================================
# ARTICLE ROUTES
# =========================================================
@app.post("/articles", response_model=schemas.ArticleResponse)
def create_article(article: schemas.ArticleCreate, db: Session = Depends(get_db)):
    db_article = models.Article(**article.dict())
    db.add(db_article)
    db.commit()
    db.refresh(db_article)
    return db_article


@app.get("/articles", response_model=list[schemas.ArticleResponse])
def get_articles(country: str | None = None, db: Session = Depends(get_db)):
    query = (
        db.query(models.Article)
        .options(
            joinedload(models.Article.source)
            .joinedload(models.Source.country)
        )
    )

    if country:
        country_term = country.strip()
        if country_term:
            query = (
                query.join(models.Article.source)
                .join(models.Source.country)
                .filter(
                    (models.Country.iso_code == country_term.upper()) |
                    (models.Country.name.ilike(country_term))
                )
            )

    return query.order_by(models.Article.published_at.desc()).all()


# =========================================================
# MANUAL INGEST ENDPOINT (single country)
# =========================================================
@app.post("/ingest-news")
def ingest_news(country_iso: str, db: Session = Depends(get_db)):
    saved = ingest_news_for_country(country_iso, db)
    return {"message": "News ingestion completed", "articles_saved": saved}


# =========================================================
# MULTI-COUNTRY BATCH INGEST (uses global COUNTRY catalog)
# =========================================================
@app.post("/ingest-all")
def ingest_all_countries(
    limit: int = Query(default=50, ge=1, le=249),
    db: Session = Depends(get_db)
):
    print("====================================")
    print("🌐 GLOBAL INGESTION")
    print("====================================")

    ensure_country_catalog_in_db(db)
    results = {}
    selected = COUNTRIES[:limit]
    for country_cfg in selected:
        get_or_create_country(db, country_cfg)
        saved = ingest_news_for_country(country_cfg["code"], db)
        results[country_cfg["code"]] = saved

    total = sum(results.values())
    print(f"✅ Total across {len(selected)} countries: {total}")

    return {
        "message": "Global ingestion completed",
        "catalog_total": len(COUNTRIES),
        "ingested_count": len(selected),
        "results": results,
        "total_saved": total
    }


@app.post("/ingest-batch")
def ingest_country_batch(
    size: int = Query(default=25, ge=1, le=100),
    db: Session = Depends(get_db)
):
    ensure_country_catalog_in_db(db)
    batch, start_idx = get_country_batch(size)
    results = {}
    for country_cfg in batch:
        get_or_create_country(db, country_cfg)
        saved = ingest_news_for_country(country_cfg["code"], db)
        results[country_cfg["code"]] = saved

    return {
        "message": "Batch ingestion completed",
        "catalog_total": len(COUNTRIES),
        "batch_start_index": start_idx,
        "batch_size": len(batch),
        "total_saved": sum(results.values()),
        "results": results,
    }


@app.get("/country-catalog")
def get_country_catalog():
    return {
        "total": len(COUNTRIES),
        "sample": COUNTRIES[:20]
    }


# =========================================================
# REFRESH: CLEAR OLD + RE-INGEST WITH SENTIMENT
# =========================================================
@app.post("/refresh-news")
def refresh_news(db: Session = Depends(get_db)):
    # Delete all existing articles so duplicates don't block re-ingestion
    deleted = db.query(models.Article).delete()
    db.commit()

    # Re-ingest for all countries
    countries = db.query(models.Country).all()
    total_saved = 0
    for country in countries:
        total_saved += ingest_news_for_country(country.iso_code, db)

    return {
        "message": "Full refresh completed",
        "articles_deleted": deleted,
        "articles_saved": total_saved
    }


# =========================================================
# GEOPOLITICAL RISK ENGINE
# =========================================================
def calculate_risk(db: Session):
    """
    Compute a weighted geopolitical risk score per country.

    Improved formula:
        negative_scores = sum(abs(score)) for all articles with score < 0
        risk_score = (negative_scores / total_articles) * 100

    This captures keyword-boosted negatives even if FinBERT
    originally labeled them differently.

    Risk levels:
        >= 70  → high
        >= 40  → medium
        <  40  → low
    """

    countries = db.query(models.Country).all()
    results = []

    for country in countries:
        # ── Join: Article → Source → Country ──────────────
        all_articles = (
            db.query(models.Article)
            .join(models.Source, models.Article.source_id == models.Source.id)
            .filter(models.Source.country_id == country.id)
            .all()
        )

        total_articles = len(all_articles)

        # ── Edge case: no articles ───────────────────────
        if total_articles == 0:
            print(f"⚠️ Risk calc: {country.name} — 0 articles, skipping")
            results.append({
                "country": country.name,
                "iso_code": country.iso_code,
                "total_articles": 0,
                "negative_articles": 0,
                "risk_score": 0.0,
                "risk_level": "low"
            })
            continue

        # ── Improved: use score < 0 (catches boosted negatives) ──
        negative_articles = [
            a for a in all_articles
            if a.sentiment_score is not None and a.sentiment_score < 0
        ]
        negative_count = len(negative_articles)

        negative_scores = sum(
            abs(a.sentiment_score) for a in negative_articles
        )

        risk_score = round((negative_scores / total_articles) * 100, 2)

        # ── Classify risk level ──────────────────────────
        if risk_score >= 70:
            risk_level = "high"
        elif risk_score >= 40:
            risk_level = "medium"
        else:
            risk_level = "low"

        print(f"🔎 Risk calculation: {country.name} → "
              f"score={risk_score}, level={risk_level}, "
              f"neg={negative_count}/{total_articles}")

        results.append({
            "country": country.name,
            "iso_code": country.iso_code,
            "total_articles": total_articles,
            "negative_articles": negative_count,
            "risk_score": risk_score,
            "risk_level": risk_level
        })

    # ── Sort: highest risk first ─────────────────────────
    results.sort(key=lambda r: r["risk_score"], reverse=True)

    return results


@app.get("/risk-analysis")
def risk_analysis(db: Session = Depends(get_db)):
    print("====================================")
    print("🌐 GEOPOLITICAL RISK ANALYSIS")
    print("====================================")

    results = calculate_risk(db)

    print(f"✅ Risk analysis complete — {len(results)} countries evaluated")
    return results
