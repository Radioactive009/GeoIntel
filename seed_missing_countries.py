"""
Seed news for countries that currently have 0 articles in the database.
Uses Google News RSS (free, unlimited, keyless) to fetch real coverage.

Run with:
    .\\venv\\Scripts\\python.exe seed_missing_countries.py [--limit N]
"""
import argparse
import logging
import sys
import time

from app.database import SessionLocal
from app import models
from app.services import alerts, ingest

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("seed_missing")


def seed_missing(limit: int = 50, batch_delay: float = 0.5):
    db = SessionLocal()
    try:
        ingest.ensure_country_catalog_in_db(db)

        # Find country IDs that already have at least 1 article
        attributed_subq = (
            db.query(models.Article.country_id)
            .filter(models.Article.country_id.isnot(None))
            .distinct()
        )

        missing_countries = (
            db.query(models.Country)
            .filter(~models.Country.id.in_(attributed_subq))
            .order_by(models.Country.name)
            .limit(limit)
            .all()
        )

        total_missing = (
            db.query(models.Country)
            .filter(~models.Country.id.in_(attributed_subq))
            .count()
        )

        print(f"Total countries missing news: {total_missing}")
        print(f"Ingesting up to {len(missing_countries)} countries in this run...")

        saved_total = 0
        success_count = 0

        for i, country in enumerate(missing_countries, 1):
            print(f"[{i}/{len(missing_countries)}] Fetching news for {country.name} ({country.iso_code})...", end=" ", flush=True)
            try:
                saved = ingest.ingest_news_for_country(country.iso_code, db)
                print(f"-> {saved} articles saved")
                if saved > 0:
                    saved_total += saved
                    success_count += 1
            except Exception as e:
                db.rollback()
                print(f"-> FAILED: {e}")

            if batch_delay:
                time.sleep(batch_delay)

        # Capture snapshot so new countries immediately appear on risk history & alert status
        try:
            snapshots = alerts.capture_snapshot(db)
            print(f"\nCaptured risk history snapshot for {snapshots} countries.")
        except Exception as e:
            print(f"Snapshot error: {e}")

        remaining = (
            db.query(models.Country)
            .filter(~models.Country.id.in_(attributed_subq))
            .count()
        )
        print(f"\nDone! Saved {saved_total} articles across {success_count} countries.")
        print(f"Remaining countries without news: {remaining}")

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Seed missing country news")
    parser.add_argument("--limit", type=int, default=40, help="Number of countries to ingest (default: 40)")
    parser.add_argument("--delay", type=float, default=0.2, help="Delay between requests in seconds (default: 0.2)")
    args = parser.parse_args()
    seed_missing(limit=args.limit, batch_delay=args.delay)
