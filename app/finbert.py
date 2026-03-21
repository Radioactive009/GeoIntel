from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch
import torch.nn.functional as F

# ── Load FinBERT (once, globally) ────────────────────────
MODEL_NAME = "ProsusAI/finbert"

print("🔄 Loading FinBERT model...")
tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
print("✅ FinBERT model loaded successfully")

labels = ["negative", "neutral", "positive"]

# ── Geopolitical keyword lists ───────────────────────────
HIGH_RISK_KEYWORDS = [
    "war", "attack", "military", "conflict", "violence",
    "missile", "nuclear", "killed", "dead", "explosion",
    "terror", "strike", "bomb", "crisis", "invasion",
    "sanctions", "genocide", "coup", "assassination", "bombing"
]

IGNORE_KEYWORDS = [
    "celebrity", "movie", "entertainment",
    "bollywood", "hollywood", "oscars", "grammy"
]


def analyze_sentiment(text: str):
    if not text or not text.strip():
        return 0.0, "neutral"

    text_lower = text.lower()

    # ── Filter only true noise (NOT geopolitical) ────────
    has_risk_keyword = any(word in text_lower for word in HIGH_RISK_KEYWORDS)

    if not has_risk_keyword and any(word in text_lower for word in IGNORE_KEYWORDS):
        print(f"  🚫 Filtered irrelevant: {text[:60]}...")
        return 0.0, "neutral"

    # ── FinBERT inference ────────────────────────────────
    inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True)

    with torch.no_grad():
        outputs = model(**inputs)

    probs = F.softmax(outputs.logits, dim=1)
    confidence, predicted_class = torch.max(probs, dim=1)

    sentiment_label = labels[predicted_class.item()]
    raw_confidence = confidence.item()

    # ── Normalize FinBERT score to -1 to +1 ──────────────
    if sentiment_label == "negative":
        finbert_score = -raw_confidence
    elif sentiment_label == "positive":
        finbert_score = raw_confidence
    else:
        finbert_score = 0.0

    # ── OVERRIDE: Force negative if high-risk keywords ───
    if has_risk_keyword:
        # War/conflict = ALWAYS negative, never neutral
        final_score = -0.7
        label = "negative"
        print(f"  🔥 High-risk keyword detected → forcing NEGATIVE "
              f"(FinBERT was: {finbert_score:.3f} / {sentiment_label})")

        # If FinBERT already said negative with high confidence, use that
        if finbert_score < -0.5:
            final_score = finbert_score

        print(f"  ✅ Final Sentiment: {label} | Score: {final_score:.3f}")
        return round(final_score, 4), label

    # ── Normal path (no geopolitical keywords) ───────────
    final_score = finbert_score

    if final_score > 0.2:
        label = "positive"
    elif final_score < -0.2:
        label = "negative"
    else:
        label = "neutral"

    print(f"  ✅ Final Sentiment: {label} | Score: {final_score:.3f}")
    return round(final_score, 4), label


# ── One-time self-tests ──────────────────────────────────
print("====================================")
print("🧪 FinBERT + GeoRisk SELF-TEST")
print("TEST POSITIVE:", analyze_sentiment("The economy is booming and markets are strong"))
print("TEST WAR     :", analyze_sentiment("War and crisis are spreading across the region"))
print("TEST ATTACK  :", analyze_sentiment("Nuclear missile attack threatens military conflict"))
print("TEST KILLED  :", analyze_sentiment("Soldiers killed in violent explosion during invasion"))
print("TEST FILTERED:", analyze_sentiment("Celebrity wins Oscar at entertainment movie awards"))
print("====================================")