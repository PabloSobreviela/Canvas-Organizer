# reset_db.py
import os
from db import init_db, DB_PATH

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)
    print(f"🧨 Deleted {DB_PATH}")
else:
    print(f"ℹ️ No DB found at {DB_PATH}")

init_db()
print("✅ Recreated database schema")
