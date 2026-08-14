"""Risk scoring: mitigation guards, classification, thresholds."""

import pytest

from app.services.risk_engine import (
    UNCLASSIFIED_EVENT_TYPE,
    _detect_mitigation,
    _reports_casualties,
    score_article,
)


class TestMitigation:
    def test_collapsing_ceasefire_is_not_de_escalated(self):
        """
        The bug this guards: "ceasefire" was matched as a bare substring, so a
        story about a ceasefire *collapsing* had 20 points deducted and scored
        medium (66.44) despite reporting deaths.
        """
        score, level, event_type, _ = score_article(
            "Ceasefire collapses as Israel strikes Gaza, dozens killed"
        )
        assert level == "high", f"scored {score}"
        assert event_type == "conflict"

    def test_genuine_de_escalation_still_scores_low(self):
        score, level, _, _ = score_article("Peace agreement signed, no casualties reported")
        assert level == "low", f"scored {score}"

    def test_mitigation_voided_by_contradiction(self):
        assert _detect_mitigation("ceasefire holds, talks continue") > 0
        assert _detect_mitigation("ceasefire collapses after strike") == 0

    def test_negated_casualties_are_not_casualties(self):
        assert _reports_casualties("no casualties were reported") is False
        assert _reports_casualties("dozens killed in the attack") is True

    def test_peace_does_not_fire_inside_peaceful(self):
        """Word-boundary matching: 'peaceful protest' is not a peace deal."""
        assert _detect_mitigation("peaceful protest crushed by police") == 0


class TestClassification:
    @pytest.mark.parametrize("text", [
        "Russian shelling kills 12 in Kharkiv",
        "Drone strike on military base",
        "Airstrikes hit the capital overnight",
    ])
    def test_strike_vocabulary_reads_as_military(self, text):
        """'strike'/'shelling'/'drone' were missing from the military list."""
        _, _, event_type, _ = score_article(text)
        assert event_type == "conflict"

    def test_economic_story_is_recognised(self):
        """The old lexicon had no signal for this and fell back to a default."""
        _, _, event_type, _ = score_article("Central bank raises interest rates amid inflation")
        assert event_type == "economy"

    def test_unmatched_text_is_not_asserted_as_political(self):
        _, _, event_type, _ = score_article("Local library extends its opening hours")
        assert event_type == UNCLASSIFIED_EVENT_TYPE

    def test_empty_text_is_safe(self):
        assert score_article("") == (0.0, "low", UNCLASSIFIED_EVENT_TYPE, "news")
        assert score_article("   ")[1] == "low"


class TestThresholds:
    def test_score_is_bounded(self):
        for text in ["war invasion nuke genocide massacre attack bombing killed", "", "quiet day"]:
            score, _, _, _ = score_article(text)
            assert 0.0 <= score <= 100.0
