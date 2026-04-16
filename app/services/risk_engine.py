"""
Geopolitical Risk Engine
========================
Hybrid NLP-based scoring system that replaces raw sentiment analysis.

Pipeline:
  1. Event Detection   — identifies high-risk verbs/nouns and their weights
  2. Mitigation Check  — reduces score when context softens severity
  3. Semantic Scoring  — sentence-transformer similarity vs reference phrases
  4. Final Score       — combines all three into a 0–100 risk score

Falls back to rule-only scoring if spaCy or transformers are unavailable.
"""

import logging
import re
from typing import Tuple

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# LOAD SPACY  (lazy — avoids blocking startup)
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
# LOAD SENTENCE TRANSFORMER  (lazy)
# ─────────────────────────────────────────────
_embedder = None
_severe_embeddings = None
_low_embeddings = None

SEVERE_EVENTS = [
    "major war", "devastating attack", "high casualties", "nuclear strike",
    "massive military offensive", "genocide", "full-scale invasion",
    "terror bombing", "mass killing", "coup d'état",
]
LOW_EVENTS = [
    "minor incident", "low impact", "contained situation", "diplomatic talks",
    "ceasefire agreed", "no casualties reported", "limited skirmish",
    "peaceful protest", "sanctions lifted", "tensions easing",
]


def _get_embedder():
    global _embedder, _severe_embeddings, _low_embeddings
    if _embedder is not None:
        return _embedder
    try:
        from sentence_transformers import SentenceTransformer
        import torch
        _embedder = SentenceTransformer("all-MiniLM-L6-v2")
        _severe_embeddings = _embedder.encode(SEVERE_EVENTS, convert_to_tensor=True)
        _low_embeddings    = _embedder.encode(LOW_EVENTS,   convert_to_tensor=True)
        logger.info("✅ Sentence-transformer loaded: all-MiniLM-L6-v2")
    except Exception as e:
        logger.warning("⚠️  Sentence-transformer unavailable (%s). Skipping semantic layer.", e)
        _embedder = False
    return _embedder


# ─────────────────────────────────────────────
# EVENT WEIGHTS
# ─────────────────────────────────────────────
EVENT_WEIGHTS: dict[str, float] = {
    # Tier 1 — extreme
    "war":          1.00,
    "invasion":     0.95,
    "nuke":         0.95,
    "nuclear":      0.90,
    "genocide":     0.95,
    "massacre":     0.90,
    "assassination": 0.85,
    # Tier 2 — high
    "attack":       0.85,
    "bombing":      0.85,
    "airstrike":    0.85,
    "missile":      0.80,
    "explosion":    0.80,
    "coup":         0.80,
    "terror":       0.80,
    "killed":       0.80,
    "dead":         0.75,
    # Tier 3 — medium-high
    "conflict":     0.70,
    "violence":     0.70,
    "troops":       0.65,
    "military":     0.60,
    "sanctions":    0.60,
    "blockade":     0.65,
    "occupation":   0.70,
    "hostage":      0.75,
    # Tier 4 — medium
    "protest":      0.45,
    "riot":         0.55,
    "unrest":       0.50,
    "crisis":       0.55,
    "emergency":    0.50,
    "threat":       0.50,
    "arrested":     0.40,
}

# ─────────────────────────────────────────────
# INTENSITY MODIFIERS
# ─────────────────────────────────────────────
INTENSITY_MODIFIERS: dict[str, float] = {
    "massive":      1.25,
    "severe":       1.20,
    "heavy":        1.15,
    "major":        1.15,
    "escalating":   1.10,
    "minor":        0.75,
    "limited":      0.80,
    "slight":       0.85,
    "controlled":   0.80,
    "partial":      0.90,
}

# ─────────────────────────────────────────────
# MITIGATION PHRASES
# ─────────────────────────────────────────────
MITIGATION_TERMS: list[str] = [
    "not severe", "minor damage", "under control", "limited impact",
    "not too bad", "contained", "no casualties", "ceasefire",
    "de-escalation", "peace talks", "diplomatic solution", "agreement reached",
    "sanctions lifted", "troops withdrawn", "tensions easing", "calm restored",
    "no fatalities", "minimal damage", "isolated incident",
]

# How much a mitigation phrase reduces the raw event score
MITIGATION_REDUCTION = 0.35


# ─────────────────────────────────────────────
# STEP 1 — EVENT DETECTION
# ─────────────────────────────────────────────
def _detect_events(text: str) -> Tuple[float, list[str]]:
    """
    Scan text for event keywords.
    Returns (max_event_score, list_of_detected_events).
    """
    text_lower = text.lower()
    detected: list[str] = []
    scores: list[float] = []

    for keyword, weight in EVENT_WEIGHTS.items():
        # word-boundary match to avoid partial hits (e.g. "attacked" still matches "attack")
        pattern = rf"\b{re.escape(keyword)}"
        if re.search(pattern, text_lower):
            detected.append(keyword)
            scores.append(weight)

    if not scores:
        return 0.0, []

    # Use max event weight + small bonus for co-occurring events
    raw = max(scores)
    if len(scores) > 1:
        raw = min(1.0, raw + 0.05 * (len(scores) - 1))

    logger.debug("🔍 Events detected: %s → raw_score=%.3f", detected, raw)
    return raw, detected


# ─────────────────────────────────────────────
# STEP 2 — MITIGATION DETECTION
# ─────────────────────────────────────────────
def _detect_mitigation(text: str) -> Tuple[float, bool]:
    """
    Scan text for phrases that soften the severity.
    Returns (mitigation_reduction, was_mitigated).
    """
    text_lower = text.lower()
    for phrase in MITIGATION_TERMS:
        if phrase in text_lower:
            logger.debug("🛡  Mitigation phrase found: '%s'", phrase)
            return MITIGATION_REDUCTION, True
    return 0.0, False


