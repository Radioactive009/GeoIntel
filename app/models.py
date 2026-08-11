from sqlalchemy import (
    Column, Integer, String, ForeignKey, DateTime, Float, Index, UniqueConstraint,
)
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


# [GLOBAL] COUNTRY TABLE
class Country(Base):
    __tablename__ = "countries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    iso_code = Column(String, unique=True, nullable=False)
    region = Column(String)

    articles = relationship("Article", back_populates="country_rel")


# [DATA] SOURCE TABLE
#
# One row per news outlet. Sources used to be duplicated per ingest country
# ("BBC News [AE]", "BBC News [BV]", ...) which produced 3253 rows for ~1100
# real outlets and attached a meaningless country to each. An outlet is now
# country-agnostic; the country lives on the article.
class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)

    articles = relationship("Article", back_populates="source")


# [DOC] ARTICLE TABLE
class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(String)
    url = Column(String, unique=True, nullable=False)
    published_at = Column(DateTime, default=datetime.utcnow, index=True)

    source_id = Column(Integer, ForeignKey("sources.id"), index=True)
    # Country the article is *about*, resolved from its text.
    country_id = Column(Integer, ForeignKey("countries.id"), index=True)
    # Which ingest provider delivered it (newsapi | gnews | rss).
    provider = Column(String)

    source = relationship("Source", back_populates="articles")
    country_rel = relationship("Country", back_populates="articles")

    # [LEGACY] SENTIMENT FIELDS (kept for backwards compatibility)
    sentiment_score = Column(Float)
    sentiment_label = Column(String)

    # [AI] SEMANTIC RISK ENGINE FIELDS
    geo_risk_score = Column(Float)   # 0-100
    geo_risk_level = Column(String)  # low | medium | high
    event_type = Column(String)      # military | diplomatic | economic | political | hazard
    category = Column(String)        # strategic_activity | conflict | news

    @property
    def country(self) -> str | None:
        return self.country_rel.name if self.country_rel else None

    @property
    def country_iso_code(self) -> str | None:
        return self.country_rel.iso_code if self.country_rel else None

    @property
    def region(self) -> str | None:
        return self.country_rel.region if self.country_rel else None


# Feed queries filter by country and sort by recency.
Index("ix_articles_country_published", Article.country_id, Article.published_at)


# [TREND] COUNTRY RISK HISTORY
#
# One row per country per hour. Without this the dashboard could only ever
# describe the present, so nothing could say whether a country was escalating
# or calming down. Bucketed hourly (ingest runs every 30 minutes) and pruned
# on a retention window, which keeps the table small on SQLite.
class CountryRiskSnapshot(Base):
    __tablename__ = "country_risk_history"

    id = Column(Integer, primary_key=True, index=True)
    country_id = Column(Integer, ForeignKey("countries.id"), nullable=False, index=True)
    captured_at = Column(DateTime, nullable=False, index=True)

    risk_score = Column(Float)       # sample-size adjusted score
    raw_risk_score = Column(Float)   # unadjusted mean, kept for transparency
    article_count = Column(Integer)
    high_count = Column(Integer)

    country = relationship("Country")

    __table_args__ = (
        UniqueConstraint("country_id", "captured_at", name="uq_country_snapshot"),
        Index("ix_snapshot_country_time", "country_id", "captured_at"),
    )


# [LIVE] NEWS CHANNEL
#
# A broadcaster's 24/7 YouTube stream, tied to a country so the map selection
# can drive both the article feed and the live player.
#
# `live_video_id` is resolved server-side because an embedded iframe is
# cross-origin: the page cannot tell whether a stream failed to load, so the
# check has to happen here and be stored.
class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    handle = Column(String, unique=True, nullable=False)
    youtube_channel_id = Column(String, unique=True, nullable=False)

    country_id = Column(Integer, ForeignKey("countries.id"), index=True)
    language = Column(String)
    is_enabled = Column(Integer, default=True)

    # Liveness cache, refreshed on a schedule.
    is_live = Column(Integer, default=False)
    live_video_id = Column(String)
    live_title = Column(String)
    checked_at = Column(DateTime)

    country = relationship("Country")


# [GLOBAL] SYSTEM STATE TABLE
class SystemState(Base):
    __tablename__ = "system_state"

    key = Column(String, primary_key=True, index=True)
    value = Column(String)
