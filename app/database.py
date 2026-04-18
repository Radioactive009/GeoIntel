import os
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

# -- Dynamic Database Selection ---------------------------
# If DATABASE_URL is found (production), use PostgreSQL.
# Otherwise, default to local SQLite.
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

if SQLALCHEMY_DATABASE_URL:
    # Fix for Heroku/Render-style postgres prefixes
    if SQLALCHEMY_DATABASE_URL.startswith("postgres://"):
        SQLALCHEMY_DATABASE_URL = SQLALCHEMY_DATABASE_URL.replace("postgres://", "postgresql://", 1)
    
    # Production Engine (PostgreSQL)
    engine = create_engine(SQLALCHEMY_DATABASE_URL)
else:
    # Development Engine (SQLite)
    # check_same_thread=False is required for SQLite and FastAPI
    SQLALCHEMY_DATABASE_URL = "sqlite:///./geopolitics.db"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()