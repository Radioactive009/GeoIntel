from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


# ---------- COUNTRY ----------
class CountryBase(BaseModel):
    name: str
    iso_code: str
    region: Optional[str] = None


class CountryCreate(CountryBase):
    pass


class CountryResponse(CountryBase):
    id: int

    model_config = ConfigDict(from_attributes=True)


# ---------- SOURCE ----------
class SourceBase(BaseModel):
    name: str


class SourceCreate(SourceBase):
    pass


class SourceResponse(BaseModel):
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


# ---------- ARTICLE ----------
class ArticleBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    url: str
    source_id: int


class ArticleCreate(ArticleBase):
    country_id: Optional[int] = None
    event_type: Optional[str] = None
    category: Optional[str] = None


class ArticleResponse(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    url: str
    published_at: datetime
    provider: Optional[str] = None

    sentiment_score: Optional[float] = None
    sentiment_label: Optional[str] = None
    geo_risk_score: Optional[float] = None
    geo_risk_level: Optional[str] = None
    event_type: Optional[str] = None
    category: Optional[str] = None

    # Flattened from the article's country relationship.
    country: Optional[str] = None
    country_iso_code: Optional[str] = None
    region: Optional[str] = None

    source: Optional[SourceResponse] = None

    model_config = ConfigDict(from_attributes=True)


class ArticlePage(BaseModel):
    """Paginated article feed. The old endpoint returned the whole table."""
    items: list[ArticleResponse]
    total: int
    limit: int
    offset: int


# ---------- ALERTS ----------
class AlertResponse(BaseModel):
    country: str
    iso_code: str
    region: Optional[str] = None
    total_articles: int
    critical_alerts: int
    # Sample-size adjusted score used for ranking and map colour.
    alert_level: float
    # Unadjusted mean, exposed so the adjustment stays inspectable.
    raw_alert_level: float = 0.0
    alert_status: str


# ---------- TRENDS ----------
class TrendPoint(BaseModel):
    t: datetime
    score: float
    articles: int


class MoverResponse(BaseModel):
    iso_code: str
    country: str
    current: float
    baseline: float
    delta: float
    # Move expressed against the country's own spread, not a raw delta.
    z_score: float
    article_count: int
    observations: int
    direction: str
