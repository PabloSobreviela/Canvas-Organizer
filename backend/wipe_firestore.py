"""
Wipe Firestore user data for Canvas Organizer.

By default this removes all user subcollections and deletes user documents too.
"""

from db_firestore import get_db, init_firebase


def delete_collection(db, coll_ref, batch_size: int = 400) -> int:
    """Delete all docs in a collection reference."""
    deleted = 0
    docs = list(coll_ref.limit(batch_size).stream())
    while docs:
        batch = db.batch()
        for doc in docs:
            batch.delete(doc.reference)
        batch.commit()
        deleted += len(docs)
        docs = list(coll_ref.limit(batch_size).stream())
    return deleted


def wipe_all_users(delete_user_docs: bool = True):
    init_firebase()
    db = get_db()

    users_ref = db.collection("users")
    users = list(users_ref.stream())
    print(f"Found {len(users)} users")

    for user_doc in users:
        user_ref = users_ref.document(user_doc.id)
        print(f"\nWiping user: {user_doc.id}")

        # Discover subcollections dynamically so future schema changes are covered.
        for subcol in user_ref.collections():
            deleted = delete_collection(db, subcol)
            print(f"  - Deleted {deleted} docs from '{subcol.id}'")

        if delete_user_docs:
            user_ref.delete()
            print("  - Deleted user document")
        else:
            user_ref.update({
                "canvasApiUrl": None,
                "canvasApiTokenEncrypted": None,
                "canvasCredentialKey": None,
            })
            print("  - Cleared Canvas credentials on user document")

    print("\nDone. Firestore wipe complete.")


if __name__ == "__main__":
    wipe_all_users(delete_user_docs=True)
