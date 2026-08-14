"""
Central country catalog.

Builds the full ISO-3166 catalog once at import time and exposes lookup
helpers. Extracted from main.py so ingestion, migrations and routes can share
one definition of "what a country is".
"""

from __future__ import annotations

import logging
import re

import pycountry
import pycountry_convert as pc

logger = logging.getLogger(__name__)

CONTINENT_TO_REGION = {
    "AF": "Africa",
    "AS": "Asia",
    "EU": "Europe",
    "NA": "North America",
    "SA": "South America",
    "OC": "Oceania",
    "AN": "Antarctica",
}

MIDDLE_EAST_ISO = {
    "AE", "BH", "CY", "EG", "IQ", "IR", "IL", "JO", "KW",
    "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE",
}

# Geopolitical framing applied on top of each country's own name terms.
BASE_QUERY = "politics OR war OR conflict OR sanctions OR diplomacy OR military OR crisis"

# NewsAPI rejects queries longer than 500 characters.
MAX_QUERY_LENGTH = 480


def resolve_region(alpha2: str) -> str:
    if alpha2 in MIDDLE_EAST_ISO:
        return "Middle East"
    try:
        continent_code = pc.country_alpha2_to_continent_code(alpha2)
        return CONTINENT_TO_REGION.get(continent_code, "Global")
    except Exception:
        return "Global"


# Names a newsroom would print, where the ISO register differs.
#
# pycountry returns the ISO 3166 register entry, which is a legal designation
# rather than a display name: "Iran, Islamic Republic of", "Russian
# Federation", "Taiwan, Province of China". Printed on a flashpoints board
# that reads as a database dump, and "Taiwan, Province of China" additionally
# asserts a political claim the site has no business making.
#
# pycountry supplies `common_name` for some of these (Iran, Taiwan, Bolivia,
# the Koreas). The rest — Russia and Syria among them — have none, so they are
# listed here.
DISPLAY_NAMES = {
    "RU": "Russia",
    "SY": "Syria",
    "TR": "Turkey",
    "PS": "Palestine",
    "CD": "DR Congo",
    "CG": "Republic of the Congo",
    "VA": "Vatican City",
    "BN": "Brunei",
    "CV": "Cape Verde",
    "FK": "Falkland Islands",
    "VG": "British Virgin Islands",
    "VI": "US Virgin Islands",
    "FM": "Micronesia",
    "BQ": "Caribbean Netherlands",
    "MF": "Saint Martin",
    "SX": "Sint Maarten",
    "SH": "Saint Helena",
    "GS": "South Georgia",
    "UM": "US Minor Outlying Islands",
    "IO": "British Indian Ocean Territory",
    "CC": "Cocos Islands",
    "HM": "Heard and McDonald Islands",
    "TF": "French Southern Territories",
}

# "Bolivia, Plurinational State of" -> "Bolivia" for anything not listed above.
_QUALIFIER = re.compile(r",\s*(?:the\s+)?(?:\w+\s+){0,3}(?:of|Republic|State)(?:\s+of)?(?:\s+the)?$", re.I)


def display_name(country) -> str:
    """The name to print for a country, in preference order."""
    code = getattr(country, "alpha_2", "")
    if code in DISPLAY_NAMES:
        return DISPLAY_NAMES[code]

    # pycountry's own short form, where it has one.
    common = getattr(country, "common_name", None)
    if common:
        return common

    name = country.name
    trimmed = _QUALIFIER.sub("", name).strip()
    # Only accept the trim if it left something meaningful: "Bonaire, Sint
    # Eustatius and Saba" must not become "Bonaire".
    if trimmed and trimmed != name and len(trimmed) >= 4 and "," not in trimmed:
        return trimmed
    return name


def build_country_catalog() -> list[dict]:
    countries = []
    for c in pycountry.countries:
        code = getattr(c, "alpha_2", None)
        if not code:
            continue

        # Canonical short name keeps UI/map labels aligned with the backend.
        name = display_name(c)
        query_terms = [f'"{name}"']
        if getattr(c, "official_name", None):
            query_terms.append(f'"{c.official_name}"')
        if getattr(c, "common_name", None):
            query_terms.append(f'"{c.common_name}"')

        countries.append({
            "name": name,
            "code": code,
            # Bare ISO codes were previously part of the query and matched
            # unrelated text ("AE", "IN", "US"), so they are left out.
            "query": " OR ".join(dict.fromkeys(query_terms)),
            "region": resolve_region(code),
        })

    countries.sort(key=lambda x: x["name"])
    return countries


COUNTRIES = build_country_catalog()
COUNTRY_MAP = {c["code"]: c for c in COUNTRIES}


def build_query(country_query: str) -> str:
    """Combine country-specific terms with the geopolitical base query."""
    query = f"({country_query}) AND ({BASE_QUERY})"
    if len(query) <= MAX_QUERY_LENGTH:
        return query
    # Drop the longest name variants until the query fits the provider limit.
    terms = country_query.split(" OR ")
    while len(terms) > 1:
        terms.pop()
        query = f"({' OR '.join(terms)}) AND ({BASE_QUERY})"
        if len(query) <= MAX_QUERY_LENGTH:
            return query
    return query[:MAX_QUERY_LENGTH]


def find_country_config(iso_code: str) -> dict:
    """Find a catalog entry by ISO code, or build a fallback for unknown codes."""
    iso_code = (iso_code or "").strip().upper()
    if iso_code in COUNTRY_MAP:
        return COUNTRY_MAP[iso_code]
    return {"name": iso_code, "code": iso_code, "query": f'"{iso_code}"', "region": "Unknown"}
