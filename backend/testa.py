from db import get_db

conn = get_db()
cur = conn.cursor()

cur.execute("""
SELECT file_type, COUNT(*) as c
FROM course_file_text
WHERE course_id = '467980'
GROUP BY file_type
""")

for row in cur.fetchall():
    print(row["file_type"], row["c"])

conn.close()
