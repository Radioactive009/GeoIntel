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


def _accumulate(text: str, weight: int, scores: dict[str, int], first_seen: dict[str, int]) -> None:
    if not text:
        return
    for match in _PATTERN.finditer(text):
        matched = match.group(1)
        key = matched.lower()
        if key in CASE_SENSITIVE_TERMS and not matched[0].isupper():
            continue  # "us" the pronoun, "turkey" the bird
        code = _TERM_TO_CODE.get(key)
        if not code:
            continue
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

    _accumulate(title or "", TITLE_WEIGHT, scores, first_seen)
    _accumulate(description or "", BODY_WEIGHT, scores, first_seen)

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
