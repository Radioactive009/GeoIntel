import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

# -- Dynamic Database Selection ---------------------------
# DATABASE_URL selects the backend (PostgreSQL in production); without it we
# fall back to a local SQLite file.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL") or "sqlite:///./geopolitics.db"

# Heroku/Render still hand out the legacy postgres:// prefix.
if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
    SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)

# check_same_thread=False is required for SQLite under FastAPI. It was
# previously applied only to the default path, so pointing DATABASE_URL at any
# SQLite file produced cross-thread errors as soon as the scheduler ran.
connect_args = (
    {"check_same_thread": False}
    if SQLALCHEMY_DATABASE_URL.startswith("sqlite")
    else {}
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,  # drop connections killed by an idle proxy
)

if SQLALCHEMY_DATABASE_URL.startswith("sqlite"):
    # SQLite ignores foreign keys unless asked, per connection. Without this,
    # an article could be stored against a source_id that does not exist —
    # accepted locally, rejected by the Postgres used in production, so the
    # two supported backends disagreed about what a valid write is.
    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
