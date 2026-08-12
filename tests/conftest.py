"""
Shared fixtures.

Every test runs against a throwaway SQLite file rather than the live
geopolitics.db, and the scheduler is disabled so importing the app does not
start background ingestion.
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Must be set before app.database is imported — the engine is built at import
# time from these, so a later assignment would have no effect.
_TMP = tempfile.mkdtemp()
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TMP, "test.db").replace("\\", "/")
os.environ["ENABLE_SCHEDULER"] = "false"
os.environ["ADMIN_API_KEY"] = "test-key"
os.environ["LOG_LEVEL"] = "ERROR"

from app import models  # noqa: E402
from app.database import Base, SessionLocal, engine  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _schema():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


@pytest.fixture(autouse=True)
def _clean(db):
    """Each test starts from an empty database."""
    for model in (
        models.CountryRiskSnapshot, models.Article, models.Channel,
        models.Source, models.Country, models.SystemState,
    ):
        db.query(model).delete()
    db.commit()
    yield


@pytest.fixture
def countries(db):
    rows = [
        models.Country(name="India", iso_code="IN", region="Asia"),
        models.Country(name="China", iso_code="CN", region="Asia"),
        models.Country(name="United States", iso_code="US", region="North America"),
        models.Country(name="Ukraine", iso_code="UA", region="Europe"),
    ]
    db.add_all(rows)
    db.commit()
    return {c.iso_code: c.id for c in rows}


@pytest.fixture
def client():
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client


@pytest.fixture
def admin_headers():
    return {"X-API-Key": "test-key"}
