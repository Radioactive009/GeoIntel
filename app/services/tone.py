"""
Tone — whether a story is a lift or a weight.

This exists so a reader can choose their register: something hopeful, or
something serious. It is deliberately *not* the risk score. A low-risk story
is usually just routine ("Minister opens new bypass"), which is neither.

The hard part is not finding positive words. It is refusing them when the
story is not positive, which naive sentiment gets badly wrong. Measured on
this corpus, a plain VADER-plus-keywords approach labelled these as good news:

    "Young girl finds whale stranded on Australian beach"     (a stranded whale)
    "Judge approves effort to end South Sudan TPS protections" (ending refugee
                                                                protections)
    "WHO urges Ervebo vaccine trial in DR Congo Ebola outbreak" (an epidemic)

Every one contains genuinely positive vocabulary — finds, approves, vaccine —
inside a story nobody would file under uplifting. So harm is checked first and
overrides everything: if people are dying, displaced, jailed or bombed, the
story is serious no matter how hopeful its verbs.

That asymmetry is deliberate. Mislabelling a grim story as uplifting breaks
the feature's only promise; mislabelling an uplifting story as neutral merely
under-fills a section.
"""

from __future__ import annotations

import re

from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

UPLIFTING = "uplifting"
SERIOUS = "serious"
NEUTRAL = "neutral"

_analyzer = SentimentIntensityAnalyzer()

# Harm. Any of these and the story cannot be uplifting, whatever else it says.
# Written as one alternation because it is checked on every article.
HARM = re.compile(
    r"\b(?:kill\w*|dead|death\w*|die[ds]?|dying|fatal\w*|casualt\w*|massacr\w*|"
    r"genocide|atrocit\w*|murder\w*|assassinat\w*|execut(?:ed|ion)|"
    r"wound\w*|injur\w*|maim\w*|"
    r"war|invasion|shelling|airstrike\w*|bombard\w*|bomb\w*|missile\w*|"
    r"terror\w*|insurgen\w*|militant\w*|hostage\w*|kidnap\w*|abduct\w*|"
    r"famine|starv\w*|malnutrition|epidemic|outbreak|cholera|ebola|"
    r"earthquake|tsunami|wildfire\w*|hurricane|cyclone|flood\w*|drought|"
    r"disaster|catastroph\w*|collapse\w*|"
    r"refugee\w*|displac\w*|evacuat\w*|stranded|"
    r"jail\w*|arrest\w*|detain\w*|imprison\w*|torture\w*|abuse\w*|"
    r"corrupt\w*|fraud|scandal|coup|crackdown|protest\w*|riot\w*|unrest|"
    r"sanction\w*|recession|bankrupt\w*|layoff\w*|redundanc\w*|"
    r"crisis|crises|emergency|threat\w*|warn\w*|fear\w*|risk\w*|"
    r"strike[sd]?|clash\w*|conflict\w*|dispute\w*|tension\w*|"
    # Enumerated, not suffixed: "ban\\w*" matches "bank" and "banner", and
    # "block\\w*" matches "blockchain", which quietly filed every central-bank
    # story under serious.
    r"ban|bans|banned|banning|block|blocks|blocked|blocking|blockade\w*|"
    r"reject\w*|condemn\w*|accus\w*|deny|denies|denied|"
    r"lawsuit|court|trial|verdict|sentenc\w*|convict\w*)\b",
    re.I,
)

# Relief so specific it settles the question on its own. "Found alive" is not
# ambiguous, and requiring a sentiment model to agree only loses the story:
# VADER scores "Missing hiker found alive after five days" at 0.10, below any
# useful floor, because it weighs "missing" against "alive".
DECISIVE_GOOD = re.compile(
    r"\b(?:rescued alive|pulled alive|found alive|found safe|"
    r"survivor\w* found|reunited|freed from|released from captivity|"
    r"breakthrough|cured|remission|eradicat\w*|"
    r"lives saved|rebuild\w*|rebuilt|"
    r"peace deal|peace agreement|historic agreement|"
    r"kindness|generosity)\b",
    re.I,
)

# Genuine but weaker signals, which need the sentiment reading to agree.
# Deliberately narrower than the obvious list: "protect\\w*" was tried and
# labelled "Judge approves effort to end South Sudan TPS protections" as good
# news, because policy language borrows the vocabulary of care.
SUPPORTING_GOOD = re.compile(
    r"\b(?:recovery|recovering|recovered|healed|restor\w*|reopen\w*|"
    r"milestone|aid arriv\w*|aid deliver\w*|donat\w*|funding boost|"
    r"celebrat\w*|honou?red|award\w*|prize|triumph|"
    r"conservation|reforest\w*|rewild\w*|"
    r"first ever|discover\w*|invent\w*|innovat\w*|volunteer\w*)\b",
    re.I,
)

# Outlets whose entire remit is constructive journalism. Their own editorial
# judgement is better evidence than any lexicon, so a story from one is
# uplifting unless it trips the harm check.
UPLIFTING_SOURCES = frozenset({
    "good news network", "positive news", "reasons to be cheerful",
    "optimist daily", "the optimist daily", "goodnewsnetwork",
})

# VADER floor for the lexicon path. Low, because the harm veto is doing the
# real work and VADER on a headline is noisy.
POSITIVE_COMPOUND = 0.25
NEGATIVE_COMPOUND = -0.35


def _vader(text: str) -> float:
    return _analyzer.polarity_scores(text)["compound"]


def classify_tone(
    title: str | None,
    description: str | None = None,
    source_name: str | None = None,
) -> tuple[str, float]:
    """
    Return (tone, score) where score is -1..1, negative being grimmer.

    Tone is one of uplifting / serious / neutral. Most news is neutral, and
    saying so is the honest answer — forcing every story to one pole is what
    produces "stranded whale" in a feel-good section.
    """
    text = f"{title or ''} {description or ''}".strip()
    if not text:
        return NEUTRAL, 0.0

    compound = _vader(text)
    harmed = bool(HARM.search(text))

    # A constructive-journalism outlet vouches for its own story, but does not
    # get to overrule the harm check — those outlets still cover hard subjects.
    from_uplifting_desk = (source_name or "").strip().lower() in UPLIFTING_SOURCES

    if harmed:
        # Harm present: the only question left is how heavy it is.
        score = min(compound, -0.2) if compound > -0.2 else compound
        return SERIOUS, round(max(-1.0, score), 3)

    if from_uplifting_desk:
        return UPLIFTING, round(max(0.3, compound), 3)

    if DECISIVE_GOOD.search(text):
        # Floored above zero: the phrase has already settled it, and reporting
        # a negative score for a story shown as uplifting would be incoherent.
        return UPLIFTING, round(max(0.3, compound), 3)

    if SUPPORTING_GOOD.search(text) and compound >= POSITIVE_COMPOUND:
        return UPLIFTING, round(compound, 3)

    if compound <= NEGATIVE_COMPOUND:
        return SERIOUS, round(compound, 3)

    return NEUTRAL, round(compound, 3)


def tone_of(article) -> tuple[str, float]:
    """Convenience for an ORM row or anything with the same attributes."""
    source = getattr(getattr(article, "source", None), "name", None)
    return classify_tone(
        getattr(article, "title", None),
        getattr(article, "description", None),
        source,
    )
