"""Quick database inspection helper.

Run with: python check_db.py
"""
import os
import sqlite3

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "geopolitics.db")

if not os.path.exists(DB_PATH):
    raise SystemExit(f"DB not found at {DB_PATH} — start the API once to create it.")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

cursor.execute("SELECT COUNT(*) FROM articles")
total = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM articles WHERE country_id IS NOT NULL")
attributed = cursor.fetchone()[0]
cursor.execute("SELECT COUNT(*) FROM sources")
sources = cursor.fetchone()[0]

print(f"--- Overview ---")
print(f"Articles: {total} ({attributed} attributed to a country)")
print(f"Sources:  {sources}")

print("\n--- Articles per country (top 15) ---")
cursor.execute(
    """
    SELECT c.name, COUNT(a.id) AS n
    FROM countries c
    JOIN articles a ON a.country_id = c.id
    GROUP BY c.name
    ORDER BY n DESC
    LIMIT 15
    """
)
for name, count in cursor.fetchall():
    print(f"  {name}: {count}")

print("\n--- Articles per provider ---")
cursor.execute("SELECT COALESCE(provider, 'unknown'), COUNT(*) FROM articles GROUP BY 1 ORDER BY 2 DESC")
for provider, count in cursor.fetchall():
    print(f"  {provider}: {count}")

print("\n--- Risk levels ---")
cursor.execute("SELECT COALESCE(geo_risk_level, 'unscored'), COUNT(*) FROM articles GROUP BY 1 ORDER BY 2 DESC")
for level, count in cursor.fetchall():
    print(f"  {level}: {count}")

print("\n--- Recent articles ---")
cursor.execute(
    """
    SELECT a.title, c.name, a.geo_risk_level
    FROM articles a
    LEFT JOIN countries c ON a.country_id = c.id
    ORDER BY a.published_at DESC
    LIMIT 5
    """
)
for title, country, level in cursor.fetchall():
    print(f"  [{level or '-'}] {(country or 'Unattributed'):<22} {(title or '')[:55]}")

conn.close()
