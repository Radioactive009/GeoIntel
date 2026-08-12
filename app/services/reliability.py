"""
Source reliability weights.

A country's alert level is an average over whatever outlets happened to cover
it. Unweighted, a single alarmist headline from a low-quality aggregator moves
a national threat level exactly as much as a wire report — which is how a
quiet country ends up looking dangerous because one blog was dramatic.

Weights are deliberately coarse. This is not a ranking of journalistic quality
and should not be read as one; it is a statement about how much a single
report from an outlet should move an *aggregate* risk score:

  1.3  wire services and international broadcasters — high-volume, heavily
       edited, and the origin of most stories the others syndicate
  1.0  established national outlets (the default for anything recognised)
  0.7  aggregators, unattributed feeds and "Unknown Source"

Names are matched case-insensitively on a normalised substring, because the
same outlet arrives spelled several ways ("BBC News", "BBC World", "bbc.com").
"""

from __future__ import annotations

import re

DEFAULT_RELIABILITY = 1.0

WIRE_AND_INTERNATIONAL = (
    "reuters", "associated press", "ap news", "agence france", "afp",
    "bbc", "al jazeera", "guardian", "france 24", "deutsche welle", "dw ",
    "npr", "pbs", "financial times", "economist", "bloomberg", "wall street journal",
    "new york times", "washington post", "cnn", "abc news", "cbs news", "nbc news",
    "sky news", "channel news asia", "cna", "nhk", "euronews", "politico",
    "the hindu", "times of india", "ndtv", "cbc", "global news", "tass",
    "jerusalem post", "haaretz", "kyodo", "yonhap", "xinhua", "anadolu",
)

LOW_CONFIDENCE = (
    "unknown source", "unknown", "blogspot", "wordpress", "medium.com",
    "substack", "reddit", "youtube", "facebook", "twitter", "x.com",
    "aggregator", "newsbreak", "msn.com", "yahoo",
)

WIRE_WEIGHT = 1.3
LOW_WEIGHT = 0.7


def _normalise(name: str | None) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def reliability_for(name: str | None) -> float:
    """Weight for an outlet name. Unrecognised outlets get the neutral 1.0."""
    normalised = _normalise(name)
    if not normalised:
        return LOW_WEIGHT

    for token in LOW_CONFIDENCE:
        if token in normalised:
            return LOW_WEIGHT
    for token in WIRE_AND_INTERNATIONAL:
        if token in normalised:
            return WIRE_WEIGHT
    return DEFAULT_RELIABILITY
