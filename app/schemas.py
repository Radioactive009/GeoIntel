from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


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
    # uplifting | serious | neutral
    tone: Optional[str] = None
    tone_score: Optional[float] = None

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


# ---------- EVENTS ----------
class FigurePoint(BaseModel):
    """A reported count at a moment, e.g. a death toll as it was then."""
    t: datetime
    value: int
    source: Optional[str] = None
    title: Optional[str] = None


class EventSummary(BaseModel):
    event_key: str
    title: str                       # representative headline
    article_count: int
    outlet_count: int
    countries: list[str] = []
    topic: Optional[str] = None
    risk: float = 0.0
    first_seen: datetime
    last_seen: datetime
    image_url: Optional[str] = None
    # Latest reported counts by kind, e.g. {"deaths": 200}.
    figures: dict[str, int] = {}


class OutletFraming(BaseModel):
    source: str
    score: float
    divergence: float          # against the consensus of all outlets
    reports: int
    spread: float              # the outlet's own variance, so noise is visible


class FramingReport(BaseModel):
    available: bool = False
    reason: Optional[str] = None
    consensus: float = 0.0
    spread: float = 0.0
    contested: bool = False
    highest: Optional[OutletFraming] = None
    lowest: Optional[OutletFraming] = None
    outlets: list[OutletFraming] = []


class CoveragePoint(BaseModel):
    hour: float
    count: int


class CoverageCurve(BaseModel):
    available: bool = False
    points: list[CoveragePoint] = []
    span_hours: float = 0.0
    # When half of everything ever written about it had been written.
    half_life_hours: float = 0.0
    peak_hour: float = 0.0
    shape: str = "single report"


class ContestedEvent(BaseModel):
    event_key: str
    title: str
    article_count: int
    outlet_count: int
    consensus: float
    # Spread across every outlet — what the ranking uses.
    spread: float = 0.0
    # Highest minus lowest, shown for illustration only.
    gap: float
    highest: OutletFraming
    lowest: OutletFraming
    first_seen: Optional[datetime] = None


class ContestedResponse(BaseModel):
    window_hours: int
    events: list[ContestedEvent]


class EventDetail(EventSummary):
    articles: list[ArticleResponse] = []
    outlets: list[str] = []
    # How a reported figure moved as the event developed.
    timeline: dict[str, list[FigurePoint]] = {}
    # How outlets differed on how serious it was.
    framing: FramingReport = FramingReport()
    # When coverage arrived and how quickly it stopped.
    coverage: CoverageCurve = CoverageCurve()


class EventsResponse(BaseModel):
    window_hours: int
    events: list[EventSummary]


# ---------- DAILY BRIEF ----------
class BriefEvent(BaseModel):
    event_key: str
    title: Optional[str] = None
    reports: int
    outlets: int
    outlet_names: list[str] = []
    countries: list[str] = []
    topic: Optional[str] = None
    risk: float = 0.0
    # Highest figure seen for each kind, e.g. {"deaths": 200}.
    figures: dict[str, int] = {}
    image_url: Optional[str] = None


class BriefMover(BaseModel):
    country: str
    iso_code: Optional[str] = None
    baseline: float
    current: float
    # Movement against the country's own spread, not a raw delta.
    sigma: float


class BriefContested(BaseModel):
    event_key: str
    title: Optional[str] = None
    outlets: int
    spread: float
    consensus: float


class BriefCoverage(BaseModel):
    articles: int
    outlets: int
    countries: int
    tone: dict[str, int] = {}


class BriefResponse(BaseModel):
    generated_at: datetime
    window_hours: int
    # Composed from counted figures only — never a model's prose.
    summary: str
    coverage: BriefCoverage
    events: list[BriefEvent] = []
    escalating: list[BriefMover] = []
    contested: list[BriefContested] = []


# ---------- AGENT ----------
class AgentTurn(BaseModel):
    role: str
    content: str


class AgentQuestion(BaseModel):
    question: str
    # Prior turns, so a follow-up ("and Ukraine?") has something to refer to.
    history: list[AgentTurn] = []


class SpeechRequest(BaseModel):
    # Bounded here as well as truncated in the service. The service caps what
    # is *sent upstream*, which bounds the bill; this caps what is accepted at
    # all, so a public endpoint cannot be made to hold an arbitrarily large
    # body in memory first.
    text: str = Field(max_length=8000)
    # Overriding the persona per request is useful for trying voices without a
    # redeploy; the server still bounds length and cost regardless.
    voice: Optional[str] = Field(default=None, max_length=40)


class AgentSource(BaseModel):
    id: Optional[int] = None
    title: Optional[str] = None
    source: Optional[str] = None
    country: Optional[str] = None
    published: Optional[str] = None
    risk: Optional[float] = None
    topic: Optional[str] = None


class AgentAnswer(BaseModel):
    answer: Optional[str] = None
    # The articles the tools actually returned, so the answer can be checked.
    sources: list[AgentSource] = []
    tools_used: list[str] = []
    # False means the answer came from the model's own knowledge rather than
    # this site's articles. Derived from whether a tool ran.
    from_archive: bool = False
    error: Optional[str] = None


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
