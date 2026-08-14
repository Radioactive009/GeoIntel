"""HTTP surface: filters, error codes, auth, and the new endpoints."""

from datetime import datetime, timedelta

import pytest

from app import models


@pytest.fixture
def feed(db, countries):
    source = models.Source(name="BBC News", reliability=1.3)
    db.add(source)
    db.commit()

    rows = [
        models.Article(url="a1", title="India talks resume", description="A 100% tariff was floated",
                       country_id=countries["IN"], source_id=source.id, geo_risk_level="low",
                       event_type="diplomacy", story_key="k1", is_duplicate=False,
                       published_at=datetime.utcnow()),
        models.Article(url="a2", title="India talks resume (copy)", description="syndicated",
                       country_id=countries["IN"], source_id=source.id, geo_risk_level="low",
                       event_type="diplomacy", story_key="k1", is_duplicate=True,
                       published_at=datetime.utcnow()),
        models.Article(url="a3", title="Strike hits Kyiv", description="military action",
                       country_id=countries["UA"], country_id_secondary=countries["US"],
                       source_id=source.id, geo_risk_level="high", event_type="conflict",
                       story_key="k2", is_duplicate=False,
                       published_at=datetime.utcnow() - timedelta(days=40)),
    ]
    db.add_all(rows)
    db.commit()
    return rows


class TestArticleFilters:
    def test_duplicates_are_hidden_by_default(self, client, feed):
        assert client.get("/articles").json()["total"] == 2
        assert client.get("/articles", params={"include_duplicates": True}).json()["total"] == 3

    def test_duplicate_count_is_reported(self, client, feed):
        items = client.get("/articles").json()["items"]
        canonical = next(i for i in items if i["url"] == "a1")
        assert canonical["duplicate_count"] == 1

    def test_event_type_filter(self, client, feed):
        assert client.get("/articles", params={"event_type": "conflict"}).json()["total"] == 1
        assert client.get("/articles", params={"event_type": "disaster"}).json()["total"] == 0

    def test_days_filter(self, client, feed):
        assert client.get("/articles", params={"days": 1}).json()["total"] == 1

    def test_country_accepts_iso_or_name(self, client, feed):
        by_iso = client.get("/articles", params={"country": "IN"}).json()["total"]
        by_name = client.get("/articles", params={"country": "India"}).json()["total"]
        assert by_iso == by_name == 1

    def test_like_wildcards_are_escaped(self, client, feed):
        """?q=100% must not behave as "100 followed by anything"."""
        hits = client.get("/articles", params={"q": "100%"}).json()["items"]
        assert len(hits) == 1
        assert all("100%" in f"{h['title']} {h['description']}" for h in hits)

    def test_bare_wildcard_is_a_literal_search(self, client, feed):
        """"%" searches for a percent sign, not for everything. Only the one
        article whose text contains "100%" qualifies — not all three."""
        total = client.get("/articles", params={"q": "%"}).json()["total"]
        assert total == 1

    def test_underscore_is_not_a_single_char_wildcard(self, client, feed):
        assert client.get("/articles", params={"q": "_ndia"}).json()["total"] == 0

    def test_search_matches_title_and_description(self, client, feed):
        assert client.get("/articles", params={"q": "Kyiv"}).json()["total"] == 1


class TestWriteEndpoints:
    def test_duplicate_country_returns_409(self, client, countries, admin_headers):
        response = client.post("/countries", json={"name": "India", "iso_code": "IN"},
                               headers=admin_headers)
        assert response.status_code == 409

    def test_unknown_source_id_returns_400(self, client, admin_headers):
        response = client.post("/articles", json={"url": "x", "source_id": 999999, "title": "t"},
                               headers=admin_headers)
        assert response.status_code == 400

    def test_writes_require_the_key(self, client):
        assert client.post("/snapshot").status_code == 401

    def test_writes_accept_the_key(self, client, admin_headers):
        assert client.post("/snapshot", headers=admin_headers).status_code == 200

    def test_reads_stay_public(self, client):
        assert client.get("/articles").status_code == 200
        assert client.get("/health").status_code == 200

    def test_ingest_returns_immediately(self, client, admin_headers, monkeypatch):
        """A held-open cycle outlived the gateway timeout, so it now runs in
        the background and the caller polls."""
        import app.main as main
        monkeypatch.setattr(main, "run_ingest", lambda **_: {})
        response = client.post("/ingest-batch", headers=admin_headers)
        assert response.status_code == 202
        assert client.get("/ingest-status").status_code == 200


