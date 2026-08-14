"""
Event grouping.

The behaviour that matters is measured, not asserted: these use the real
Colombian earthquake headlines that motivated the feature, because they are
the case that broke the previous approach — 70 articles about one happening
split across 68 story keys.
"""

from datetime import datetime, timedelta

import pytest

from app.services.events import (
    MIN_TOKENS,
    event_tokens,
    extract_figures,
    group_articles,
    similarity,
)

BASE = datetime(2026, 8, 10, 12, 0)
CO, UA = 10, 20

# Verbatim from the live corpus.
QUAKE = [
    (1, "Deadly 7.4-magnitude earthquake strikes western Colombia", 0),
    (2, "At least 111 killed, more trapped under rubble after 7.4 magnitude earthquake", 2),
    (3, "Colombia earthquake: Death toll rises to over 100", 6),
    (4, "Rescuers scramble for survivors with 180 dead in Colombia earthquake", 31),
    (5, "Live updates: More than 200 dead in Colombia earthquake", 36),
]


def _rows(items, country=CO, topic="disaster"):
    return [
        (i, title, None, country, topic, BASE + timedelta(hours=offset))
        for i, title, offset in items
    ]


class TestGrouping:
    def test_one_happening_becomes_one_event(self):
        assignment = group_articles(_rows(QUAKE))
        assert len(set(assignment.values())) == 1, (
            f"expected one event, got {len(set(assignment.values()))}: {assignment}"
        )

    def test_unrelated_story_in_the_same_country_stays_separate(self):
        rows = _rows(QUAKE) + [
            (99, "Colombia signs coffee export agreement with Brazil", None, CO, "economy",
             BASE + timedelta(hours=4))
        ]
        assignment = group_articles(rows)
        assert assignment[99] != assignment[1]

    def test_different_countries_do_not_merge(self):
        rows = _rows(QUAKE[:2]) + _rows(
            [(50, "Deadly earthquake strikes western Ukraine", 1)], country=UA
        )
        assignment = group_articles(rows)
        assert assignment[50] != assignment[1]

    def test_events_expire(self):
        """A matching headline months later is a new happening, not this one."""
        rows = _rows(QUAKE[:1]) + [
            (60, "Deadly 7.4-magnitude earthquake strikes western Colombia", None, CO,
             "disaster", BASE + timedelta(days=90))
        ]
        assignment = group_articles(rows)
        assert assignment[60] != assignment[1]

    def test_short_headlines_are_never_grouped(self):
        """"Fear game" would otherwise attach to anything nearby."""
        rows = _rows(QUAKE[:2]) + [
            (70, "Fear game", None, CO, "disaster", BASE),
            (71, "Live updates", None, CO, "disaster", BASE),
        ]
        assignment = group_articles(rows)
        assert assignment[70] != assignment[71]
        assert len(event_tokens("Fear game")) < MIN_TOKENS


class TestStability:
    def test_regrouping_does_not_rename_events(self):
        """
        Event keys appear in URLs. If a cycle reinvented them the archive
        would reshuffle underneath every link pointing at one.
        """
        rows = _rows(QUAKE)
        first = group_articles(rows)
        assert group_articles(rows, known=first) == first

    def test_a_follow_up_joins_the_existing_event(self):
        rows = _rows(QUAKE)
        first = group_articles(rows)
        later = (80, "Colombia earthquake death toll passes 240 as search ends", None, CO,
                 "disaster", BASE + timedelta(hours=48))
        second = group_articles(rows + [later], known=first)
        assert second[80] == first[1], "an update must not found a new event"


class TestSimilarity:
    def test_overlap_is_symmetric_and_bounded(self):
        a, b = frozenset("abcd"), frozenset("cdef")
        assert similarity(a, b) == similarity(b, a)
        assert 0.0 <= similarity(a, b) <= 1.0

    def test_empty_sets_score_zero(self):
        assert similarity(frozenset(), frozenset("abc")) == 0.0

    def test_containment_scores_full(self):
        """Overlap, not Jaccard: a short headline inside a long one matches."""
        assert similarity(frozenset("ab"), frozenset("abcdef")) == 1.0


class TestFigures:
    @pytest.mark.parametrize("text,expected", [
        ("At least 111 killed in Colombia earthquake", {"deaths": 111}),
        ("More than 200 dead in Colombia earthquake", {"deaths": 200}),
        ("Rescuers scramble for survivors with 180 dead", {"deaths": 180}),
        ("At least 111 killed, 200 missing", {"deaths": 111, "missing": 200}),
        ("1,200 displaced by flooding", {"displaced": 1200}),
    ])
    def test_reads_reported_counts(self, text, expected):
        assert extract_figures(text) == expected

    def test_ignores_text_without_figures(self):
        assert extract_figures("Colombia earthquake response continues") == {}
        assert extract_figures(None) == {}

    def test_ignores_implausible_values(self):
        assert "deaths" not in extract_figures("Since 20000000 killed records began")

    def test_progression_is_visible_across_an_event(self):
        """The feature this exists for: a toll moving as the event develops."""
        tolls = [
            extract_figures(title).get("deaths")
            for _, title, _ in QUAKE
            if extract_figures(title).get("deaths")
        ]
        assert tolls == sorted(tolls), "expected a rising toll"
        assert tolls[0] < tolls[-1]


class TestVerbFirstFigures:
    """
    "Earthquake kills 132" is at least as common a headline form as
    "132 killed", and the original pattern required the count first. On the
    live corpus that word order accounted for more missed death tolls than
    the pattern caught — 28 against 27 — so half of all reported tolls were
    invisible to event timelines and to anything the assistant said about
    casualties.
    """

    @pytest.mark.parametrize("headline,expected", [
        ("Earthquake Kills 132 In Colombia", 132),
        ("Russian barrage on Ukraine kills 9, wounds dozens", 9),
        ("Ebola outbreak kills 1,707 as spread outpaces tracing", 1707),
        ("Attack kills at least 25 people", 25),
        ("Strike killing 40 civilians", 40),
    ])
    def test_the_count_may_follow_the_verb(self, headline, expected):
        assert extract_figures(headline)["deaths"] == expected

    @pytest.mark.parametrize("headline,expected", [
        ("200 killed in earthquake", {"deaths": 200}),
        ("At least 111 killed, 200 missing", {"deaths": 111, "missing": 200}),
    ])
    def test_the_original_order_still_works(self, headline, expected):
        assert extract_figures(headline) == expected

    def test_the_larger_claim_wins_across_both_orders(self):
        """Tolls are revised upward within a single headline too."""
        assert extract_figures("Quake kills 40; 111 killed overall")["deaths"] == 111

    def test_wounded_counts_are_not_folded_into_the_toll(self):
        """Only verbs that state a death toll directly are read this way."""
        assert extract_figures("Attack kills 7, wounds 30") == {"deaths": 7}

    def test_a_headline_with_no_figure_yields_nothing(self):
        assert extract_figures("Talks resume after long delay") == {}
