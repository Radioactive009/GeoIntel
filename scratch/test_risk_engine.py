import sys
import os

# Add the project root to sys.path
sys.path.append(os.getcwd())

import logging
logging.basicConfig(level=logging.INFO)

try:
    from app.services.risk_engine import score_article
except ImportError as e:
    print(f"Import error: {e}")
    sys.exit(1)

test_cases = [
    "Iran attacked Israel but damage was not severe",
    "Massive war escalation and invasion in Europe",
    "Peaceful protest in the city center",
    "Sanctions lifted after diplomatic agreement",
    "Attack on the border with multiple casualties",
    "Minor incident reported, no injuries",
    "A contained situation following low impact skirmish"
]

print("--- TESTING RISK ENGINE ---")
for text in test_cases:
    score, level = score_article(text)
    print(f"Text: {text}")
    print(f"Result: {score}/100 - {level}")
    print("-" * 30)
