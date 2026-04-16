"""
Geopolitical Risk Engine v3 — Lightweight (V1 Recovery)
=======================================================
Optimized for low-resource environments (Render/Railway).
Replaces heavy AI models with a high-speed, rule-based approach.

Pipeline:
  1. Event Detection   — Keyword-based (Tier 1-4).
  2. Sentiment Layer   — VADER (Rule-based, tiny RAM footprint).
  3. Classification    — Event types & Strategic Activity.
  4. Mitigation Layer  — Dynamic weighted reduction.
  5. Final Score       — Weighted formula: (Event*0.7 + Vader_Neg*0.3 - Mitigation*0.4).
"""

import logging
import re
from typing import Tuple
from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# INITIALIZE VADER (Ultra-lightweight)
# ─────────────────────────────────────────────
_analyzer = SentimentIntensityAnalyzer()

def _get_vader_score(text: str) -> float:
    """Returns the 'negative' component of the VADER sentiment score."""
    scores = _analyzer.polarity_scores(text)
    # vader 'neg' score is 0 to 1. We scale it for our formula.
    return scores['neg']


# ─────────────────────────────────────────────
# EVENT WEIGHTS (Rebalanced & Optimized)
# ─────────────────────────────────────────────
EVENT_WEIGHTS: dict[str, float] = {
    # Tier 1 — High (0.65 - 0.75)
    "war":          0.75,
    "invasion":     0.75,
    "nuke":         0.75,
    "nuclear":      0.70,
    "genocide":     0.75,
    "massacre":     0.70,
    # Tier 2 — Significant (0.55 - 0.65)
    "attack":       0.65,
    "bombing":      0.65,
    "airstrike":    0.65,
    "missile":      0.60,
    "explosion":    0.60,
    "coup":         0.60,
    "terror":       0.60,
    "killed":       0.60,
    # Tier 3 — Moderate (0.45 - 0.55)
    "conflict":     0.55,
    "violence":     0.55,
    "troops":       0.50,
    "military":     0.45,
    "sanctions":    0.45,
    "blockade":     0.50,
    "occupation":   0.55,
    "hazard":       0.50,
    "toxic":        0.55,
    "chemical":     0.50,
    "outbreak":     0.55,
    # Tier 4 — Minor/Normal (0.30 - 0.45)
    "protest":      0.40,
    "riot":         0.45,
    "unrest":       0.40,
    "crisis":       0.35,
    "threat":       0.35,
    "arrested":     0.30,
    "diplomacy":    0.30,
}

# ─────────────────────────────────────────────
# EVENT TYPE CLASSIFICATION
# ─────────────────────────────────────────────
EVENT_TYPES = {
    "military": ["attack", "missile", "troops", "airstrike", "invasion", "war", "military", "bombing", "explosion", "navy", "army", "airforce"],
    "diplomatic": ["talks", "meeting", "agreement", "summit", "diplomacy", "treaty", "negotiation", "peace", "ceasefire"],
    "economic": ["sanctions", "trade", "oil", "economy", "tariffs", "market", "currency", "finance"],
    "political": ["election", "protest", "government", "parliament", "regime", "coup", "policy"],
    "hazard": ["toxic", "chemical", "hazard", "outbreak", "epidemic", "biological", "contamination", "poison"]
}

# ─────────────────────────────────────────────
# DYNAMIC MITIGATION SYSTEM
# ─────────────────────────────────────────────
MITIGATION_CONFIG = {
    "strong": {
        "weight": 0.50,
        "phrases": ["no casualties", "ceasefire", "peace agreement", "normalized relations", "no fatalities", "minimal damage"]
    },
    "medium": {
        "weight": 0.30,
        "phrases": ["under control", "limited impact", "contained incident", "de-escalation"]
    },
    "weak": {
        "weight": 0.15,
        "phrases": ["talks ongoing", "monitoring situation", "tensions easing", "diplomatic solution"]
    }
}

# ─────────────────────────────────────────────
# STRATEGIC ACTIVITY DETECTION
# ─────────────────────────────────────────────
CONFLICT_KEYWORDS = ["attack", "killed", "kills", "war", "dead", "death", "destroyed", "violence", "blood", "clash", "fighting", "bombing", "airstrike", "invasion", "casualty", "massacre", "genocide"]

def _classify_event_type(text: str) -> str:
    text_lower = text.lower()
    type_counts = {etype: 0 for etype in EVENT_TYPES}
    for etype, keywords in EVENT_TYPES.items():
        for kw in keywords:
             if re.search(rf"\b{re.escape(kw)}\b", text_lower):
                type_counts[etype] += 1
    max_type = max(type_counts, key=type_counts.get)
    return max_type if type_counts[max_type] > 0 else "political"

def _detect_category(text: str, event_type: str) -> str:
    text_lower = text.lower()
    if event_type == "military" or event_type == "economic":
        if not any(kw in text_lower for kw in CONFLICT_KEYWORDS):
            return "strategic_activity"
    return "conflict" if any(kw in text_lower for kw in CONFLICT_KEYWORDS) else "news"

def _detect_events(text: str) -> Tuple[float, list[str]]:
    text_lower = text.lower()
    detected = []
    scores = []
    for keyword, weight in EVENT_WEIGHTS.items():
        if re.search(rf"\b{re.escape(keyword)}\b", text_lower):
            detected.append(keyword)
            scores.append(weight)
    if not scores:
        return 0.0, []
    raw = max(scores)
    if len(scores) > 1:
        raw = min(0.8, raw + 0.02 * (len(scores) - 1))
    return raw, detected

def _detect_mitigation(text: str) -> float:
    text_lower = text.lower()
    max_reduction = 0.0
    for category, config in MITIGATION_CONFIG.items():
        for phrase in config["phrases"]:
            if phrase in text_lower:
                max_reduction = max(max_reduction, config["weight"])
    return max_reduction


# ─────────────────────────────────────────────
# PUBLIC SCORING FUNCTION
# ─────────────────────────────────────────────
def score_article(text: str) -> Tuple[float, str, str, str]:
    """
    Lightweight scoring and classification using VADER and Keywords.
    Returns (risk_score, risk_level, event_type, category)
    """
    if not text or not text.strip():
        return 0.0, "low", "political", "news"

    # 1. Detection
    event_score, events = _detect_events(text)
    event_type = _classify_event_type(text)
    category = _detect_category(text, event_type)
    
    # 2. VADER Sentiment (Fast & Light)
    vader_neg = _get_vader_score(text)
    
    # 3. Mitigation
    mitigation_weight = _detect_mitigation(text)
    
    # 4. Final Calculation
    # Formula: (Event*0.7 + Vader_Neg*0.3 - Mitigation*0.4)
    # We increased event weight (0.7) to compensate for loss of semantic intelligence
    raw_calc = (event_score * 0.7) + (vader_neg * 0.3) - (mitigation_weight * 0.4)
    
    # Normalize to 0-1 range (Base adjustment for neutral news)
    normalized = max(0.0, min(1.0, raw_calc + 0.25))
    final_score = round(normalized * 100, 2)

    # 5. Thresholds
    if final_score >= 70:
        risk_level = "high"
    elif final_score >= 40:
        risk_level = "medium"
    else:
        risk_level = "low"

    # Strategic Activity Safeguard
    if category == "strategic_activity" and final_score > 60:
        final_score = 55.0
        risk_level = "medium"

    logger.info(
        "⚡ Lightweight Analysis: Score=%s, Level=%s, Type=%s, Cat=%s | Events=%s",
        final_score, risk_level, event_type, category, events
    )

    return final_score, risk_level, event_type, category
