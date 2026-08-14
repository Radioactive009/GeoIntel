"""
Event grouping — recognising that many articles describe one happening.

`story.story_key` identifies a story by the *set of words in its headline*,
which catches an outlet rewording a wire copy but nothing looser. Measured on
the live corpus that left 96% of clusters holding a single article, and split
70 articles about one Colombian earthquake across 68 keys:

    At least 111 killed, more trapped under rubble after 7.4 magnitude…
    Colombia earthquake: Death toll rises to over 100
    111 Killed After 7.4 Magnitude Earthquake Jolts Colombia

Those share almost no vocabulary, so no threshold on headline overlap alone
groups them. What they do share is context: the same country, the same topic,
within days of each other. Context is therefore used as evidence rather than
as a filter — inside a matching context a single shared distinctive term is
enough, while across contexts much stronger wording overlap is required.

Grouping is deliberately not clever. No embeddings, no model, no API: this
runs on every ingest cycle on a free-tier instance, and comparisons are
blocked by (country, week) so the work stays proportional to a day's news
rather than to the size of the archive.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from .story import significant_words

# Terms so common in news they identify nothing on their own. A shared
# "government" is not evidence that two articles describe one event.
UNINFORMATIVE = frozenset("""
government official minister president country state national international
world global people man woman year day time week month news media report
told called made take taking come coming going first last next new old
top big high low major key main way part case number group member
""".split())

# How far apart two articles may be and still describe the same happening.
# Coverage of a disaster or an offensive runs for days; beyond a week a
# matching headline is usually a new development rather than the same one.
WINDOW_DAYS = 6

# Overlap needed to merge. Inside a shared context (same country, same topic)
# the context itself is evidence, so less wording agreement is required.
#
# 0.28 was chosen by sweeping against the live corpus. Two headlines sharing
# only {colombia, earthquake} score 0.33 on short titles, so 0.34 rejected
# obviously-related coverage; below 0.28 the target case stopped improving
# (9 groups either way) while unrelated stories began merging elsewhere —
# singleton rate fell from 82% to 79% with nothing to show for it.
SAME_CONTEXT_THRESHOLD = 0.28
CROSS_CONTEXT_THRESHOLD = 0.62

# Below this many informative words a headline cannot be matched safely —
# "Fear game" would otherwise attach to anything.
MIN_TOKENS = 3


def event_tokens(title: str | None, description: str | None = None) -> frozenset[str]:
    """
    Words that could identify an event.

    The description is included but only lightly: a headline names the event,
    while body text wanders into context that would merge unrelated stories.
    """
    words = significant_words(title)
    if description:
        # Only the opening of the summary, which is usually the lede.
        words += significant_words(description[:180])
    return frozenset(w for w in words if w not in UNINFORMATIVE and len(w) > 3)


def similarity(a: frozenset[str], b: frozenset[str]) -> float:
    """
    Overlap coefficient rather than Jaccard.

    Jaccard punishes length differences, and news headlines vary wildly in
    length — a wire snippet and a feature on one event would score low purely
    because one says more. Dividing by the smaller set asks "is one
    essentially contained in the other", which is the question here.

    Terms are counted equally, which is not obvious and was measured. Weighting
    them by inverse document frequency — the standard move, on the theory that
    a shared "earthquake" says more than a shared "rescue" — made grouping
    worse on the live corpus: the Colombian earthquake split into 17 groups
    instead of 9, and the overall singleton rate rose from 82% to 85%.

    IDF is built for retrieval, where a term appearing everywhere is useless
    for telling documents apart. Event grouping wants the opposite. A burst of
    articles all saying "earthquake" is precisely what an event looks like, and
    IDF down-weights that term exactly when it becomes the strongest signal.
    """
    if not a or not b:
        return 0.0
    return len(a & b) / min(len(a), len(b))


# Absolute floor on shared vocabulary, which is what holds back drift: an
# event's memory is unbounded (see Event.core), so without this a Ukraine
# strike event widens until it is pulling in Black Sea shipping deals. One
# term in common is not an event — "Colombia" alone would merge every story
# about the country — and on a short headline a ratio can clear its threshold
# on a single word.
MIN_SHARED_TERMS = 2


@dataclass
class Event:
    """A group of articles believed to describe one happening."""
    key: str
    seed_tokens: frozenset[str]
    counts: dict = field(default_factory=dict)
    country_id: int | None = None
    topic: str | None = None
    first_seen: datetime = None
    last_seen: datetime = None
    members: list = field(default_factory=list)

    def core(self) -> frozenset[str]:
        """
        Every term the event has used.

        Deliberately unbounded. Outlets describe one happening with different
        words — "quake" and "earthquake", "death toll" and "killed" — and
        those are distinct tokens, so an event that only remembers its own
        opening vocabulary cannot recognise later coverage of itself.
        Restricting this to corroborated terms was tried and fragmented a
        70-article earthquake into 29 pieces.

        Drift is held back by MIN_SHARED_TERMS instead, which is a floor on
        evidence rather than a limit on memory.
        """
        return self.seed_tokens | frozenset(self.counts)

    def accepts(self, tokens: frozenset[str], country_id, topic, when: datetime) -> float:
        """Score how well an article fits, 0 meaning not at all."""
        if when < self.first_seen - timedelta(days=WINDOW_DAYS):
            return 0.0
        if when > self.last_seen + timedelta(days=WINDOW_DAYS):
            return 0.0

        same_context = country_id is not None and country_id == self.country_id and topic == self.topic
        core = self.core()
        if len(tokens & core) < MIN_SHARED_TERMS:
            return 0.0

        score = similarity(tokens, core)
        threshold = SAME_CONTEXT_THRESHOLD if same_context else CROSS_CONTEXT_THRESHOLD
        return score if score >= threshold else 0.0

    def absorb(self, article_id, tokens: frozenset[str], when: datetime) -> None:
        for term in tokens:
            self.counts[term] = self.counts.get(term, 0) + 1
        self.first_seen = min(self.first_seen, when)
        self.last_seen = max(self.last_seen, when)
        self.members.append(article_id)


def _make_key(article_id, title: str | None, when: datetime) -> str:
    """Stable identifier for an event, seeded by its earliest article."""
    seed = f"{article_id}|{(title or '')[:80]}|{when.date().isoformat()}"
    return "ev_" + hashlib.sha1(seed.encode("utf-8")).hexdigest()[:14]


def group_articles(rows: list[tuple], known: dict | None = None) -> dict:
    """
    Assign an event key to each article.

    ``rows`` are (id, title, description, country_id, topic, published_at),
    processed oldest first so an event is seeded by whoever reported it first.
    Returns {article_id: event_key}; unmatchable articles get their own key.

    ``known`` carries event keys already assigned to stored articles. Reusing
    them is what makes incremental grouping stable: without it, each ingest
    cycle would invent fresh keys for the same events and the archive would
    reshuffle underneath any link pointing at one.

    Comparison is blocked by (country, week) — without that this is O(n²)
    across the whole archive, which is not something to run at startup.
    """
    known = known or {}
    assignment: dict = {}
    blocks: dict[tuple, list[Event]] = {}

    token_cache = {r[0]: event_tokens(r[1], r[2]) for r in rows}

    for article_id, title, description, country_id, topic, published_at in sorted(
        rows, key=lambda r: (r[5] or datetime.min)
    ):
        when = published_at or datetime.utcnow()
        tokens = token_cache[article_id]

        if len(tokens) < MIN_TOKENS:
            assignment[article_id] = _make_key(article_id, title, when)
            continue

        # A week-numbered block, plus its neighbour, so an event spanning a
        # boundary is not split by the calendar.
        week = when.isocalendar()[:2]
        prev = (when - timedelta(days=WINDOW_DAYS)).isocalendar()[:2]
        candidates: list[Event] = []
        for bucket in {(country_id, week), (country_id, prev), (None, week), (None, prev)}:
            candidates.extend(blocks.get(bucket, ()))

        best, best_score = None, 0.0
        for event in candidates:
            score = event.accepts(tokens, country_id, topic, when)
            if score > best_score:
                best, best_score = event, score

        if best is not None:
            best.absorb(article_id, tokens, when)
            assignment[article_id] = best.key
            continue

        event = Event(
            # An article that already belongs to an event keeps that key, so
            # re-running grouping over stored rows does not rename events.
            key=known.get(article_id) or _make_key(article_id, title, when),
            seed_tokens=tokens,
            counts=dict.fromkeys(tokens, 1),
            country_id=country_id,
            topic=topic,
            first_seen=when,
            last_seen=when,
            members=[article_id],
        )
        blocks.setdefault((country_id, week), []).append(event)
        assignment[article_id] = event.key

    return assignment


# ─────────────────────────────────────────────────────────
# REPORTED FIGURES
# ─────────────────────────────────────────────────────────
# Casualty counts are the number an event is actually tracked by, and they
# move as it develops — the Colombian earthquake ran 111 -> 132 -> 180 -> 200+
# across four days. Grouping articles is what makes that progression visible.
_FIGURE = re.compile(
    r"(?:(?P<qual>at least|more than|over|nearly|around|about|some|up to)\s+)?"
    r"(?P<num>\d{1,3}(?:,\d{3})+|\d+)\s*"
    r"(?P<unit>killed|dead|deaths?|died|casualt\w*|injured|wounded|missing|"
    r"displaced|evacuated|rescued|trapped)",
    re.I,
)

# Which units describe the same thing, so a toll is not mixed with injuries.
FIGURE_KINDS = {
    "killed": "deaths", "dead": "deaths", "death": "deaths", "deaths": "deaths",
    "died": "deaths", "casualty": "deaths", "casualties": "deaths",
    "injured": "injured", "wounded": "injured",
    "missing": "missing", "trapped": "missing",
    "displaced": "displaced", "evacuated": "displaced", "rescued": "rescued",
}


def extract_figures(text: str | None) -> dict[str, int]:
    """
    Reported counts by kind, e.g. {"deaths": 132}.

    The largest value of each kind wins: a headline saying "at least 111
    killed, 200 missing" reports one death figure, and where a sentence
    repeats a number the higher one is the current claim.
    """
    if not text:
        return {}
    found: dict[str, int] = {}
    for match in _FIGURE.finditer(text):
        raw = match.group("num").replace(",", "")
        try:
            value = int(raw)
        except ValueError:
            continue
        if value > 10_000_000:          # a year or an id, not a body count
            continue
        kind = FIGURE_KINDS.get(match.group("unit").lower().rstrip("s"))
        if not kind:
            kind = FIGURE_KINDS.get(match.group("unit").lower())
        if not kind:
            continue
        found[kind] = max(found.get(kind, 0), value)
    return found
