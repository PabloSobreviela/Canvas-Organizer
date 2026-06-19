from db import get_db

conn = get_db()
cur = conn.cursor()
cur.execute("DELETE FROM course_file_text WHERE course_id = '467980'")
conn.commit()
conn.close()

print("Purged old file text")
