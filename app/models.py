from sqlalchemy import (
    Boolean, Column, Integer, String, ForeignKey, DateTime, Float, Index,
    UniqueConstraint,
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

    # foreign_keys is required now that Article has two FKs into this table;
    # without it SQLAlchemy cannot tell which one defines the relationship.
    articles = relationship(
        "Article", back_populates="country_rel", foreign_keys="Article.country_id"
    )


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
    # Weight this outlet carries in a country's alert average. A tabloid's
    # alarm should not move a national threat level as much as a wire
    # service's. 1.0 is neutral; see services/reliability.py.
    reliability = Column(Float, default=1.0, nullable=False)

    articles = relationship("Article", back_populates="source")


# [DOC] ARTICLE TABLE
class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(String)
    url = Column(String, unique=True, nullable=False)
    # Lead artwork from the feed, when it publishes one. Google News carries
    # no image of any kind, so this is null for a large share of rows and the
    # UI must render without it rather than treating it as guaranteed.
    image_url = Column(String)
    published_at = Column(DateTime, default=datetime.utcnow, index=True)

    source_id = Column(Integer, ForeignKey("sources.id"), index=True)
    # Country the article is *about*, resolved from its text.
    country_id = Column(Integer, ForeignKey("countries.id"), index=True)
    # Second country named, when the story involves a pair (India/China,
    # Israel/Palestine). The resolver already ranks every country it finds;
    # this keeps the runner-up instead of discarding it, which is what makes
    # the bilateral view possible.
    country_id_secondary = Column(Integer, ForeignKey("countries.id"), index=True)
    # Which ingest provider delivered it (newsapi | gnews | rss).
    provider = Column(String)

    # Identity of the underlying event, shared by every outlet reporting it.
    story_key = Column(String, index=True)
    # True for the non-canonical copies of a story already in the feed. The
    # rows are kept rather than dropped so the card can say how many outlets
    # carried it.
    is_duplicate = Column(Boolean, default=False, nullable=False)

    source = relationship("Source", back_populates="articles")
    country_rel = relationship("Country", back_populates="articles", foreign_keys=[country_id])
    country_secondary_rel = relationship("Country", foreign_keys=[country_id_secondary])

    # [LEGACY] SENTIMENT FIELDS (kept for backwards compatibility)
    sentiment_score = Column(Float)
    sentiment_label = Column(String)

    # [AI] SEMANTIC RISK ENGINE FIELDS
    geo_risk_score = Column(Float)   # 0-100
    geo_risk_level = Column(String)  # low | medium | high
    # How clearly the topic was decided, 0-1. Recorded so a weak call can be
    # revisited or hidden rather than presented with the same authority as a
    # confident one.
    topic_confidence = Column(Float)
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

    @property
    def country_secondary(self) -> str | None:
        return self.country_secondary_rel.name if self.country_secondary_rel else None

    @property
    def country_secondary_iso_code(self) -> str | None:
        return self.country_secondary_rel.iso_code if self.country_secondary_rel else None


# Feed queries filter by country and sort by recency.
Index("ix_articles_country_published", Article.country_id, Article.published_at)
# The feed hides duplicates and orders by recency on every request.
Index("ix_articles_duplicate_published", Article.is_duplicate, Article.published_at)


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
    # Boolean, not Integer: SQLite treats them interchangeably, but Postgres
    # rejects a Python bool bound to an INTEGER column ("column is of type
    # integer but expression is of type boolean"), and `.is_(True)` filters
    # fail the same way. Declaring the real type keeps both backends working.
    is_enabled = Column(Boolean, default=True, nullable=False)

    # Liveness cache, refreshed on a schedule.
    is_live = Column(Boolean, default=False, nullable=False)
    live_video_id = Column(String)
    live_title = Column(String)
    checked_at = Column(DateTime)

    country = relationship("Country")


# [GLOBAL] SYSTEM STATE TABLE
class SystemState(Base):
    __tablename__ = "system_state"

    key = Column(String, primary_key=True, index=True)
    value = Column(String)
