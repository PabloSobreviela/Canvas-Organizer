"""
Encrypt legacy plaintext Canvas tokens in Firestore.

Requires CANVAS_TOKEN_ENCRYPTION_KEY to be configured.
"""

from db_firestore import (
    get_db,
    init_firebase,
    TOKEN_ENCRYPTION_PREFIX,
    encrypt_canvas_token,
    decrypt_canvas_token,
    _get_token_cipher,
)
from firebase_admin import firestore


def migrate_tokens():
    if not _get_token_cipher():
        raise RuntimeError("CANVAS_TOKEN_ENCRYPTION_KEY is not set or invalid.")

    init_firebase()
    db = get_db()
    users_ref = db.collection("users")
    users = list(users_ref.stream())

    migrated = 0
    already_encrypted = 0
    unreadable = 0

    for user_doc in users:
        data = user_doc.to_dict() or {}
        stored = data.get("canvasApiTokenEncrypted")
        if not stored:
            continue

        if str(stored).startswith(TOKEN_ENCRYPTION_PREFIX):
            plaintext = decrypt_canvas_token(stored)
            if plaintext:
                already_encrypted += 1
            else:
                unreadable += 1
            continue

        encrypted = encrypt_canvas_token(stored)
        user_doc.reference.update({
            "canvasApiTokenEncrypted": encrypted,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        migrated += 1

    print(f"Users scanned: {len(users)}")
    print(f"Migrated plaintext tokens: {migrated}")
    print(f"Already encrypted tokens: {already_encrypted}")
    print(f"Unreadable encrypted tokens: {unreadable}")


if __name__ == "__main__":
    migrate_tokens()
