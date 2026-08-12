"""
Story identity — recognising the same event reported by different outlets.

Duplicate detection upstream is URL-based, which only catches the *same* link.
A wire story reaches the pipeline once per outlet, each with its own URL, so
the feed repeats itself: measured on a 3,099-article corpus, 270 articles were
near-identical to another across 120 clusters, one Ukraine story appearing five
times.

The key is a normalised token set rather than a hash of the string, because
outlets rewrite headlines lightly:

    "Russian aerial attacks kill 9 in Ukraine as Zelenskyy warns Moscow"
    "Russian Aerial Attacks Kill 9 In Ukraine, Zelenskyy Warns Moscow"
    "Ukraine: Russian aerial attacks kill 9; Zelenskyy warns Moscow"

all reduce to the same set of significant words. Word *order* is discarded on
purpose — reordering is the most common rewrite.
"""

from __future__ import annotations

import hashlib
import re

# Function words carry no topical signal and differ between rewrites.
STOPWORDS = frozenset("""
about after against all also amid among and are but can could did does for
from had has have how into its more most new news not now off out over said
say says than that the their them then there these they this those was were
what when where which while who why will with would you your live latest
update updates report reports breaking exclusive video watch photos
""".split())

# Below this many significant words a headline is too generic to cluster on
# ("Links 8/9/2026", "Morning briefing") — treating those as one story would
# collapse unrelated articles together.
MIN_SIGNIFICANT_WORDS = 4


def significant_words(title: str | None) -> list[str]:
    """Lowercase alphanumeric tokens with stopwords and short words removed."""
    if not title:
        return []
    tokens = re.findall(r"[a-z0-9]+", title.lower())
    return [t for t in tokens if len(t) > 2 and t not in STOPWORDS]


def story_key(title: str | None) -> str | None:
    """
    Stable identifier for the underlying event, or None if untrustworthy.

    None means "do not cluster this" — the caller should treat the article as
    its own story rather than grouping it with other unkeyed ones.
    """
    words = set(significant_words(title))
    if len(words) < MIN_SIGNIFICANT_WORDS:
        return None
    joined = " ".join(sorted(words))
    return hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


def similarity(a: str | None, b: str | None) -> float:
    """Jaccard overlap of two headlines. Exposed for tuning and diagnostics."""
    set_a, set_b = set(significant_words(a)), set(significant_words(b))
    if not set_a or not set_b:
        return 0.0
    return len(set_a & set_b) / len(set_a | set_b)
