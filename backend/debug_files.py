import sqlite3

DB_PATH = "data/app.db"   # ✅ this matches your project config
COURSE_ID = "489948"      # ✅ PUT the course that is FAILING here

conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("""
SELECT
  file_name,
  file_type,
  LENGTH(extracted_text) AS text_length
FROM course_file_text
WHERE course_id = ?
""", (COURSE_ID,))

rows = cur.fetchall()

print("\nFILE TEXT STATUS:\n")
for r in rows:
    print(dict(r))

if not rows:
    print("❌ NO FILE TEXT FOUND FOR THIS COURSE")

conn.close()
