"""Alert scoring, snapshot windowing, relations, and history frames."""

from datetime import datetime, timedelta

from app import models
from app.services import alerts


def _article(url, country_id, score, source_id, published=None, duplicate=False, secondary=None):
    return models.Article(
        url=url, title=url, country_id=country_id, country_id_secondary=secondary,
        geo_risk_score=score, geo_risk_level="high" if score >= 70 else "low",
        source_id=source_id, is_duplicate=duplicate,
        published_at=published or datetime.utcnow(),
    )


class TestSnapshotWindowing:
    def test_snapshot_describes_a_moment_not_the_whole_corpus(self, db, countries):
        """
        The bug this guards: capture aggregated every article ever stored, so
        each hourly row held the cumulative all-time mean. article_count only
        ever grew and the series tracked corpus growth, not events.
        """
        source = models.Source(name="Wire", reliability=1.0)
        db.add(source)
        db.commit()

        old = datetime.utcnow() - timedelta(days=10)
        db.add_all([
            _article("old-1", countries["IN"], 90.0, source.id, published=old),
            _article("old-2", countries["IN"], 90.0, source.id, published=old),
            _article("new-1", countries["IN"], 10.0, source.id),
        ])
        db.commit()

        alerts.capture_snapshot(db)
        snapshot = db.query(models.CountryRiskSnapshot).filter_by(country_id=countries["IN"]).one()

        assert snapshot.article_count == 1, "only the article inside the window counts"
        assert snapshot.risk_score < 50, "the 10-day-old spike must not dominate"

    def test_countries_without_recent_coverage_are_still_returned(self, db, countries):
        """The window is applied to the join, not a WHERE clause — a WHERE
        would turn the outer join inner and drop quiet countries entirely."""
        rows = alerts.compute_alert_status(db, since=datetime.utcnow() - timedelta(hours=1))
        assert len(rows) == len(countries)

    def test_snapshot_is_idempotent_within_the_hour(self, db, countries):
        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add(_article("a", countries["IN"], 50.0, source.id))
        db.commit()

        alerts.capture_snapshot(db)
        alerts.capture_snapshot(db)
        assert db.query(models.CountryRiskSnapshot).count() == 1


class TestSourceReliability:
    def test_low_confidence_outlet_moves_the_score_less(self, db, countries):
        wire = models.Source(name="Reuters", reliability=1.3)
        blog = models.Source(name="Unknown Source", reliability=0.7)
        db.add_all([wire, blog])
        db.commit()

        # Same two scores, opposite attributions.
        db.add_all([
            _article("w", countries["IN"], 20.0, wire.id),
            _article("b", countries["IN"], 100.0, blog.id),
        ])
        db.commit()
        india = next(r for r in alerts.compute_alert_status(db) if r["iso_code"] == "IN")

        unweighted_mean = 60.0
        assert india["raw_alert_level"] < unweighted_mean, (
            "the wire report should pull the average below a plain mean"
        )


class TestDuplicatesExcluded:
    def test_syndicated_copies_do_not_inflate_a_country(self, db, countries):
        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add_all([
            _article("canon", countries["IN"], 50.0, source.id),
            _article("dup-1", countries["IN"], 50.0, source.id, duplicate=True),
            _article("dup-2", countries["IN"], 50.0, source.id, duplicate=True),
        ])
        db.commit()

        india = next(r for r in alerts.compute_alert_status(db) if r["iso_code"] == "IN")
        assert india["total_articles"] == 1, "coverage volume is not extra risk"


class TestRelations:
    def test_pairs_aggregate_regardless_of_direction(self, db, countries):
        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add_all([
            _article("r1", countries["IN"], 60.0, source.id, secondary=countries["CN"]),
            _article("r2", countries["CN"], 60.0, source.id, secondary=countries["IN"]),
        ])
        db.commit()

        pairs = alerts.compute_relations(db, hours=168, limit=10)
        assert len(pairs) == 1, "A-B and B-A must merge into one pair"
        assert pairs[0]["articles"] == 2
        assert set(pairs[0]["iso_codes"]) == {"IN", "CN"}

    def test_articles_without_a_second_country_are_ignored(self, db, countries):
        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add(_article("solo", countries["IN"], 60.0, source.id))
        db.commit()
        assert alerts.compute_relations(db) == []

    def test_one_country_sees_its_own_pairs_from_either_side(self, db, countries):
        """A country desk asks a different question from the global board."""
        source = models.Source(name="Wire")
        db.add(source)
        db.commit()
        db.add_all([
            # India named first in one pairing, second in the other.
            _article("p1", countries["IN"], 60.0, source.id, secondary=countries["CN"]),
            _article("p2", countries["US"], 60.0, source.id, secondary=countries["IN"]),
            _article("p3", countries["UA"], 60.0, source.id, secondary=countries["US"]),
        ])
        db.commit()

        pairs = alerts.compute_relations(db, country="IN")
        assert {tuple(sorted(p["iso_codes"])) for p in pairs} == {("CN", "IN"), ("IN", "US")}, \
            "matched on either side, and the unrelated pair left out"

        assert alerts.compute_relations(db, country="India") == pairs, "name works as well as code"
        assert alerts.compute_relations(db, country="ZZ") == []
        assert len(alerts.compute_relations(db)) == 3, "unfiltered board is unchanged"


class TestHistoryFrames:
    def test_frames_share_one_timestamp_across_countries(self, db, countries):
        """trend_series thins each country independently, so index i means a
        different moment per country; frames must be aligned to replay."""
        bucket = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        db.add_all([
            models.CountryRiskSnapshot(country_id=countries["IN"], captured_at=bucket,
                                       risk_score=40.0, article_count=3),
            models.CountryRiskSnapshot(country_id=countries["CN"], captured_at=bucket,
                                       risk_score=55.0, article_count=2),
            models.CountryRiskSnapshot(country_id=countries["IN"], captured_at=bucket - timedelta(hours=1),
                                       risk_score=20.0, article_count=1),
        ])
        db.commit()

        frames = alerts.history_frames(db, hours=168, max_frames=36)
        assert len(frames) == 2
        assert frames[-1]["scores"] == {"IN": 40.0, "CN": 55.0}
        assert frames[0]["t"] < frames[-1]["t"], "frames run oldest to newest"

    def test_empty_history_yields_no_frames(self, db, countries):
        assert alerts.history_frames(db) == []
