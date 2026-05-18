#!/usr/bin/env python3
"""Wipe all assignments from Firestore. Run from backend/ with env vars set."""
import os
import sys

# Ensure backend is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault("USE_FIRESTORE", "true")
os.environ.setdefault("GCP_PROJECT_ID", "canvas-organizer-4437b")

from db_firestore import get_db

def wipe_all_assignments():
    db = get_db()
    users_ref = db.collection("users")
    total = 0
    for user_doc in users_ref.stream():
        user_id = user_doc.id
        assignments_ref = users_ref.document(user_id).collection("assignments")
        batch = db.batch()
        count = 0
        for doc in assignments_ref.stream():
            batch.delete(doc.reference)
            count += 1
            if count >= 500:
                batch.commit()
                total += count
                print(f"  Deleted {count} from user {user_id}")
                batch = db.batch()
                count = 0
        if count > 0:
            batch.commit()
            total += count
            print(f"  Deleted {count} from user {user_id}")
    return total

if __name__ == "__main__":
    print("Wiping all assignments from Firestore...")
    n = wipe_all_assignments()
    print(f"Done. Deleted {n} assignment(s) total.")
