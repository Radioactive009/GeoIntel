"""
Country display names.

pycountry returns the ISO 3166 register entry, which is a legal designation
rather than something to print. Unfixed, the flashpoints board read
"Iran, Islamic Republic of · United States" and "Taiwan, Province of China".
"""

import collections

import pycountry
import pytest

from app.countries import COUNTRIES, COUNTRY_MAP, display_name


@pytest.mark.parametrize("code,expected", [
    ("RU", "Russia"),                 # register says "Russian Federation"
    ("IR", "Iran"),                   # "Iran, Islamic Republic of"
    ("PS", "Palestine"),              # "Palestine, State of"
    ("TW", "Taiwan"),                 # "Taiwan, Province of China"
    ("KP", "North Korea"),
    ("KR", "South Korea"),
    ("SY", "Syria"),                  # "Syrian Arab Republic"
    ("TR", "Turkey"),
    ("CD", "DR Congo"),               # "Congo, The Democratic Republic of the"
    ("VN", "Vietnam"),                # "Viet Nam"
    ("LA", "Laos"),
    ("BO", "Bolivia"),
    ("VE", "Venezuela"),
    ("MD", "Moldova"),
    ("TZ", "Tanzania"),
    ("VA", "Vatican City"),
])
def test_names_are_what_a_newsroom_would_print(code, expected):
    assert COUNTRY_MAP[code]["name"] == expected


def test_taiwan_does_not_assert_a_political_claim():
    """The register's "Province of China" is not ours to publish."""
    assert "Province of China" not in COUNTRY_MAP["TW"]["name"]


def test_no_name_still_carries_a_register_qualifier():
    offenders = [c["name"] for c in COUNTRIES if ", " in c["name"] and c["name"].endswith(" of")]
    assert offenders == []


def test_names_stay_unique():
    """Country.name is UNIQUE; a collision would break the catalog sync."""
    duplicates = {n: k for n, k in collections.Counter(c["name"] for c in COUNTRIES).items() if k > 1}
    assert duplicates == {}


def test_every_country_keeps_a_name():
    assert len(COUNTRIES) > 240
    assert all(c["name"] and c["code"] for c in COUNTRIES)


def test_multi_part_names_are_not_truncated():
    """The qualifier trim must not eat a genuine compound name."""
    assert COUNTRY_MAP["BQ"]["name"] != "Bonaire"
    assert COUNTRY_MAP["VC"]["name"] == "Saint Vincent and the Grenadines"


def test_falls_back_to_the_register_when_nothing_better_exists():
    france = pycountry.countries.get(alpha_2="FR")
    assert display_name(france) == "France"
