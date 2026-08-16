"""
The daily brief.

It is the one page that speaks in the site's own voice rather than quoting an
outlet, which makes an invented figure in it indistinguishable from a real
one. These tests exist mostly to hold that line: every sentence has to be
traceable to something counted, and a thin archive has to say so rather than
describe a dominant story built on one report.
"""

from datetime import datetime, timedelta

import pytest

from itertools import count

from app import models
from app.services import brief

_seq = count()


@pytest.fixture
def outlets(db):
    rows = [models.Source(name=f"Outlet {i}", reliability=1.0) for i in range(8)]
    db.add_all(rows)
    db.commit()
    return rows


def _article(db, outlets, *, title, key, country_id, index, risk=50.0,
             tone="neutral", hours_ago=1, duplicate=False):
    return models.Article(
        url=f"https://example.com/{key}-{next(_seq)}",
        title=title,
        description="",
        event_key=key,
        country_id=country_id,
        source_id=outlets[index % len(outlets)].id,
        geo_risk_score=risk,
        tone=tone,
        is_duplicate=duplicate,
        published_at=datetime.utcnow() - timedelta(hours=hours_ago),
    )


class TestComposition:
    def test_an_empty_archive_says_nothing_happened(self, db):
        result = brief.build_brief(db)
        assert "Nothing was collected" in result["summary"]
        assert result["events"] == []

    def test_a_thin_archive_admits_it_is_thin(self, db, countries, outlets):
        """Three reports must not become 'the day's dominant story'."""
        db.add_all([
            _article(db, outlets, title=f"A small item {i}", key="ev-1",
                     country_id=countries["UA"], index=i)
            for i in range(3)
        ])
        db.commit()

        summary = brief.build_brief(db)["summary"]
        assert "too little to characterise" in summary
        assert "most widely carried" not in summary

    def test_it_leads_on_the_most_carried_story(self, db, countries, outlets):
        db.add_all([
            _article(db, outlets, title="Widely carried story", key="big",
                     country_id=countries["UA"], index=i, tone="serious")
            for i in range(8)
        ] + [
            _article(db, outlets, title="Barely noticed", key="small",
                     country_id=countries["IN"], index=i, tone="serious")
            for i in range(3)
        ] + [
            _article(db, outlets, title=f"Filler {i}", key=f"f{i}",
                     country_id=countries["IN"], index=i, tone="serious")
            for i in range(9)
        ])
        db.commit()

        result = brief.build_brief(db)
        assert "Widely carried story" in result["summary"]
        assert result["events"][0]["title"] == "Widely carried story"

    def test_reach_outranks_severity(self, db, countries, outlets):
        """A story ten outlets carried is the day's story, however nasty a
        single-outlet report elsewhere was."""
        db.add_all([
            _article(db, outlets, title="Carried everywhere", key="wide",
                     country_id=countries["UA"], index=i, risk=30.0)
            for i in range(7)
        ] + [
            _article(db, outlets, title="Grim but ignored", key="narrow",
                     country_id=countries["IN"], index=0, risk=99.0, hours_ago=2)
            for _ in range(3)
        ])
        db.commit()
        assert brief.build_brief(db)["events"][0]["title"] == "Carried everywhere"

    def test_pluralisation_is_not_naive(self, db, countries, outlets):
        """It said '148 countrys', on the one page written in the site's voice."""
        db.add_all([
            _article(db, outlets, title=f"Item {i}", key=f"e{i}",
                     country_id=countries["UA" if i % 2 else "IN"], index=i)
            for i in range(14)
        ])
        db.commit()
        summary = brief.build_brief(db)["summary"]
        assert "countrys" not in summary
        assert "countries" in summary or "1 country" in summary


class TestGrounding:
    def test_single_outlet_repetition_is_not_an_event(self, db, countries, outlets):
        """Below the threshold it is one outlet talking to itself."""
        db.add_all([
            _article(db, outlets, title="Only twice", key="thin",
                     country_id=countries["UA"], index=i)
            for i in range(brief.MIN_REPORTS_TO_FEATURE - 1)
        ])
        db.commit()
        assert brief.build_brief(db)["events"] == []

    def test_duplicates_are_not_counted_twice(self, db, countries, outlets):
        """Otherwise reach — the thing the brief ranks on — is inflated."""
        db.add_all([
            _article(db, outlets, title="Real report", key="ev", index=i,
                     country_id=countries["UA"])
            for i in range(4)
        ] + [
            _article(db, outlets, title="Syndicated copy", key="ev", index=i,
                     country_id=countries["UA"], duplicate=True, hours_ago=2)
            for i in range(6)
        ])
        db.commit()
        assert brief.build_brief(db)["events"][0]["reports"] == 4

    def test_the_highest_reported_figure_is_used_not_the_latest(self, db, countries, outlets):
        """Tolls are revised upward, and the last headline is often not the
        fullest one."""
        db.add_all([
            _article(db, outlets, title="Quake kills 12", key="q",
                     country_id=countries["UA"], index=0, hours_ago=5),
            _article(db, outlets, title="Quake kills 200", key="q",
                     country_id=countries["UA"], index=1, hours_ago=3),
            _article(db, outlets, title="Quake recovery begins", key="q",
                     country_id=countries["UA"], index=2, hours_ago=1),
        ])
        db.commit()
        assert brief.build_brief(db)["events"][0]["figures"].get("deaths") == 200

    def test_the_window_is_respected(self, db, countries, outlets):
        db.add_all([
            _article(db, outlets, title="Old news", key="old", index=i,
                     country_id=countries["UA"], hours_ago=200)
            for i in range(5)
        ])
        db.commit()
        assert brief.build_brief(db, hours=24)["events"] == []

    def test_an_absurd_window_is_clamped_rather_than_obeyed(self, db):
        # A month is the longest window worth composing: the compilation a
        # reader revises from covers one, and beyond that the summary stops
        # describing anything recent.
        assert brief.build_brief(db, hours=99999)["window_hours"] <= 24 * 31
        assert brief.build_brief(db, hours=0)["window_hours"] >= 1


class TestEndpoint:
    def test_it_returns_the_documented_shape(self, client):
        response = client.get("/brief?hours=48")
        assert response.status_code == 200
        body = response.json()
        for field in ("generated_at", "window_hours", "summary", "coverage",
                      "events", "escalating", "contested"):
            assert field in body
        assert isinstance(body["summary"], str) and body["summary"]

    def test_it_works_with_no_api_keys_configured(self, client, monkeypatch):
        """The brief must not be another thing that needs a key to function."""
        monkeypatch.delenv("GROQ_API_KEY", raising=False)
        assert client.get("/brief").status_code == 200
