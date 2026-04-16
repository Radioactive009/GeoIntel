"""
Geopolitical Risk Engine v2
===========================
Balanced geopolitical intelligence classification system.
Rebalanced to reduce negative bias and categorize event types.

Pipeline:
  1. Event Detection   — identifies event types (military, diplomatic, etc.) and lowered weights.
  2. Mitigation Layer  — dynamic weighted reduction (Strong, Medium, Weak).
  3. Semantic Scoring  — increased influence via sentence-transformers.
  4. Classification    — identifies "strategic_activity" vs "conflict".
  5. Final Score       — weighted formula: (Event*0.5 + Semantic*0.3 - Mitigation*0.4).
"""

import logging
import re
from typing import Tuple

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# LOAD SPACY (lazy loading)
# ─────────────────────────────────────────────
_nlp = None

def _get_nlp():
    global _nlp
    if _nlp is not None:
        return _nlp
    try:
        import spacy
        _nlp = spacy.load("en_core_web_sm")
        logger.info("✅ spaCy model loaded: en_core_web_sm")
    except Exception as e:
        logger.warning("⚠️  spaCy unavailable (%s). Using rule-based fallback.", e)
        _nlp = False
    return _nlp


# ─────────────────────────────────────────────
# LOAD SENTENCE TRANSFORMER (lazy loading)
# ─────────────────────────────────────────────
_embedder = None
_severe_embeddings = None
_low_embeddings = None

SEVERE_EVENTS = [
    "major war", "devastating attack", "high casualties", "nuclear strike",
    "massive military offensive", "genocide", "full-scale invasion",
    "terror bombing", "mass killing", "coup d'état", "imminent threat of war",
]
LOW_EVENTS = [
    "minor incident", "strategic movement", "diplomatic talks", "trade agreement",
    "ceasefire agreed", "monitoring situation", "limited impact",
    "peaceful protest", "sanctions discussion", "policy change",
]


def _get_embedder():
    global _embedder, _severe_embeddings, _low_embeddings
    if _embedder is not None:
        return _embedder
    try:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        _severe_embeddings = _embedder.encode(SEVERE_EVENTS, convert_to_tensor=True)
        _low_embeddings    = _embedder.encode(LOW_EVENTS,   convert_to_tensor=True)
        logger.info("✅ Sentence-transformer loaded: all-MiniLM-L6-v2")
    except Exception as e:
        logger.warning("⚠️  Sentence-transformer unavailable (%s). Skipping semantic layer.", e)
        _embedder = False
    return _embedder


# ─────────────────────────────────────────────
# REBALANCED EVENT WEIGHTS
# ─────────────────────────────────────────────
# Tiers rebalanced for less dominance (0.3 - 0.75 range)
EVENT_WEIGHTS: dict[str, float] = {
    # Tier 1 — High Importance (0.65 - 0.75)
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
    # Tier 4 — Minor/Normal (0.30 - 0.45)
    "protest":      0.40,
    "riot":         0.45,
    "unrest":       0.40,
    "crisis":       0.35,
    "threat":       0.35,
    "arrested":     0.30,
    "diplomacy":    0.30,
    "trade":        0.30,
    # Hazard / CBRN (0.45 - 0.55)
    "toxic":        0.55,
    "chemical":     0.50,
    "hazard":       0.50,
    "outbreak":     0.55,
    "epidemic":     0.55,
    "biological":   0.55,
}

# ─────────────────────────────────────────────
# EVENT TYPE CLASSIFICATION
# ─────────────────────────────────────────────
EVENT_TYPES = {
    "military": ["attack", "missile", "troops", "airstrike", "invasion", "war", "military", "bombing", "explosion", "airstrike", "navy", "army", "airforce"],
    "diplomatic": ["talks", "meeting", "agreement", "summit", "diplomacy", "treaty", "negotiation", "peace", "ceasefire"],
    "economic": ["sanctions", "trade", "oil", "economy", "tariffs", "market", "currency", "finance"],
    "political": ["election", "protest", "government", "parliament", "regime", "coup", "policy"],
    "hazard": ["toxic", "chemical", "hazard", "outbreak", "epidemic", "biological", "contamination", "poison", "health concerns"]
}

# ─────────────────────────────────────────────
# DYNAMIC MITIGATION SYSTEM
# ─────────────────────────────────────────────
MITIGATION_CONFIG = {
    "strong": {
        "weight": 0.50,
        "phrases": ["no casualties", "ceasefire", "peace agreement", "normalized relations", "no fatalities"]
    },
    "medium": {
        "weight": 0.30,
        "phrases": ["under control", "limited impact", "contained incident", "minimal damage", "de-escalation"]
    },
    "weak": {
        "weight": 0.15,
        "phrases": ["talks ongoing", "monitoring situation", "tensions easing", "diplomatic solution", "agreement reached"]
    }
}

