# wipe_all_tables.py
import sqlite3

DB_PATH = "data/app.db"  # <- change if yours is different

TABLES = [
    "course_file_text",
    "canvas_announcements",
    "assignments_normalized",
    "reading_items",
]

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

for t in TABLES:
    cur.execute(f"DELETE FROM {t};")

conn.commit()
print("✅ Wiped:", ", ".join(TABLES))
conn.close()
