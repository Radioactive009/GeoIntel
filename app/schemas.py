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
    image_url: Optional[str] = None
    country_id: Optional[int] = None
    event_type: Optional[str] = None
    category: Optional[str] = None


class ArticleResponse(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    url: str
    # Null whenever the feed published no artwork (all Google News items).
    image_url: Optional[str] = None
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
    # Second country in the story, when it is about a pair.
    country_secondary: Optional[str] = None
    country_secondary_iso_code: Optional[str] = None

    # Other outlets that carried this same story. Filled in by the endpoint.
    duplicate_count: int = 0

    source: Optional[SourceResponse] = None

    model_config = ConfigDict(from_attributes=True)


# ---------- RELATIONS ----------
class RelationPair(BaseModel):
    iso_codes: list[str]
    countries: list[str]
    articles: int
    avg_risk: float
    status: str
    latest: Optional[datetime] = None


class RelationsResponse(BaseModel):
    window_hours: int
    pairs: list[RelationPair]


class ArticleDetail(ArticleResponse):
    """One article with the coverage around it, for the story page."""
    # Same event as carried by other outlets, from the story cluster.
    also_reported_by: list[ArticleResponse] = []
    # Other recent stories about the same country.
    related: list[ArticleResponse] = []


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


class TrendsResponse(BaseModel):
    window_hours: int
    series: dict[str, list[TrendPoint]]


class HistoryFrame(BaseModel):
    t: datetime
    # iso_code -> risk score at that hour
    scores: dict[str, float]


class HistoryFramesResponse(BaseModel):
    window_hours: int
    frames: list[HistoryFrame]


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


class MoversResponse(BaseModel):
    window_hours: int
    tracked_countries: int
    eligible_countries: int
    rising: list[MoverResponse]
    falling: list[MoverResponse]
    # How much history exists — used by the UI to explain an empty board.
    history: dict = {}