# ─────────────────────────────────────────────
# STRATEGIC ACTIVITY KEYWORDS
# ─────────────────────────────────────────────
CONFLICT_KEYWORDS = [
    "attack", "killed", "kills", "war", "dead", "death", "destroyed", "violence", 
    "blood", "clash", "fighting", "bombing", "airstrike", "invasion", "casualty", 
    "massacre", "genocide", "strike", "explosions", "contamination", "poison", "toxic"
]
HARM_KEYWORDS = ["crisis", "collapse", "depression", "ruined", "bankrupt", "defaults", "recession"]


def _classify_event_type(text: str) -> str:
    text_lower = text.lower()
    type_counts = {etype: 0 for etype in EVENT_TYPES}
    
    for etype, keywords in EVENT_TYPES.items():
        for kw in keywords:
            if rf"\b{kw}\b" in text_lower or kw in text_lower:
                type_counts[etype] += 1
                
    # Get the type with the highest keyword count
    max_type = max(type_counts, key=type_counts.get)
    if type_counts[max_type] == 0:
        return "political" # Default
    return max_type


def _detect_category(text: str, event_type: str) -> str:
    text_lower = text.lower()
    
    if event_type == "military":
        # If military but no conflict markers
        if not any(kw in text_lower for kw in CONFLICT_KEYWORDS):
            return "strategic_activity"
    
    if event_type == "economic":
        # If economic but no harm markers
        if not any(kw in text_lower for kw in HARM_KEYWORDS):
            return "strategic_activity"
            
    return "conflict" if any(kw in text_lower for kw in CONFLICT_KEYWORDS) else "news"


def _detect_events(text: str) -> Tuple[float, list[str]]:
    text_lower = text.lower()
    detected: list[str] = []
    scores: list[float] = []

    for keyword, weight in EVENT_WEIGHTS.items():
        pattern = rf"\b{re.escape(keyword)}"
        if re.search(pattern, text_lower):
            detected.append(keyword)
            scores.append(weight)

    if not scores:
        return 0.0, []

    raw = max(scores)
    if len(scores) > 1:
        # Reduced bonus for multi-events
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


def _semantic_score(text: str) -> float:
    embedder = _get_embedder()
    if not embedder:
        return 0.0

    try:
        from sentence_transformers import util
        query_emb = embedder.encode(text[:512], convert_to_tensor=True)

        severe_sim = float(util.cos_sim(query_emb, _severe_embeddings).max())
        low_sim    = float(util.cos_sim(query_emb, _low_embeddings).max())

        # Returns adjustment in range [-0.5, +0.5] (increased range)
        return max(-0.5, min(0.5, (severe_sim - low_sim)))
    except Exception:
        return 0.0


def score_article(text: str) -> Tuple[float, str, str, str]:
    """
    Enhanced scoring and classification.
    Returns (risk_score, risk_level, event_type, category)
    """
    if not text or not text.strip():
        return 0.0, "low", "political", "news"

    # 1. Detect Core Data
    event_score, events = _detect_events(text)
    event_type = _classify_event_type(text)
    category = _detect_category(text, event_type)
    
    # 2. Mitigation
    mitigation_weight = _detect_mitigation(text)
    
    # 3. Semantic
    semantic_adj = _semantic_score(text)

    # 4. Formula: (Event*0.5 + Semantic*0.3 - Mitigation*0.4)
    # Combined score calculation
    raw_calc = (event_score * 0.5) + (semantic_adj * 0.3) - (mitigation_weight * 0.4)
    
    # Normalize to 0-1 range
    # Base adjustment to put neutral around 0.3 and severe high around 0.8
    normalized = max(0.0, min(1.0, raw_calc + 0.3))

    final_score = round(normalized * 100, 2)

    # 5. Thresholds (Rebalanced)
    # High Risk >= 70
    # Medium Risk 40–69
    # Low Risk < 40
    if final_score >= 70:
        risk_level = "high"
    elif final_score >= 40:
        risk_level = "medium"
    else:
        risk_level = "low"

    # Handle Strategic Activity logic: cap risk if classified as strategic
    if category == "strategic_activity" and final_score > 60:
        final_score = 55.0
        risk_level = "medium"

    logger.info(
        "🧠 Risk Analysis: Score=%s, Level=%s, Type=%s, Cat=%s | Events=%s",
        final_score, risk_level, event_type, category, events
    )

    return final_score, risk_level, event_type, category
