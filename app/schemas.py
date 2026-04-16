from pydantic import BaseModel
from datetime import datetime
from typing import Optional


# ---------- COUNTRY ----------
class CountryBase(BaseModel):
    name: str
    iso_code: str
    region: str


class CountryCreate(CountryBase):
    pass


class CountryResponse(CountryBase):
    id: int

    class Config:
        orm_mode = True


# ---------- SOURCE ----------
class SourceBase(BaseModel):
    name: str
    country_id: int


class SourceCreate(SourceBase):
    pass


class SourceResponse(BaseModel):
    id: int
    name: str
    country: CountryResponse

    class Config:
        orm_mode = True


# ---------- ARTICLE ----------
class ArticleBase(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    url: str
    source_id: int


class ArticleCreate(ArticleBase):
    pass


class ArticleResponse(BaseModel):
    id: int
    title: Optional[str] = None
    description: Optional[str] = None
    url: str
    published_at: datetime
    sentiment_score: Optional[float] = None
    sentiment_label: Optional[str] = None
    geo_risk_score: Optional[float] = None
    geo_risk_level: Optional[str] = None
    country: Optional[str] = None
    country_iso_code: Optional[str] = None
    source: SourceResponse

    class Config:
        orm_mode = True
