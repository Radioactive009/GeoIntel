import sys
import os
sys.path.append(os.getcwd())

from app.services.risk_engine import score_article

test_cases = [
    {
        "name": "Diplomatic Talks (Strategic)",
        "text": "Countries discuss new trade agreement and economic cooperation meeting"
    },
    {
        "name": "Missile Delivery (Strategic Military)",
        "text": "Nation delivers new missile system to border for defensive readiness"
    },
    {
        "name": "Severe Airstrike (Conflict)",
        "text": "Severe airstrike destroys military base and kills 50 soldiers in escalation"
    },
    {
        "name": "Sanctions lifted (Mitigation)",
        "text": "Major sanctions lifted as peace agreement is reached in ongoing talks"
    },
    {
        "name": "Protest in Capitol",
        "text": "Large protest in capitol against new government policy"
    }
]

print(f"{'Test Case':<35} | {'Score':<6} | {'Level':<8} | {'Type':<10} | {'Category':<18}")
print("-" * 95)

for tc in test_cases:
    score, level, etype, cat = score_article(tc["text"])
    print(f"{tc['name']:<35} | {score:<6.1f} | {level:<8} | {etype:<10} | {cat:<18}")
