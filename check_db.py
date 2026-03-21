import sqlite3
import os

db_path = r"c:\Users\kisla\Desktop\News\news.db"
if not os.path.exists(db_path):
    print("DB not found")
else:
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    print("--- Countries ---")
    cursor.execute("SELECT name, iso_code FROM countries")
    for row in cursor.fetchall():
        print(f"Country: {row[0]}, ISO: {row[1]}")
    
    print("\n--- Recent Articles ---")
    cursor.execute("""
        SELECT a.title, c.name, c.iso_code 
        FROM articles a 
        JOIN sources s ON a.source_id = s.id 
        JOIN countries c ON s.country_id = c.id 
        LIMIT 5
    """)
    for row in cursor.fetchall():
        print(f"Article: {row[0][:30]}..., Country: {row[1]}, ISO: {row[2]}")
    
    conn.close()
