"""
Topic classification.

Accuracy is measured against tests/data/gold_headlines.json — real headlines
from the live corpus, hand-labelled — rather than asserted. The threshold is a
floor, so a change that quietly makes classification worse fails here.
"""

import json
from pathlib import Path

import pytest

from app.services.classifier import NOISE, classify, classify_event_type

GOLD = json.loads(
    (Path(__file__).parent / "data" / "gold_headlines.json").read_text(encoding="utf-8")
)["labels"]

# The keyword counter this replaced scored 47% on the same set.
ACCURACY_FLOOR = 0.82


def _normalise(category: str) -> str:
    return "noise" if category == NOISE else category


def test_accuracy_against_labelled_corpus():
    correct = sum(1 for title, label in GOLD if _normalise(classify(title).category) == label)
    accuracy = correct / len(GOLD)
    assert accuracy >= ACCURACY_FLOOR, (
        f"accuracy fell to {accuracy:.0%} on {len(GOLD)} labelled headlines "
        f"(floor {ACCURACY_FLOOR:.0%})"
    )


@pytest.mark.parametrize("category", ["disaster", "humanitarian", "diplomacy", "economy"])
def test_strong_categories_stay_strong(category):
    """These reached 100% when the classifier was written; hold that line."""
    items = [(t, l) for t, l in GOLD if l == category]
    correct = sum(1 for title, _ in items if classify(title).category == category)
    assert correct / len(items) >= 0.9, f"{category} regressed to {correct}/{len(items)}"


class TestSpecificFailures:
    """Each of these was a real misclassification in the live corpus."""

    def test_plural_forms_match(self):
        # `\battack\b` did not match "Attacks", so this scored no evidence.
        assert classify("Myanmar Ramps Up Civilian Attacks With Airborne Weapons").category == "conflict"

    def test_natural_disasters_have_a_home(self):
        # Previously matched nothing at all and fell back to "political".
        assert classify("111 Killed After 7.4 Magnitude Earthquake Jolts Colombia").category == "disaster"

    def test_epidemics_are_humanitarian_not_hazard(self):
        assert classify("Congo Ebola outbreak began in February, WHO says").category == "humanitarian"

    def test_mention_is_not_topic(self):
        # Contains "war", but is a story about financing.
        assert classify(
            "Kenya seeks $450 million World Bank funds to offset Iran war shock"
        ).category == "economy"

    def test_metaphorical_war_is_not_conflict(self):
        for headline in (
            "Australia: I Squared Capital Wins Bidding War for oOh!Media",
            "Actor's widow in prenup war with his mother",
        ):
            assert classify(headline).category != "conflict", headline

    def test_terrorism_outranks_generic_military_vocabulary(self):
        assert classify(
            "Mali Army Says Over 50 JNIM Terrorists Killed In Repelled Assault On Military Base"
        ).category == "security"

    def test_sport_and_entertainment_are_rejected(self):
        for headline in (
            "TIFF Docs Lineup Announced: Rapinoe, Said, Love",
            "Russian federation files fresh CAS challenge against World Athletics sanctions",
        ):
            assert classify(headline).category == NOISE, headline


class TestConfidence:
    def test_clear_story_is_confident(self):
        result = classify("Russian shelling kills nine in Kharkiv as artillery hits the front line")
        assert result.reason == "confident"
        assert result.confidence > 0.5
        assert not result.needs_review

    def test_empty_input_is_safe(self):
        result = classify(None, None)
        assert result.category == NOISE
        assert not result.is_relevant

    def test_unsure_results_are_flagged_for_review(self):
        """What the LLM layer spends its budget on."""
        flagged = sum(1 for title, _ in GOLD if classify(title).needs_review)
        assert 0 < flagged < len(GOLD) * 0.4, (
            f"{flagged}/{len(GOLD)} flagged — too many makes the LLM pass expensive, "
            "too few means it never gets to help"
        )

    def test_confidence_is_bounded(self):
        for title, _ in GOLD:
            assert 0.0 <= classify(title).confidence <= 1.0


def test_convenience_wrapper_matches_full_result():
    for title, _ in GOLD[:20]:
        assert classify_event_type(title) == classify(title).category
