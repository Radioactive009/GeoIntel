from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Float
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base


# 🌍 COUNTRY TABLE
class Country(Base):
    __tablename__ = "countries"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    iso_code = Column(String, unique=True, nullable=False)
    region = Column(String)

    # Relationships
    sources = relationship(
        "Source",
        back_populates="country",
        cascade="all, delete"
    )


# 📰 SOURCE TABLE
class Source(Base):
    __tablename__ = "sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    country_id = Column(Integer, ForeignKey("countries.id"))

    # Relationships
    country = relationship("Country", back_populates="sources")
    articles = relationship(
        "Article",
        back_populates="source",
        cascade="all, delete"
    )


# 📄 ARTICLE TABLE
class Article(Base):
    __tablename__ = "articles"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String)
    description = Column(String)
    url = Column(String, unique=True, nullable=False)
    published_at = Column(DateTime, default=datetime.utcnow)

    source_id = Column(Integer, ForeignKey("sources.id"))

    # Relationships
    source = relationship("Source", back_populates="articles")

    # 🔥 SENTIMENT FIELDS (FIXED)
    sentiment_score = Column(Float)
    sentiment_label = Column(String)

    @property
    def country(self):
        if self.source and self.source.country:
            return self.source.country.name
        return None

    @property
    def country_iso_code(self):
        if self.source and self.source.country:
            return self.source.country.iso_code
        return None