class TestFreshness:
    """
    /health drives the external scheduler that keeps the container awake, so
    its staleness signal has to be right in all three states.
    """

    def test_never_ingested_reads_as_stale(self, client, countries):
        payload = client.get("/health").json()
        assert payload["stale"] is True
        assert payload["minutes_since_ingest"] is None
        assert payload["last_ingest_at"] is None

    def test_recent_cycle_reads_as_current(self, client, db, countries):
        from app.services import ingest
        ingest.record_ingest_time(db)

        payload = client.get("/health").json()
        assert payload["stale"] is False
        assert payload["minutes_since_ingest"] < 1

    def test_old_cycle_reads_as_stale(self, client, db, countries):
        from app.services import ingest
        ingest.record_ingest_time(db, datetime.utcnow() - timedelta(hours=6))

        payload = client.get("/health").json()
        assert payload["stale"] is True
        assert payload["minutes_since_ingest"] > 300

    def test_freshness_tracks_the_cycle_not_the_newest_article(self, client, db, countries):
        """
        A quiet news hour must not read as a broken pipeline. If freshness were
        derived from max(published_at), an ingest that found nothing new would
        look identical to one that never ran.
        """
        from app import models
        from app.services import ingest

        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add(models.Article(url="stale-story", title="Published days ago",
                              country_id=countries["IN"], source_id=source.id,
                              published_at=datetime.utcnow() - timedelta(days=3)))
        db.commit()
        ingest.record_ingest_time(db)   # we just checked; there was nothing new

        payload = client.get("/health").json()
        assert payload["stale"] is False, "a quiet hour is not a stopped pipeline"

    def test_cycle_records_its_own_completion(self, db, countries, monkeypatch):
        from app.services import ingest

        # The providers are stubbed out: a test that reaches the live wire
        # feeds is slow, and fails whenever a publisher is having a bad day.
        for provider in ("fetch_global_rss", "fetch_country_rss", "fetch_gnews", "_fetch_newsapi"):
            monkeypatch.setattr(ingest, provider, lambda *args, **kwargs: [])

        assert ingest.last_ingest_at(db) is None
        ingest.run_ingest_cycle(db, batch_size=1)
        assert ingest.last_ingest_at(db) is not None


class TestStoryPage:
    def test_detail_returns_cluster_siblings(self, client, feed):
        """The story page's "also reported by" comes from the cluster key,
        which is what makes an article page worth having."""
        canonical = next(a for a in feed if a.url == "a1")
        payload = client.get(f"/articles/{canonical.id}").json()

        assert payload["title"] == canonical.title
        sources = [s["url"] for s in payload["also_reported_by"]]
        assert sources == ["a2"], "the syndicated copy should be listed"

    def test_detail_returns_same_country_coverage(self, client, feed, db, countries):
        from app import models
        source = db.query(models.Source).first()
        db.add(models.Article(url="extra", title="Another India story", country_id=countries["IN"],
                              source_id=source.id, story_key="k9", is_duplicate=False,
                              published_at=datetime.utcnow()))
        db.commit()

        canonical = next(a for a in feed if a.url == "a1")
        related = client.get(f"/articles/{canonical.id}").json()["related"]
        assert any(r["url"] == "extra" for r in related)
        assert all(r["url"] != "a2" for r in related), "the same event is not 'related'"

    def test_missing_story_is_404(self, client):
        assert client.get("/articles/99999999").status_code == 404


class TestRssFeed:
    def test_feed_is_valid_rss(self, client, feed):
        import xml.etree.ElementTree as ET

        response = client.get("/feed.xml")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/rss+xml")

        root = ET.fromstring(response.text)
        items = root.findall("./channel/item")
        assert len(items) == 2, "duplicates stay out of the feed"
        assert all(item.find("title") is not None for item in items)

    def test_feed_escapes_markup_in_titles(self, client, db, countries):
        """An unescaped & or < in a headline would make the feed unparseable."""
        import xml.etree.ElementTree as ET
        from app import models

        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add(models.Article(url="amp", title="Trade & tariffs <urgent>", country_id=countries["IN"],
                              source_id=source.id, is_duplicate=False, published_at=datetime.utcnow()))
        db.commit()

        ET.fromstring(client.get("/feed.xml").text)  # raises if malformed

    def test_feed_can_be_scoped_to_a_country(self, client, feed):
        import xml.etree.ElementTree as ET
        root = ET.fromstring(client.get("/feed.xml", params={"country": "UA"}).text)
        assert len(root.findall("./channel/item")) == 1


class TestNewEndpoints:
    def test_relations_pairs_countries(self, client, feed):
        pairs = client.get("/relations", params={"hours": 24 * 90}).json()["pairs"]
        assert len(pairs) == 1
        assert set(pairs[0]["iso_codes"]) == {"UA", "US"}

    def test_history_frames_shape(self, client, feed, admin_headers):
        client.post("/snapshot", headers=admin_headers)
        payload = client.get("/history-frames").json()
        assert payload["window_hours"] == 168
        assert len(payload["frames"]) >= 1
        assert isinstance(payload["frames"][0]["scores"], dict)

    def test_alert_analysis_accepts_a_window(self, client, feed):
        windowed = client.get("/alert-analysis", params={"hours": 24, "active_only": True}).json()
        all_time = client.get("/alert-analysis", params={"active_only": True}).json()
        assert len(windowed) <= len(all_time)

    @pytest.mark.parametrize("path", [
        "/health", "/stats", "/trends", "/movers", "/channels", "/relations",
        "/history-frames", "/countries", "/sources", "/country-catalog",
    ])
    def test_read_endpoints_respond(self, client, feed, path):
        assert client.get(path).status_code == 200