# ─────────────────────────────────────────────
# STEP 3 — SEMANTIC SCORING
# ─────────────────────────────────────────────
def _semantic_score(text: str) -> float:
    """
    Compare sentence to SEVERE vs LOW reference embeddings.
    Returns an adjustment in the range [-0.25, +0.25].
    Returns 0.0 if transformer unavailable.
    """
    embedder = _get_embedder()
    if not embedder:
        return 0.0

    try:
        import torch
        from sentence_transformers import util

        query_emb = embedder.encode(text[:512], convert_to_tensor=True)

        severe_sim = float(util.cos_sim(query_emb, _severe_embeddings).max())
        low_sim    = float(util.cos_sim(query_emb, _low_embeddings).max())

        # Net adjustment: more like severe → positive, more like low → negative
        adjustment = (severe_sim - low_sim) * 0.25
        logger.debug(
            "🧠 Semantic: severe_sim=%.3f low_sim=%.3f adjustment=%.3f",
            severe_sim, low_sim, adjustment,
        )
        return max(-0.25, min(0.25, adjustment))
    except Exception as e:
        logger.warning("Semantic scoring failed: %s", e)
        return 0.0


# ─────────────────────────────────────────────
# STEP 4 — SPACY CONTEXT REFINEMENT (optional)
# ─────────────────────────────────────────────
def _nlp_refinement(text: str) -> Tuple[float, dict]:
    """
    Perform deep NLP analysis using spaCy to:
      1. Extract Subject-Action-Object (SAO) relationships.
      2. Detect intensity modifiers (adjectives/adverbs).
      3. Detect negations.

    Returns (adjustment_score, metadata_dict).
    """
    nlp = _get_nlp()
    if not nlp:
        return 0.0, {}

    adjustment = 0.0
    sao_data = {"actors": [], "actions": [], "targets": []}
    modifiers_found = []

    try:
        doc = nlp(text[:512]) # Analyzing first 512 chars for context

        for token in doc:
            # 1. Action (Verb) & Actor/Target detection
            if token.pos_ == "VERB" or token.dep_ == "ROOT":
                sao_data["actions"].append(token.lemma_.lower())
                
                # Check for negations modifying this action
                if any(child.dep_ == "neg" for child in token.children):
                    logger.debug("🚫 Negation detected on: '%s'", token.text)
                    adjustment -= 0.25

                # Check for intensity modifiers modifying this action
                for child in token.children:
                    if child.dep_ in ("advmod", "amod") and child.lemma_.lower() in INTENSITY_MODIFIERS:
                        mod = child.lemma_.lower()
                        weight = INTENSITY_MODIFIERS[mod]
                        modifiers_found.append(mod)
                        # Adjustment is relative to 1.0 (e.g. 1.25 -> +0.10)
                        adjustment += (weight - 1.0) / 2 

            # 2. Subject (Actor)
            if token.dep_ in ("nsubj", "nsubjpass"):
                sao_data["actors"].append(token.text)
            
            # 3. Object (Target)
            if token.dep_ in ("dobj", "pobj", "attr"):
                sao_data["targets"].append(token.text)
                
                # Check for intensity modifiers modifying the object (e.g. "severe damage")
                for child in token.children:
                    if child.lemma_.lower() in INTENSITY_MODIFIERS:
                        mod = child.lemma_.lower()
                        modifiers_found.append(mod)
                        adjustment += (INTENSITY_MODIFIERS[mod] - 1.0) / 2

        metadata = {
            "sao": sao_data,
            "modifiers": list(set(modifiers_found))
        }
        
        if modifiers_found:
             logger.debug("⚡ Intensity modifiers: %s", modifiers_found)
        
        return adjustment, metadata

    except Exception as e:
        logger.warning("NLP refinement failed: %s", e)
        return 0.0, {}


# ─────────────────────────────────────────────
# MAIN PUBLIC FUNCTION
# ─────────────────────────────────────────────
def score_article(text: str) -> Tuple[float, str]:
    """
    Score a news article for geopolitical risk.

    Args:
        text: Combined title + description of the article.

    Returns:
        (risk_score_0_to_100, risk_label)
        risk_label: "low" | "medium" | "high"
    """
    if not text or not text.strip():
        return 0.0, "low"

    # ── Step 1: Event detection ──────────────
    event_score, events = _detect_events(text)

    if event_score == 0.0:
        # No recognisable event → near-zero risk
        logger.debug("ℹ️  No events found. Risk = low.")
        return round(min(15.0, 0.0)), "low"

    logger.info("🔥 Event detected: %s", events)

    # ── Step 2: Mitigation ───────────────────
    mitigation, was_mitigated = _detect_mitigation(text)
    if was_mitigated:
        logger.info("🛡  Mitigation applied (−%.0f%%)", mitigation * 100)

    # ── Step 3: Semantic adjustment ──────────
    semantic_adj = _semantic_score(text)

    # ── Step 4: NLP Deep Refinement (SAO + Modifiers) 
    nlp_adj, nlp_meta = _nlp_refinement(text)

    # ── Combine ──────────────────────────────
    raw = event_score - mitigation + semantic_adj + nlp_adj
    raw = max(0.0, min(1.0, raw))

    # Scale to 0–100
    final_score = round(raw * 100, 2)

    # ── Classify ─────────────────────────────
    if final_score >= 65:
        risk_level = "high"
    elif final_score >= 35:
        risk_level = "medium"
    else:
        risk_level = "low"

    logger.info(
        "✅ Final risk score: %.1f (%s) | events=%s mitigated=%s",
        final_score, risk_level, events, was_mitigated,
    )

    return final_score, risk_level
