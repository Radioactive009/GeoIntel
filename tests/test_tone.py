"""
Tone classification.

The asymmetry under test: labelling a grim story as uplifting breaks the only
promise the good-news section makes, while labelling an uplifting story as
neutral merely under-fills it. So the "must not be uplifting" cases matter
more than the "should be", and every one of them is a real headline that a
naive VADER-plus-keywords pass got wrong.
"""

import pytest

from app.services.tone import NEUTRAL, SERIOUS, UPLIFTING, classify_tone


class TestNeverMislabelsHarm:
    @pytest.mark.parametrize("headline", [
        # Positive verb, distressing subject.
        "Young girl finds whale stranded on Australian beach",
        # "Approves" and "protections" read positive; the story ends them.
        "Judge approves Trump effort to end South Sudan TPS protections",
        # "Vaccine" is hopeful; an Ebola outbreak is not good news.
        "WHO urges Ervebo vaccine trial in DR Congo Ebola outbreak",
        "Ebola in DR Congo: Childhood deaths rise; hopes raised over new vaccine",
        # "Rescuers" and "survivors" are hopeful words in a disaster.
        "Rescuers scramble for survivors with 180 dead in Colombia earthquake",
        "Russian shelling kills nine in Kharkiv",
        "Famine declared as aid convoys are blocked at the border",
    ])
    def test_harm_is_never_uplifting(self, headline):
        tone, _ = classify_tone(headline)
        assert tone != UPLIFTING, f"{headline!r} must not be good news"

    def test_harm_beats_an_uplifting_source(self):
        """Constructive outlets still cover hard subjects."""
        tone, _ = classify_tone(
            "Thousands killed as earthquake devastates the region", None, "Good News Network"
        )
        assert tone == SERIOUS


class TestRecognisesGenuineRelief:
    @pytest.mark.parametrize("headline", [
        "Missing hiker found alive after five days in the mountains",
        "Family reunited after decades apart",
        "Community rallied to rebuild the school destroyed last year",
    ])
    def test_decisive_phrases_do_not_need_sentiment_agreement(self, headline):
        """
        VADER scores "Missing hiker found alive" at 0.10 — it weighs "missing"
        against "alive" — so requiring a sentiment floor lost the story.
        """
        tone, _ = classify_tone(headline)
        assert tone == UPLIFTING

    def test_constructive_outlets_are_trusted(self):
        for source in ("Good News Network", "Reasons to be Cheerful", "Positive News"):
            tone, _ = classify_tone("More dads are taking parental leave", None, source)
            assert tone == UPLIFTING, source


class TestNeutralIsAllowed:
    @pytest.mark.parametrize("headline", [
        "Chinese EV sales surge to new high in Europe putting tariffs under scrutiny",
        "Central bank holds interest rates at four percent",
        "Minister opens new bypass in the north of the county",
    ])
    def test_routine_news_is_neither(self, headline):
        """
        Most news is neither a lift nor a weight. Forcing every story to a pole
        is what puts a stranded whale in a feel-good section.
        """
        assert classify_tone(headline)[0] == NEUTRAL

    def test_empty_input_is_safe(self):
        assert classify_tone(None, None) == (NEUTRAL, 0.0)
        assert classify_tone("", "") == (NEUTRAL, 0.0)


class TestScore:
    def test_score_is_bounded_and_signed_consistently(self):
        for headline in ("Russian shelling kills nine", "Family reunited after decades",
                         "Central bank holds rates"):
            tone, score = classify_tone(headline)
            assert -1.0 <= score <= 1.0
            if tone == UPLIFTING:
                assert score > 0, "an uplifting story must not carry a negative score"
            if tone == SERIOUS:
                assert score < 0
