from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session, joinedload
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime, timedelta
import requests
import os
from dotenv import load_dotenv
import logging
import threading

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
COUNTRIES = [
    {"name": "United States", "code": "US", "query": "US OR United States", "region": "North America"},
    {"name": "India",         "code": "IN", "query": "India",              "region": "South Asia"},
    {"name": "China",         "code": "CN", "query": "China",              "region": "East Asia"},
    {"name": "Russia",        "code": "RU", "query": "Russia",             "region": "Europe"},
    {"name": "Iran",          "code": "IR", "query": "Iran",               "region": "Middle East"},
    {"name": "South Africa",  "code": "ZA", "query": "South Africa",       "region": "Africa"},
    {"name": "Nigeria",       "code": "NG", "query": "Nigeria",            "region": "Africa"},
    {"name": "Egypt",         "code": "EG", "query": "Egypt",              "region": "Africa"},
    {"name": "Ethiopia",      "code": "ET", "query": "Ethiopia",           "region": "Africa"},
    {"name": "Kenya",         "code": "KE", "query": "Kenya",              "region": "Africa"},
    {"name": "Algeria",       "code": "DZ", "query": "Algeria",            "region": "Africa"},
    {"name": "Morocco",       "code": "MA", "query": "Morocco",            "region": "Africa"},
    {"name": "Ghana",         "code": "GH", "query": "Ghana",              "region": "Africa"},
    {"name": "Sudan",         "code": "SD", "query": "Sudan",              "region": "Africa"},
    {"name": "DR Congo",      "code": "CD", "query": "DR Congo OR Democratic Republic of the Congo", "region": "Africa"},
    {"name": "Argentina",     "code": "AR", "query": "Argentina",          "region": "South America"},
    {"name": "Brazil",        "code": "BR", "query": "Brazil",             "region": "South America"},
    {"name": "Chile",         "code": "CL", "query": "Chile",              "region": "South America"},
    {"name": "Colombia",      "code": "CO", "query": "Colombia",           "region": "South America"},
    {"name": "Peru",          "code": "PE", "query": "Peru",               "region": "South America"},
    {"name": "Venezuela",     "code": "VE", "query": "Venezuela",          "region": "South America"},
    {"name": "Ecuador",       "code": "EC", "query": "Ecuador",            "region": "South America"},
    {"name": "Bolivia",       "code": "BO", "query": "Bolivia",            "region": "South America"},
    {"name": "Paraguay",      "code": "PY", "query": "Paraguay",           "region": "South America"},
    {"name": "Uruguay",       "code": "UY", "query": "Uruguay",            "region": "South America"},
]

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
    for c in COUNTRIES:
        if c["code"] == iso_code:
            return c
    # Fallback for unknown codes
    return {"name": iso_code, "code": iso_code, "query": iso_code, "region": "Unknown"}


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
        source_name = item.get("source", {}).get("name") or "Unknown Source"
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
    """Scheduled job: ingest for every configured country."""
    db = SessionLocal()
    try:
        logger.info("⏰ Scheduled ingestion starting...")
        for country_cfg in COUNTRIES:
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
# MULTI-COUNTRY BATCH INGEST (uses COUNTRIES config)
# =========================================================
@app.post("/ingest-all")
def ingest_all_countries(db: Session = Depends(get_db)):
    print("====================================")
    print("🌐 MULTI-COUNTRY INGESTION")
    print("====================================")

    results = {}
    for country_cfg in COUNTRIES:
        get_or_create_country(db, country_cfg)
        saved = ingest_news_for_country(country_cfg["code"], db)
        results[country_cfg["code"]] = saved

    total = sum(results.values())
    print(f"✅ Total across {len(COUNTRIES)} countries: {total}")

    return {
        "message": "Multi-country ingestion completed",
        "results": results,
        "total_saved": total
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
