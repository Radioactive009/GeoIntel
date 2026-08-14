"""
Topic classification for geopolitical news.

Replaces a keyword counter that scored 47% against a hand-labelled sample of
the live corpus. Measured on that corpus, its decisions were barely decisions
at all: 53.7% of articles matched no keyword whatsoever and 38.5% were settled
by a single hit, so the section a story landed in was mostly an artefact of
which one word happened to appear.

Three things were wrong, and each is addressed here.

1. No inflection. The lexicon held "attack", and `\\battack\\b` does not match
   "Ramps Up Civilian Attacks". Terms now expand to their common forms.

2. Missing vocabulary and missing categories. Earthquakes, wildfires, famine,
   epidemics, refugees, terrorism and cyber intrusions are a large share of
   the feed and had nowhere to go — "7.4 Magnitude Earthquake Jolts Colombia"
   matched nothing at all. DISASTER, HUMANITARIAN and SECURITY exist now.

3. Mention treated as topic. Every hit counted equally, so "Kenya seeks World
   Bank funds to offset Iran war shock" was filed under military because it
   contains "war". Terms are weighted by how much they identify a story
   rather than merely appear in one: naming an *event* ("earthquake",
   "airstrike", "coup") is strong evidence; naming an *institution*
   ("military", "government") is weak, because any story can mention one.

A relevance gate sits in front of all of it. The per-country search feeds
return a great deal that is not geopolitical news — sport, entertainment,
celebrity and local trivia — and calling that "politics" is worse than
declining to classify it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# ─────────────────────────────────────────────────────────
# TAXONOMY
# ─────────────────────────────────────────────────────────
CONFLICT = "conflict"
SECURITY = "security"
DIPLOMACY = "diplomacy"
ECONOMY = "economy"
POLITICS = "politics"
DISASTER = "disaster"
HUMANITARIAN = "humanitarian"
NOISE = "other"

CATEGORIES = (
    CONFLICT, SECURITY, DIPLOMACY, ECONOMY, POLITICS, DISASTER, HUMANITARIAN,
)

# Applied only to break an exact tie, so the outcome never depends on dict
# ordering. Specific beats general: a story that is both a disaster and a
# political response is a disaster.
TIE_ORDER = (
    DISASTER, HUMANITARIAN, CONFLICT, SECURITY, ECONOMY, DIPLOMACY, POLITICS,
)

# Weights. The scale is what stops a passing mention from deciding a story.
STRONG = 3.0    # names the event itself; little else produces this word
MEDIUM = 2.0    # strongly associated, occasionally incidental
WEAK = 1.0      # an institution or abstraction any story might mention


def _pattern(term: str) -> str:
    """
    Expand a term to its common inflections.

    A term containing regex syntax is taken verbatim, which is the escape
    hatch for cases where blanket suffixing would overreach.
    """
    if any(ch in term for ch in r"\()[]|?*+"):
        return term
    if " " in term:                      # phrases stay literal but allow a plural
        return rf"(?<!\w){re.escape(term)}s?(?!\w)"
    return rf"(?<!\w){re.escape(term)}(?:s|es|ed|ing)?(?!\w)"


LEXICON: dict[str, list[tuple[str, float]]] = {
    DISASTER: [
        *[(t, STRONG) for t in (
            "earthquake", "quake", "aftershock", "tsunami", "volcano", "volcanic eruption",
            "wildfire", "bushfire", "hurricane", "typhoon", "cyclone", "tornado",
            "landslide", "mudslide", "avalanche", "drought", "heatwave", "flash flood",
            "magnitude", "epicentre", "epicenter", "richter",
        )],
        *[(t, MEDIUM) for t in (
            "flood", "flooding", "storm surge", "torrential rain", "dam collapse",
            "natural disaster", "evacuation order", "state of emergency",
            "seismic", "erupt", "submerged", "record temperature",
        )],
        *[(t, WEAK) for t in ("rescuer", "rescue effort", "survivor", "debris", "climate")],
    ],
    HUMANITARIAN: [
        *[(t, STRONG) for t in (
            "famine", "starvation", "malnutrition", "food insecurity", "food crisis",
            "food security", "refugee", "asylum seeker", "displaced person",
            "humanitarian crisis", "humanitarian aid", "humanitarian corridor",
            "ebola", "cholera", "epidemic", "pandemic", "measles outbreak",
            "internally displaced", "aid convoy", "relief effort",
        )],
        *[(t, MEDIUM) for t in (
            "outbreak", "displacement", "malnourished", "aid agency", "world food programme",
            "unhcr", "unicef", "red cross", "shelter", "hunger", "vaccination campaign",
        )],
        *[(t, WEAK) for t in ("aid", "relief", "who", "humanitarian")],
    ],
    CONFLICT: [
        *[(t, STRONG) for t in (
            "airstrike", "air strike", "shelling", "bombardment", "missile strike",
            "invasion", "offensive", "ceasefire violation", "front line", "frontline",
            "artillery", "warplane", "fighter jet", "warship", "drone strike",
            "armed clash", "gun battle", "firefight", "war crime", "genocide",
            "massacre", "combatant", "battlefield", "incursion", "siege",
        )],
        *[(t, MEDIUM) for t in (
            "missile", "drone", "rocket", "troop", "soldier", "militia",
            "airspace violation", "armoured vehicle", "tank", "casualt(y|ies)",
            "killed in", "strike", "attack", "war", "combat", "deploy",
        )],
        *[(t, WEAK) for t in ("military", "army", "navy", "defence", "defense", "weapon", "arms")],
    ],
    SECURITY: [
        # Named armed groups and terrorism vocabulary outrank the generic
        # conflict signal: "50 JNIM Terrorists Killed at a Military Base" is a
        # counter-terrorism story that happens to involve an army.
        *[(t, STRONG + 1.5) for t in (
            "terrorist", "terrorism", "jihadist", "al-qaeda", "islamic state",
            "boko haram", "al-shabaab", "insurgent", "insurgency",
        )],
        *[(t, STRONG) for t in (
            "hacked", "hacking", "cyberscam", "cybercrime", "data breach",
            "trafficker", "smuggler", "money laundering", "organised crime",
            "al-qaeda", "islamic state", "isis", "boko haram", "al-shabaab",
            "suicide bomb", "car bomb", "improvised explosive", "ied",
            "kidnap", "abduction", "hostage", "human trafficking", "drug trafficking",
            "cartel", "cyberattack", "cyber attack", "ransomware", "hacker",
            "espionage", "sabotage", "assassination", "extremis(m|t)",
        )],
        *[(t, MEDIUM) for t in (
            "militant", "gunman", "hijack", "smuggling", "narcotic", "cybersecurity",
            "counter-terrorism", "security force", "raid", "arms industry", "arrest",
        )],
        *[(t, WEAK) for t in ("security", "police", "intelligence agency", "surveillance")],
    ],
    DIPLOMACY: [
        *[(t, STRONG) for t in (
            "peace talk", "peace deal", "ceasefire agreement", "peace agreement",
            "diplomatic", "diplomat", "ambassador", "envoy", "summit", "treaty",
            "bilateral talk", "negotiation", "mediation", "communiqué", "communique",
            "normalisation", "normalization", "accord", "memorandum of understanding",
            "state visit", "consulate", "embassy",
        )],
        *[(t, MEDIUM) for t in (
            "talks", "negotiate", "mediator", "delegation", "foreign minister",
            "ceasefire", "dialogue", "rapprochement", "joint statement", "bloc",
        )],
        *[(t, WEAK) for t in ("cooperation", "relations", "united nations", "meeting")],
    ],
    ECONOMY: [
        *[(t, STRONG) for t in (
            "tariff", "sanction", "embargo", "trade war", "trade deal", "export ban",
            "inflation", "interest rate", "central bank", "currency", "devaluation",
            "recession", "gdp", "bailout", "default on debt", "stock market",
            "commodity", "barrel", "oil price", "gas price", "pipeline deal",
            "world bank", "imf", "budget deficit",
        )],
        *[(t, MEDIUM) for t in (
            "trade", "export", "import", "investment", "economy", "economic",
            "market", "shares", "revenue", "supply chain", "energy price", "crude",
            "oil", "gas", "refinery", "output",
        )],
        *[(t, WEAK) for t in ("bank", "fund", "price", "cost", "business")],
    ],
    POLITICS: [
        *[(t, STRONG) for t in (
            "election", "referendum", "ballot", "coup", "impeachment", "no-confidence",
            "parliament", "legislature", "constitutional amendment", "cabinet reshuffle",
            "sworn in", "inaugurat(e|ed|ion)", "candidate", "opposition party",
            "prime minister", "lawmaker", "senate", "congress", "poll",
        )],
        *[(t, MEDIUM) for t in (
            "president", "minister", "government", "ruling party", "protest",
            "demonstration", "supreme court", "legislation", "bill", "vote",
            "political", "coalition", "coup attempt", "coup plot",
        )],
        *[(t, WEAK) for t in ("policy", "official", "leader", "court", "law")],
    ],
}

# ─────────────────────────────────────────────────────────
# RELEVANCE GATE
#
# The per-country feeds are Google News searches, so they return sport,
# entertainment, celebrity and consumer stories alongside the news. Those
# words are strong evidence *against* the story being geopolitical, and
# outweigh an incidental "war" or "sanctions" in a sports headline.
# ─────────────────────────────────────────────────────────
NOISE_TERMS: list[tuple[str, float]] = [
    *[(t, STRONG) for t in (
        "world cup", "olympic", "premier league", "la liga", "nba", "nfl", "cricket",
        "midfielder", "striker signs", "transfer window", "box office", "netflix",
        "celebrity", "actress", "actor's", "singer", "album", "film festival",
        "red carpet", "grammy", "oscar", "tiff", "reality show", "influencer",
        "recipe", "horoscope", "zodiac", "dating app", "gym", "wedding",
        "world athletics", "athletics", "doping", "fifa", "uefa", "ioc",
        "world cup qualifier", "championship", "medal", "athlete",
        "prenup", "widow", "obituary", "concert", "podcast",
    )],
    *[(t, MEDIUM) for t in (
        "match", "tournament", "league", "coach", "player", "fixture", "goal",
        "movie", "series premiere", "trailer", "streaming", "fashion", "recipe",
        "shopping", "discount", "gadget", "smartphone", "review",
    )],
]

# Figures of speech that borrow conflict vocabulary. "Bidding war for
# oOh!Media" and "war of words" are not armed conflict, and the metaphor is
# common enough in headlines to be worth naming explicitly rather than hoping
# the weights sort it out.
METAPHORS = re.compile(
    r"(?<!\w)(?:bidding|price|culture|trade|tug[- ]of|war)\s+of?\s*words?(?!\w)"
    r"|(?<!\w)(?:bidding|price|culture|turf|tug[- ]of)[- ]war(?!\w)"
    r"|(?<!\w)war\s+(?:on\s+(?:drugs|poverty|waste|talent)|chest|paint|room)(?!\w)"
    r"|(?<!\w)(?:prenup|custody|legal|twitter|online)\s+war(?!\w)",
    re.I,
)

_COMPILED: dict[str, list[tuple[re.Pattern, float]]] = {
    category: [(re.compile(_pattern(term), re.I), weight) for term, weight in terms]
    for category, terms in LEXICON.items()
}
_COMPILED_NOISE = [(re.compile(_pattern(term), re.I), weight) for term, weight in NOISE_TERMS]

# Headline mentions identify the subject; body mentions are often incidental.
TITLE_WEIGHT = 2.0
BODY_WEIGHT = 1.0

# Below this the winner is not meaningfully ahead and the story is better sent
# for a second opinion than filed on a coin toss.
CONFIDENT_MARGIN = 2.0
MIN_EVIDENCE = 2.0


@dataclass
class Classification:
    category: str
    confidence: float          # 0-1; how clearly the winner led
    scores: dict[str, float]
    is_relevant: bool
    reason: str                # "confident" | "weak-evidence" | "close-call" | "off-topic"

    @property
    def needs_review(self) -> bool:
        """Whether a second opinion would be worth its cost."""
        return self.reason in ("weak-evidence", "close-call")


def _score(text: str, patterns: list[tuple[re.Pattern, float]]) -> float:
    """
    Summed weight of distinct matching terms.

    Distinct, not total: a headline repeating "sanctions" four times is not
    four times more economic, and rewarding repetition let long descriptions
    dominate short headlines.
    """
    return sum(weight for pattern, weight in patterns if pattern.search(text))


def classify(title: str | None, description: str | None = None) -> Classification:
    """Classify a story, reporting how sure the result is."""
    title = (title or "").strip()
    body = (description or "").strip()
    if not title and not body:
        return Classification(NOISE, 0.0, {}, False, "off-topic")

    scores = {
        category: (
            TITLE_WEIGHT * _score(title, patterns)
            + BODY_WEIGHT * _score(body, patterns)
        )
        for category, patterns in _COMPILED.items()
    }

    noise_score = (
        TITLE_WEIGHT * _score(title, _COMPILED_NOISE)
        + BODY_WEIGHT * _score(body, _COMPILED_NOISE)
    )

    # A figure of speech is not the event it borrows from. Cancelling the
    # conflict signal is enough — whatever the story is actually about keeps
    # its own score and can still win.
    if METAPHORS.search(f"{title} {body}"):
        scores[CONFLICT] = 0.0
        noise_score += MEDIUM

    ranked = sorted(scores.items(), key=lambda kv: (-kv[1], TIE_ORDER.index(kv[0])))
    (best, best_score), (_, runner_up) = ranked[0], ranked[1]

    # Entertainment and sport language beating the topical signal means the
    # story is not about the topic its stray words suggest.
    if noise_score >= best_score and noise_score > 0:
        return Classification(NOISE, 0.0, scores, False, "off-topic")

    if best_score < MIN_EVIDENCE:
        return Classification(NOISE, 0.0, scores, best_score > 0, "weak-evidence")

    margin = best_score - runner_up
    if margin < CONFIDENT_MARGIN:
        confidence = round(0.5 * margin / CONFIDENT_MARGIN, 2)
        return Classification(best, confidence, scores, True, "close-call")

    # Saturates rather than growing without bound, so a long article cannot
    # look more certain merely by being long.
    confidence = round(min(1.0, 0.5 + margin / (2 * CONFIDENT_MARGIN + margin)), 2)
    return Classification(best, confidence, scores, True, "confident")


def classify_event_type(title: str | None, description: str | None = None) -> str:
    """Category only, for callers that do not care how sure it is."""
    return classify(title, description).category
