# wipe_course_file_text.py
import sqlite3

DB_PATH = "data/app.db"  # <- change if yours is different

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

cur.execute("DELETE FROM course_file_text;")
conn.commit()

print("✅ Deleted all rows from course_file_text")
conn.close()
