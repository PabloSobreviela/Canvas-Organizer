"""
One-time data repair for R2 (docs/OIT_READINESS_AUDIT.md).

Background
----------
Historically, every stored row was scoped by `canvas_credential_key`, a hash of
the *rotating* Canvas access token. Because Canvas tokens rotate ~hourly, each
refresh minted a new key and orphaned the prior rows. This script repoints all
of a user's content to a single STABLE account key derived from the Canvas
account identity (instance URL + canvas_user_id), then removes the duplicate
rows that token churn produced.

Safety
------
- Idempotent: re-running converges to the same state.
- Per-user: only touches rows belonging to each user.
- Dedupe keeps the most recently updated/created row in each natural group.

Usage
-----
    python migrations/005_repair_account_keys.py            # apply
    python migrations/005_repair_account_keys.py --dry-run  # report only

Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.
"""

from __future__ import annotations

import sys

from db_supabase import get_db, build_canvas_account_key, normalize_canvas_url

DRY_RUN = "--dry-run" in sys.argv

# table -> columns that define a "natural" unique row for that user/account.
# Rows that collide on (account_key + these columns) are duplicates.
DEDUPE_KEYS = {
    "courses": ["canvas_course_id"],
    "assignments": ["course_id", "canvas_assignment_id", "discovered_key"],
    "course_file_texts": ["course_id", "canvas_file_id", "sync_version"],
    "announcements": ["course_id", "canvas_announcement_id"],
    "syllabus_rules": ["course_id"],
}
REPOINT_ONLY = []

ORDER_HINT = {
    "courses": "synced_at",
    "assignments": "updated_at",
    "course_file_texts": "created_at",
    "announcements": "posted_at",
    "syllabus_rules": "extracted_at",
}


def _stable_key_for_user(user: dict) -> str | None:
    api_url = user.get("canvas_api_url") or user.get("canvas_instance_url")
    canvas_user_id = user.get("canvas_user_id") or user.get("id")
    if not api_url or not canvas_user_id:
        return None
    return build_canvas_account_key(api_url, canvas_user_id)


def _natural_signature(row: dict, cols: list[str]) -> tuple:
    return tuple(str(row.get(c)) for c in cols)


def repair_user(db, user: dict) -> dict:
    user_id = user["id"]
    stable_key = _stable_key_for_user(user)
    summary = {"user_id": user_id, "stable_key": stable_key, "repointed": {}, "deleted": {}}
    if not stable_key:
        summary["skipped"] = "no canvas account identity"
        return summary

    if not DRY_RUN and user.get("canvas_credential_key") != stable_key:
        db.table("users").update({"canvas_credential_key": stable_key}).eq("id", user_id).execute()

    for table, dedupe_cols in {**DEDUPE_KEYS, **{t: None for t in REPOINT_ONLY}}.items():
        rows = (db.table(table).select("*").eq("user_id", user_id).execute().data) or []
        if not rows:
            continue

        if dedupe_cols:
            order_col = ORDER_HINT.get(table) or "id"
            best: dict[tuple, dict] = {}
            duplicates: list[str] = []
            for row in sorted(rows, key=lambda r: str(r.get(order_col) or ""), reverse=True):
                sig = _natural_signature(row, dedupe_cols)
                if sig in best:
                    duplicates.append(row["id"])
                else:
                    best[sig] = row
            if duplicates:
                summary["deleted"][table] = len(duplicates)
                if not DRY_RUN:
                    db.table(table).delete().in_("id", duplicates).execute()

        repoint = [r["id"] for r in rows if r.get("canvas_credential_key") != stable_key]
        if repoint:
            summary["repointed"][table] = len(repoint)
            if not DRY_RUN:
                # Repoint in batches to avoid oversized IN clauses.
                for i in range(0, len(repoint), 200):
                    chunk = repoint[i : i + 200]
                    db.table(table).update({"canvas_credential_key": stable_key}).in_("id", chunk).execute()

    return summary


def main() -> int:
    db = get_db()
    users = (db.table("users").select("*").execute().data) or []
    print(f"{'DRY RUN: ' if DRY_RUN else ''}Repairing account keys for {len(users)} users")
    for user in users:
        result = repair_user(db, user)
        print(result)
    print("Done." if not DRY_RUN else "Dry run complete (no writes).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
