"""
Country resolution from article text.
=====================================

The previous pipeline attributed an article to whichever country's ingest
batch happened to fetch it. That produced nonsense such as Bouvet Island
being credited with US security-blog posts, and made the alert map reflect
the ingest cursor rather than world events.

This module resolves the country an article is actually *about*, by matching
a gazetteer of country names, aliases, demonyms and capitals against the
article title and description.

Matching rules:
  * Longest term wins ("South Sudan" beats "Sudan", "New Jersey" beats "Jersey").
  * Title matches count double — headlines name the subject country.
  * Terms that are also common English words (``us``, ``turkey``, ``chad``)
    only count when they appear capitalised.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable

import pycountry

logger = logging.getLogger(__name__)

TITLE_WEIGHT = 2
BODY_WEIGHT = 1

# Terms that are also ordinary English words or common proper nouns. They are
# only accepted when the matched text is capitalised, so "us" (pronoun) is
# ignored while "US" and "United States" are not.
CASE_SENSITIVE_TERMS = {
    "us", "usa", "uk", "turkey", "chad", "jersey", "guernsey", "georgia",
    "guinea", "oman", "mali", "niger", "jordan", "china", "cuba", "chile",
    "grenada", "dominica", "malta", "monaco", "panama", "somalia", "togo",
    "eu", "uae", "drc",
}

# Country names that are too ambiguous to match on their own — they must be
# reached through an explicit alias instead ("North Korea", "South Korea").
BLOCKED_BARE_NAMES = {"korea", "virgin islands", "congo", "samoa", "ireland"}

# ── Person-name disambiguation ───────────────────────────────────────────
#
# Capitalisation alone cannot separate a country from a person: a headline
# capitalises both. "Jordan Peterson speaks in Toronto" resolved to Jordan,
# "Chad Johnson signs with new team" to Chad. These terms therefore also
# require that they are not acting as a given name — judged by whether the
# very next token is a capitalised word that looks like a surname.
PERSON_NAME_AMBIGUOUS = {
    "jordan", "chad", "georgia", "israel", "kenya", "paris", "france",
    "guinea", "mali", "monaco", "panama", "cuba", "chile", "india",
    "china", "asia", "africa", "dominica", "grenada", "malta", "somalia",
    "togo", "niger", "oman", "brazil", "holland", "sierra leone",
}

# Capitalised words that routinely follow a country in a headline. A term
# followed by one of these is the country, not half a person's name — without
# this, title-case headlines ("Jordan Says It Will Reopen Border") would be
# vetoed wholesale.
FOLLOWER_STOPWORDS = {
    # headline verbs
    "says", "said", "will", "warns", "warned", "urges", "urged", "calls",
    "called", "seeks", "sought", "backs", "backed", "hits", "bans", "banned",
    "signs", "signed", "sends", "sent", "denies", "denied", "rejects",
    "rejected", "accuses", "accused", "slams", "slammed", "vows", "vowed",
    "eyes", "faces", "faced", "halts", "halted", "opens", "opened", "holds",
    "held", "marks", "announces", "announced", "launches", "launched",
    "confirms", "confirmed", "reports", "reported", "plans", "planned",
    "sets", "set", "cuts", "raises", "raised", "adds", "agrees", "agreed",
    "moves", "moved", "pushes", "pushed", "wins", "won", "loses", "lost",
    "begins", "began", "ends", "ended", "returns", "returned", "joins",
    "joined", "leaves", "left", "takes", "took", "gets", "makes", "made",
    "keeps", "kept", "blocks", "blocked", "strikes", "struck", "fires",
    "fired", "orders", "ordered", "extends", "boosts", "cancels", "resumes",
    # function words
    "and", "or", "to", "in", "on", "at", "for", "with", "by", "as", "is",
    "are", "was", "were", "has", "have", "had", "not", "no", "after",
    "before", "amid", "over", "under", "from", "into", "the", "a", "an",
    "its", "it", "he", "she", "they", "we", "you", "this", "that",
    # roles and institutions
    "pm", "president", "prime", "minister", "ministry", "government", "govt",
    "army", "navy", "military", "forces", "troops", "official", "officials",
    "leader", "leaders", "parliament", "cabinet", "court", "police",
    "central", "bank", "foreign", "defence", "defense", "state", "envoy",
    "ambassador", "delegation", "team", "coach", "captain",
    # time words
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "sunday", "today", "tomorrow", "yesterday", "january", "february",
    "march", "april", "may", "june", "july", "august", "september",
    "october", "november", "december",
}

# The mirror case: the term used as a *surname* ("Michael Jordan"). Only an
# explicit given-name list is safe here — a generic "preceded by a capitalised
# word" rule would veto every title-case headline ("Trump Visits Jordan").
GIVEN_NAME_PREFIXES = {
    "air", "michael", "eddie", "kevin", "katie", "brian", "vernon", "montell",
    "james", "john", "david", "robert", "william", "richard", "joseph",
    "thomas", "george", "daniel", "paul", "mark", "steven", "andrew", "joshua",
    "kenneth", "kyle", "ryan", "jason", "justin", "brandon", "tyler", "sarah",
    "jessica", "ashley", "emily", "megan", "rachel", "lauren",
}

# Whole-text vetoes for homonyms that no adjacency rule can catch: the US
# state of Georgia, and the bird. Matching any of these drops that country
# from consideration for the article entirely.
CONTEXT_VETO: dict[str, re.Pattern] = {
    "GE": re.compile(
        r"\b(?:u\.?s\.?|american)\s+state\b|\batlanta\b|\bpeach\s+state\b|"
        r"\bgovernor\b|\bgeorgia\s+(?:tech|bulldogs|southern|state)\b|"
        r"\bsavannah\b|\bfulton\s+county\b",
        re.IGNORECASE,
    ),
    "TR": re.compile(
        r"\bthanksgiving\b|\brecipes?\b|\bpoultry\b|\broast(?:ed|ing)?\s+turkey\b|"
        r"\bstuffing\b|\bcranberr\w*\b|\bgravy\b|\bbutterball\b",
        re.IGNORECASE,
    ),
}

# Extra terms mapped onto ISO alpha-2 codes: aliases, demonyms, capitals and
# well-known regions. These carry most of the recall for geopolitical news.
EXTRA_TERMS: dict[str, tuple[str, ...]] = {
    "US": (
        "United States", "U.S.", "U.S.A.", "USA", "US", "America", "American",
        "Americans", "Washington", "White House", "Pentagon", "New York",
        "New Jersey", "New Mexico", "New Hampshire", "Capitol Hill",
        "Trump", "Biden",
    ),
    "GB": (
        "United Kingdom", "Britain", "British", "England", "English", "Scotland",
        "Scottish", "Wales", "Welsh", "Northern Ireland", "London", "Downing Street",
        "UK", "Britons",
    ),
    "RU": ("Russia", "Russian", "Russians", "Moscow", "Kremlin", "Putin"),
    "UA": ("Ukraine", "Ukrainian", "Ukrainians", "Kyiv", "Kiev", "Zelensky", "Zelenskyy"),
    "CN": ("China", "Chinese", "Beijing", "Peking", "Xi Jinping"),
    "TW": ("Taiwan", "Taiwanese", "Taipei"),
    "IN": ("India", "Indian", "Indians", "New Delhi", "Delhi", "Modi"),
    "PK": ("Pakistan", "Pakistani", "Pakistanis", "Islamabad"),
    "IL": ("Israel", "Israeli", "Israelis", "Jerusalem", "Tel Aviv", "Netanyahu", "IDF"),
    "PS": ("Palestine", "Palestinian", "Palestinians", "Gaza", "West Bank", "Hamas", "Ramallah"),
    "IR": ("Iran", "Iranian", "Iranians", "Tehran", "Teheran"),
    "IQ": ("Iraq", "Iraqi", "Iraqis", "Baghdad"),
    "SY": ("Syria", "Syrian", "Syrians", "Damascus"),
    "LB": ("Lebanon", "Lebanese", "Beirut", "Hezbollah"),
    "YE": ("Yemen", "Yemeni", "Yemenis", "Houthi", "Houthis", "Sanaa"),
    "SA": ("Saudi Arabia", "Saudi", "Saudis", "Riyadh"),
    "AE": ("United Arab Emirates", "UAE", "Emirati", "Emiratis", "Dubai", "Abu Dhabi"),
    "QA": ("Qatar", "Qatari", "Doha"),
    "KW": ("Kuwait", "Kuwaiti"),
    "OM": ("Oman", "Omani", "Muscat"),
    "BH": ("Bahrain", "Bahraini", "Manama"),
    "JO": ("Jordan", "Jordanian", "Amman"),
    "EG": ("Egypt", "Egyptian", "Egyptians", "Cairo"),
    "TR": ("Turkey", "Türkiye", "Turkiye", "Turkish", "Ankara", "Istanbul", "Erdogan"),
    "AF": ("Afghanistan", "Afghan", "Afghans", "Kabul", "Taliban"),
    "KP": ("North Korea", "North Korean", "Pyongyang"),
    "KR": ("South Korea", "South Korean", "Seoul"),
    "JP": ("Japan", "Japanese", "Tokyo"),
    "DE": ("Germany", "German", "Germans", "Berlin"),
    "FR": ("France", "French", "Paris", "Macron"),
    "IT": ("Italy", "Italian", "Italians", "Rome"),
    "ES": ("Spain", "Spanish", "Madrid"),
    "PT": ("Portugal", "Portuguese", "Lisbon"),
    "NL": ("Netherlands", "Dutch", "Amsterdam", "The Hague"),
    "BE": ("Belgium", "Belgian", "Brussels"),
    "PL": ("Poland", "Polish", "Warsaw"),
    "SE": ("Sweden", "Swedish", "Stockholm"),
    "NO": ("Norway", "Norwegian", "Oslo"),
    "FI": ("Finland", "Finnish", "Helsinki"),
    "DK": ("Denmark", "Danish", "Copenhagen"),
    "GR": ("Greece", "Greek", "Athens"),
    "CH": ("Switzerland", "Swiss", "Geneva", "Zurich", "Bern"),
    "AT": ("Austria", "Austrian", "Vienna"),
    "HU": ("Hungary", "Hungarian", "Budapest"),
    "CZ": ("Czech Republic", "Czechia", "Czech", "Prague"),
    "SK": ("Slovakia", "Slovak", "Bratislava"),
    "RO": ("Romania", "Romanian", "Bucharest"),
    "BG": ("Bulgaria", "Bulgarian", "Sofia"),
    "RS": ("Serbia", "Serbian", "Belgrade"),
    "HR": ("Croatia", "Croatian", "Zagreb"),
    "BA": ("Bosnia", "Bosnian", "Sarajevo", "Herzegovina"),
    "AL": ("Albania", "Albanian", "Tirana"),
    "BY": ("Belarus", "Belarusian", "Minsk", "Lukashenko"),
    "MD": ("Moldova", "Moldovan", "Chisinau"),
    "GE": ("Georgia", "Georgian", "Tbilisi"),
    "AM": ("Armenia", "Armenian", "Yerevan"),
    "AZ": ("Azerbaijan", "Azerbaijani", "Baku"),
    "KZ": ("Kazakhstan", "Kazakh", "Astana"),
    "UZ": ("Uzbekistan", "Uzbek", "Tashkent"),
    "CA": ("Canada", "Canadian", "Canadians", "Ottawa", "Toronto"),
    "MX": ("Mexico", "Mexican", "Mexicans", "Mexico City"),
    "BR": ("Brazil", "Brazilian", "Brasilia", "Sao Paulo"),
    "AR": ("Argentina", "Argentine", "Argentinian", "Buenos Aires"),
    "CL": ("Chile", "Chilean", "Santiago"),
    "CO": ("Colombia", "Colombian", "Bogota"),
    "VE": ("Venezuela", "Venezuelan", "Caracas", "Maduro"),
    "PE": ("Peru", "Peruvian", "Lima"),
    "CU": ("Cuba", "Cuban", "Havana"),
    "HT": ("Haiti", "Haitian", "Port-au-Prince"),
    "AU": ("Australia", "Australian", "Australians", "Canberra", "Sydney"),
    "NZ": ("New Zealand", "Wellington"),
    "ZA": ("South Africa", "South African", "Pretoria", "Johannesburg"),
    "NG": ("Nigeria", "Nigerian", "Abuja", "Lagos"),
    "ET": ("Ethiopia", "Ethiopian", "Addis Ababa"),
    "KE": ("Kenya", "Kenyan", "Nairobi"),
    "SD": ("Sudan", "Sudanese", "Khartoum"),
    "SS": ("South Sudan", "South Sudanese", "Juba"),
    "SO": ("Somalia", "Somali", "Mogadishu", "Al-Shabaab"),
    "LY": ("Libya", "Libyan", "Tripoli"),
    "DZ": ("Algeria", "Algerian", "Algiers"),
    "MA": ("Morocco", "Moroccan", "Rabat"),
    "TN": ("Tunisia", "Tunisian", "Tunis"),
    "ML": ("Mali", "Malian", "Bamako"),
    "NE": ("Niger", "Nigerien", "Niamey"),
    "CD": ("Democratic Republic of Congo", "DR Congo", "DRC", "Kinshasa"),
    "CG": ("Republic of the Congo", "Brazzaville"),
    "ZW": ("Zimbabwe", "Zimbabwean", "Harare"),
    "UG": ("Uganda", "Ugandan", "Kampala"),
    "MM": ("Myanmar", "Burma", "Burmese", "Naypyidaw", "Yangon"),
    "TH": ("Thailand", "Thai", "Bangkok"),
    "VN": ("Vietnam", "Viet Nam", "Vietnamese", "Hanoi"),
    "PH": ("Philippines", "Filipino", "Manila"),
    "ID": ("Indonesia", "Indonesian", "Jakarta"),
    "MY": ("Malaysia", "Malaysian", "Kuala Lumpur"),
    "SG": ("Singapore", "Singaporean"),
    "BD": ("Bangladesh", "Bangladeshi", "Dhaka"),
    "LK": ("Sri Lanka", "Sri Lankan", "Colombo"),
    "NP": ("Nepal", "Nepali", "Kathmandu"),
    "IE": ("Ireland", "Irish", "Dublin"),
}


def _iter_catalog_terms() -> Iterable[tuple[str, str]]:
    """Yield (term, alpha_2) pairs derived from the ISO catalog."""
    for country in pycountry.countries:
        code = getattr(country, "alpha_2", None)
        if not code:
            continue
        for attr in ("name", "official_name", "common_name"):
            raw = getattr(country, attr, None)
            if not raw:
                continue
            # "Iran, Islamic Republic of" -> also yield "Iran"
            for variant in {raw, raw.split(",")[0].strip()}:
                variant = re.sub(r"\s*\([^)]*\)", "", variant).strip()
                if len(variant) < 4:
                    continue
                if variant.lower() in BLOCKED_BARE_NAMES:
                    continue
                yield variant, code


def _build_gazetteer() -> tuple[re.Pattern, dict[str, str]]:
    """Compile one alternation regex, longest term first so it wins."""
    term_to_code: dict[str, str] = {}

    for term, code in _iter_catalog_terms():
        term_to_code.setdefault(term.lower(), code)

    # Curated terms override catalog-derived ones (e.g. "Georgia" -> GE).
    for code, terms in EXTRA_TERMS.items():
        for term in terms:
            term_to_code[term.lower()] = code

    # Longest first so "South Sudan" wins over "Sudan" and "Guinea-Bissau"
    # over "Guinea" — Python alternation takes the first branch that matches.
    ordered = sorted(term_to_code, key=len, reverse=True)
    pattern = re.compile(
        r"(?<!\w)(" + "|".join(re.escape(t) for t in ordered) + r")(?!\w)",
        re.IGNORECASE,
    )
    return pattern, term_to_code


_PATTERN, _TERM_TO_CODE = _build_gazetteer()


# No leading "^": Pattern.match(text, pos) already anchors at pos, whereas "^"
# would additionally demand the real start of the string and so never fire.
# No leading "^": Pattern.match(text, pos) already anchors at pos, whereas "^"
# would additionally demand the real start of the string and so never fire.
_FOLLOWING_WORD = re.compile(r" ([A-Z][a-zA-Z'\-]+)")
_PRECEDING_WORD = re.compile(r"([A-Za-z'\-]+) $")


def _looks_like_person_name(text: str, match: re.Match) -> bool:
    """
    Is this match part of a person's name rather than a country?

    Given name: the term is followed by exactly one space and a capitalised
    word that is neither a routine headline word nor a place in the gazetteer
    — "Jordan Peterson", "Chad Johnson", but not "Jordan Says", "Jordan and
    Israel", or "Turkey's Erdogan" (the apostrophe stops the match).

    Surname: the term is directly preceded by a known given name — "Michael
    Jordan", "Air Jordan".
    """
    preceding = _PRECEDING_WORD.search(text, 0, match.start())
    if preceding and preceding.group(1).lower() in GIVEN_NAME_PREFIXES:
        return True

    follower = _FOLLOWING_WORD.match(text, match.end())
    if not follower:
        return False
    word = follower.group(1).lower()
    if word in FOLLOWER_STOPWORDS:
        return False
    return word not in _TERM_TO_CODE


def _vetoed_codes(text: str) -> set[str]:
    """Codes disqualified by a homonym cue somewhere in the article."""
    return {code for code, pattern in CONTEXT_VETO.items() if pattern.search(text)}


def _accumulate(
    text: str,
    weight: int,
    scores: dict[str, int],
    first_seen: dict[str, int],
    vetoed: set[str],
) -> None:
    if not text:
        return
    for match in _PATTERN.finditer(text):
        matched = match.group(1)
        key = matched.lower()
        if key in CASE_SENSITIVE_TERMS and not matched[0].isupper():
            continue  # "us" the pronoun, "turkey" the bird
        code = _TERM_TO_CODE.get(key)
        if not code or code in vetoed:
            continue
        if key in PERSON_NAME_AMBIGUOUS and _looks_like_person_name(text, match):
            continue  # "Jordan Peterson", not Jordan
        scores[code] = scores.get(code, 0) + weight
        first_seen.setdefault(code, match.start())


def resolve_countries(title: str | None, description: str | None) -> list[str]:
    """
    Return ISO alpha-2 codes mentioned in the article, best match first.

    Ranking is by weighted mention count (title mentions count double), with
    earliest mention breaking ties.
    """
    scores: dict[str, int] = {}
    first_seen: dict[str, int] = {}

    # Homonym vetoes are judged over the whole article: a US-state cue in the
    # body should disqualify "Georgia" in the headline too.
    vetoed = _vetoed_codes(f"{title or ''} {description or ''}")

    _accumulate(title or "", TITLE_WEIGHT, scores, first_seen, vetoed)
    _accumulate(description or "", BODY_WEIGHT, scores, first_seen, vetoed)

    if not scores:
        return []

    return sorted(scores, key=lambda code: (-scores[code], first_seen.get(code, 1 << 30)))


def resolve_primary_country(title: str | None, description: str | None) -> str | None:
    """Return the single ISO alpha-2 code the article is most about, or None."""
    codes = resolve_countries(title, description)
    return codes[0] if codes else None


def gazetteer_size() -> int:
    """Number of distinct terms the resolver can match (used in diagnostics)."""
    return len(_TERM_TO_CODE)
