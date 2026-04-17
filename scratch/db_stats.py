import sqlite3
import os

db_path = r"c:\Users\kisla\Desktop\News\geopolitics.db"
if not os.path.exists(db_path):
    print("DB not found")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("--- Article Count per Country ---")
    cursor.execute("""
        SELECT c.name, COUNT(a.id) as count
        FROM countries c
        LEFT JOIN sources s ON s.country_id = c.id
        LEFT JOIN articles a ON a.source_id = s.id
        GROUP BY c.name
        HAVING count > 0
        ORDER BY count DESC
    """)
    for row in cursor.fetchall():
        print(f"{row[0]}: {row[1]}")
    
    conn.close()
