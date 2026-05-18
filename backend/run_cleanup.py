import sqlite3
import os

DB_PATH = os.path.join("data", "app.db")

conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()

with open("cleanup.sql", "r", encoding="utf-8") as f:
    sql = f.read()

cur.executescript(sql)
conn.commit()
conn.close()

print("✅ cleanup.sql executed successfully.")
