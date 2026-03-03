from db import get_db

conn = get_db()
cur = conn.cursor()

cur.execute("PRAGMA table_info(assignments_normalized);")
print("assignments_normalized columns:")
for r in cur.fetchall():
    # r: cid, name, type, notnull, dflt_value, pk
    print(dict(r))

conn.close()
