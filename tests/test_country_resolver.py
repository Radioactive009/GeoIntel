"""Country attribution: person-name and homonym disambiguation."""

import pytest

from app.services.country_resolver import resolve_countries, resolve_primary_country


@pytest.mark.parametrize("title,description,forbidden", [
    # Capitalisation alone cannot separate these — a headline capitalises both.
    ("Jordan Peterson speaks in Toronto", None, "JO"),
    ("Chad Johnson signs with new team", None, "TD"),
    ("Michael Jordan buys stake in NASCAR team", None, "JO"),
    ("Israel Adesanya wins title fight in Las Vegas", None, "IL"),
    # Homonyms no adjacency rule can catch.
    ("Turkey prices soar ahead of Thanksgiving", "US shoppers face costs", "TR"),
    ("Georgia governor signs new election law", "The US state passed it", "GE"),
])
def test_person_names_and_homonyms_are_rejected(title, description, forbidden):
    assert resolve_primary_country(title, description) != forbidden


@pytest.mark.parametrize("title,allowed", [
    ("Jordan and Israel hold talks in Amman", ("JO", "IL")),
    # Title-case headlines must survive: every word is capitalised there, so a
    # naive "followed by a capital" rule would veto the country.
    ("Jordan Says It Will Reopen Border With Syria", ("JO",)),
    ("Trump Visits Jordan For Border Talks", ("JO", "US")),
    ("Georgia protests EU accession law in Tbilisi", ("GE",)),
    ("Turkey's Erdogan meets Putin in Ankara", ("TR",)),
    ("Chad's junta extends political transition", ("TD",)),
    ("India and China hold border talks", ("IN", "CN")),
    ("Kenya Airways suspends flights to Somalia", ("KE", "SO")),
])
def test_real_country_mentions_still_resolve(title, allowed):
    assert resolve_primary_country(title, None) in allowed


def test_secondary_country_is_available():
    """The bilateral view depends on the runner-up, not just the winner."""
    codes = resolve_countries("India and China hold border talks", None)
    assert len(codes) >= 2
    assert set(codes[:2]) == {"IN", "CN"}


def test_no_country_returns_empty():
    assert resolve_primary_country("Local council approves budget", None) is None
    assert resolve_countries(None, None) == []
