"""
Event analytics: outlet framing and attention decay.

Both readings are only possible because articles are grouped into events, and
both are easy to get subtly wrong in ways that produce confident nonsense —
which is what most of these tests guard.
"""

from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest

from app.services.framing import contested_events, coverage_curve, outlet_framing

BASE = datetime(2026, 8, 10, 12, 0)


def _article(source, score, hours=0, title="Something happened somewhere today"):
    return SimpleNamespace(
        source=SimpleNamespace(name=source),
        geo_risk_score=score,
        published_at=BASE + timedelta(hours=hours),
        title=title,
    )


class TestOutletFraming:
    def test_compares_outlet_means_not_articles(self):
        """
        One Liberian paper scored its own four reports 95.6, 94.4, 93.0 and
        87.8. Comparing articles measures headline wording; comparing outlet
        means measures the outlet.
        """
        articles = [
            *[_article("Prolific Paper", s) for s in (95.6, 94.4, 93.0, 87.8)],
            _article("Wire A", 40.0),
            _article("Wire B", 42.0),
        ]
        report = outlet_framing(articles)

        prolific = next(o for o in report["outlets"] if o["source"] == "Prolific Paper")
        assert prolific["reports"] == 4
        assert prolific["score"] == pytest.approx(92.7, abs=0.1)

    def test_consensus_is_not_dominated_by_a_prolific_outlet(self):
        """
        Ten reports from one outlet and one from another is not a consensus of
        ten-to-one; it is two outlets.
        """
        articles = [*[_article("Loud", 90.0) for _ in range(10)],
                    _article("Quiet A", 30.0), _article("Quiet B", 30.0)]
        report = outlet_framing(articles)
        # Mean of outlet means: (90 + 30 + 30) / 3 = 50, not ~80.
        assert report["consensus"] == pytest.approx(50.0, abs=0.1)

    def test_reports_each_outlets_own_variance(self):
        """A divergence from an outlet that disagrees with itself is noise."""
        articles = [
            _article("Erratic", 90.0), _article("Erratic", 30.0),
            _article("Steady A", 55.0), _article("Steady B", 57.0),
        ]
        report = outlet_framing(articles)
        erratic = next(o for o in report["outlets"] if o["source"] == "Erratic")
        steady = next(o for o in report["outlets"] if o["source"] == "Steady A")
        assert erratic["spread"] > 20
        assert steady["spread"] == 0.0

    def test_needs_enough_outlets_to_have_a_consensus(self):
        report = outlet_framing([_article("Only One", 80.0), _article("Only Two", 20.0)])
        assert report["available"] is False

    def test_divergence_is_signed_around_the_consensus(self):
        articles = [_article("High", 90.0), _article("Mid", 50.0), _article("Low", 10.0)]
        report = outlet_framing(articles)
        assert report["highest"]["divergence"] > 0
        assert report["lowest"]["divergence"] < 0
        assert report["consensus"] == pytest.approx(50.0, abs=0.1)

    def test_agreement_is_not_contested(self):
        articles = [_article(f"Outlet {i}", 50.0 + i) for i in range(4)]
        assert outlet_framing(articles)["contested"] is False


class TestContestedRanking:
    def test_ranks_on_spread_across_all_outlets_not_the_extremes(self):
        """
        Ranking on highest-minus-lowest put two single-report outlets at the
        top of every list, with the lowest repeatedly at exactly 25.0 — the
        risk engine's baseline for a headline with no scoring keywords.
        """
        # One wild outlier, everyone else agreeing.
        outlier = {"ev_outlier": [
            *[_article(f"Agreeing {i}", 50.0) for i in range(5)],
            _article("Outlier", 95.0),
        ]}
        # Genuinely split down the middle.
        split = {"ev_split": [
            *[_article(f"High {i}", 85.0) for i in range(3)],
            *[_article(f"Low {i}", 25.0) for i in range(3)],
        ]}

        ranked = contested_events({**outlier, **split})
        assert ranked[0]["event_key"] == "ev_split", (
            "a real split must outrank a single unusual headline"
        )

    def test_ignores_events_with_too_few_outlets(self):
        thin = {"ev_thin": [_article("A", 90.0), _article("B", 20.0), _article("C", 55.0)]}
        assert contested_events(thin) == []

    def test_extremes_carry_their_report_counts(self):
        """So a single-article claim is visible as one."""
        grouped = {"ev": [
            *[_article("Backed", 88.0) for _ in range(3)],
            *[_article(f"Other {i}", 40.0) for i in range(4)],
            _article("Lone", 20.0),
        ]}
        result = contested_events(grouped)[0]
        assert result["highest"]["reports"] == 3
        assert result["lowest"]["reports"] == 1


class TestCoverageCurve:
    def test_detects_a_burst(self):
        """Most coverage in the opening stretch, then silence."""
        articles = [_article("O", 50.0, hours=h) for h in ([0, 1, 1, 2, 2, 3] + [40, 70])]
        curve = coverage_curve(articles)
        assert curve["shape"] == "burst"
        assert curve["half_life_hours"] < curve["span_hours"] / 2

    def test_detects_a_slow_burn(self):
        """Coverage that builds instead of breaking."""
        articles = [_article("O", 50.0, hours=h) for h in ([0, 1] + list(range(60, 80)))]
        curve = coverage_curve(articles)
        assert curve["shape"] == "slow burn"

    def test_half_life_is_when_half_the_coverage_had_landed(self):
        articles = [_article("O", 50.0, hours=h) for h in (0, 1, 2, 3, 100)]
        curve = coverage_curve(articles)
        # Three of five reports are in by hour 2; the late one must not drag it.
        assert curve["half_life_hours"] <= 3
        assert curve["span_hours"] == pytest.approx(100, abs=1)

    def test_single_report_has_no_curve(self):
        assert coverage_curve([_article("O", 50.0)])["available"] is False

    def test_points_cover_the_whole_span(self):
        articles = [_article("O", 50.0, hours=h) for h in range(0, 48, 4)]
        curve = coverage_curve(articles, buckets=12)
        assert len(curve["points"]) == 12
        assert sum(p["count"] for p in curve["points"]) == len(articles)
