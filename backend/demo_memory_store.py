"""
Ephemeral in-process storage for /demo sessions.

Demo mode must not depend on Supabase: visitors should be able to try the product
without provisioning cloud database connectivity. Production OAuth users still
use db_supabase.py.
"""

from __future__ import annotations

import hashlib
import threading
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

DEMO_CREDENTIAL_KEY = "demo"

_lock = threading.Lock()
_courses: Dict[str, Dict[str, Any]] = {}
_file_texts: List[Dict[str, Any]] = []
_assignments: List[Dict[str, Any]] = []
_sync_versions: Dict[str, int] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _course_key(user_id: str, course_id: str, canvas_credential_key: str | None) -> str:
    return f"{user_id}|{canvas_credential_key or ''}|{course_id}"


def _assignment_row_to_dict(row: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": str(row.get("id") or ""),
        "courseId": row.get("course_id"),
        "name": row.get("name"),
        "description": row.get("description"),
        "originalDueAt": row.get("original_due_at"),
        "normalizedDueAt": row.get("normalized_due_at"),
        "canvasAssignmentId": row.get("canvas_assignment_id"),
        "sourceOfTruth": row.get("source_of_truth"),
        "status": row.get("status"),
        "category": row.get("category"),
        "deliverable": row.get("deliverable"),
        "discoveredKey": row.get("discovered_key"),
        "courseName": row.get("course_name"),
        "courseCode": row.get("course_code"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
    }


def save_course(user_id: str, course_data: Dict, canvas_credential_key: str = None) -> str:
    course_id = str(course_data.get("canvasCourseId") or course_data.get("id") or "").strip()
    if not course_id:
        raise ValueError("course_data must include id or canvasCourseId")
    key = _course_key(user_id, course_id, canvas_credential_key)
    with _lock:
        row_id = _courses.get(key, {}).get("id") or str(uuid.uuid4())
        _courses[key] = {
            "id": row_id,
            "user_id": user_id,
            "canvas_course_id": course_id,
            "canvas_course_id_str": course_id,
            "course_name": course_data.get("name"),
            "course_code": course_data.get("course_code"),
            "canvas_credential_key": canvas_credential_key,
            "sync_version": _sync_versions.get(key, 0),
            "synced_at": _now_iso(),
        }
        return row_id


def get_course(user_id: str, course_id: str, canvas_credential_key: str = None) -> Optional[Dict]:
    key = _course_key(user_id, str(course_id), canvas_credential_key)
    with _lock:
        row = _courses.get(key)
        if not row:
            return None
        return {
            "id": row["id"],
            "canvasCourseId": row.get("canvas_course_id"),
            "name": row.get("course_name"),
            "courseCode": row.get("course_code"),
            "syncVersion": row.get("sync_version", 0),
        }


def get_user_courses(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    with _lock:
        rows = []
        for row in _courses.values():
            if row.get("user_id") != user_id:
                continue
            if canvas_credential_key and row.get("canvas_credential_key") != canvas_credential_key:
                continue
            rows.append(
                {
                    "id": row.get("canvas_course_id"),
                    "canvasCourseId": row.get("canvas_course_id"),
                    "name": row.get("course_name"),
                    "courseCode": row.get("course_code"),
                }
            )
        return rows


def get_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    key = _course_key(user_id, str(course_id), canvas_credential_key)
    with _lock:
        return int(_sync_versions.get(key, 0))


def increment_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    key = _course_key(user_id, str(course_id), canvas_credential_key)
    with _lock:
        current = int(_sync_versions.get(key, 0))
        new_version = current + 1
        _sync_versions[key] = new_version
        if key in _courses:
            _courses[key]["sync_version"] = new_version
            _courses[key]["synced_at"] = _now_iso()
        return new_version


def archive_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = "schedule",
    canvas_credential_key: str = None,
) -> List[Dict]:
    archived: List[Dict] = []
    with _lock:
        for row in _file_texts:
            if row.get("user_id") != user_id:
                continue
            if str(row.get("course_id")) != str(course_id):
                continue
            if row.get("file_type") != file_type:
                continue
            if canvas_credential_key and row.get("canvas_credential_key") != canvas_credential_key:
                continue
            if row.get("is_previous"):
                continue
            row["is_previous"] = True
            row["archived_at"] = _now_iso()
            archived.append(
                {
                    "id": str(row.get("id")),
                    "fileType": row.get("file_type"),
                    "fileName": row.get("file_name"),
                    "storagePath": row.get("storage_path"),
                    "extractedText": row.get("extracted_text"),
                    "syncVersion": row.get("sync_version") or 1,
                }
            )
    return archived


def save_course_file_text_versioned(
    user_id: str,
    course_id: str,
    file_data: Dict,
    sync_version: int,
    canvas_credential_key: str = None,
) -> str:
    row_id = str(uuid.uuid4())
    canvas_file_id = file_data.get("canvas_file_id") or file_data.get("file_id")
    with _lock:
        _file_texts.append(
            {
                "id": row_id,
                "user_id": user_id,
                "course_id": str(course_id),
                "canvas_file_id": str(canvas_file_id) if canvas_file_id else None,
                "file_type": file_data.get("file_type", "schedule"),
                "file_name": file_data.get("file_name"),
                "storage_path": file_data.get("storage_path"),
                "extracted_text": file_data.get("extracted_text"),
                "sync_version": sync_version,
                "is_previous": False,
                "canvas_credential_key": canvas_credential_key,
                "created_at": _now_iso(),
            }
        )
    return row_id


def cleanup_old_file_versions(
    user_id: str,
    course_id: str,
    keep_versions: int = 2,
    canvas_credential_key: str = None,
):
    course = get_course(user_id, course_id, canvas_credential_key)
    current_version = int((course or {}).get("syncVersion", 0) or 0)
    min_prev_version = max(1, current_version - (keep_versions - 1))
    with _lock:
        _file_texts[:] = [
            row
            for row in _file_texts
            if not (
                row.get("user_id") == user_id
                and str(row.get("course_id")) == str(course_id)
                and row.get("is_previous")
                and (not canvas_credential_key or row.get("canvas_credential_key") == canvas_credential_key)
                and int(row.get("sync_version") or 0) < min_prev_version
            )
        ]


def get_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = None,
    canvas_credential_key: str = None,
) -> List[Dict]:
    with _lock:
        rows = []
        for row in _file_texts:
            if row.get("user_id") != user_id:
                continue
            if str(row.get("course_id")) != str(course_id):
                continue
            if file_type and row.get("file_type") != file_type:
                continue
            if canvas_credential_key and row.get("canvas_credential_key") != canvas_credential_key:
                continue
            rows.append(
                {
                    "id": str(row.get("id")),
                    "fileType": row.get("file_type"),
                    "fileName": row.get("file_name"),
                    "extractedText": row.get("extracted_text"),
                    "isPrevious": row.get("is_previous"),
                    "syncVersion": row.get("sync_version"),
                }
            )
        return rows


def get_course_assignments(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    with _lock:
        rows = []
        for row in _assignments:
            if row.get("user_id") != user_id:
                continue
            if str(row.get("course_id")) != str(course_id):
                continue
            if canvas_credential_key and row.get("canvas_credential_key") != canvas_credential_key:
                continue
            rows.append(_assignment_row_to_dict(row))
        return rows


def delete_discovered_assignments(user_id: str, course_id: str, canvas_credential_key: str = None):
    with _lock:
        _assignments[:] = [
            row
            for row in _assignments
            if not (
                row.get("user_id") == user_id
                and str(row.get("course_id")) == str(course_id)
                and row.get("canvas_assignment_id") is None
                and (not canvas_credential_key or row.get("canvas_credential_key") == canvas_credential_key)
            )
        ]


def save_assignment(user_id: str, course_id: str, assignment_data: Dict, canvas_credential_key: str = None) -> str:
    row_id = str(uuid.uuid4())
    with _lock:
        _assignments.append(
            {
                "id": row_id,
                "user_id": user_id,
                "course_id": str(course_id),
                "name": assignment_data.get("name"),
                "description": assignment_data.get("description"),
                "original_due_at": assignment_data.get("original_due_at"),
                "normalized_due_at": assignment_data.get("normalized_due_at"),
                "canvas_assignment_id": assignment_data.get("canvas_assignment_id"),
                "source_of_truth": assignment_data.get("source_of_truth", "Canvas"),
                "status": assignment_data.get("status", "OK"),
                "category": assignment_data.get("category", "PENDING"),
                "deliverable": assignment_data.get("deliverable", 1),
                "discovered_key": assignment_data.get("discovered_key"),
                "course_name": assignment_data.get("course_name"),
                "course_code": assignment_data.get("course_code"),
                "canvas_credential_key": canvas_credential_key,
                "created_at": _now_iso(),
            }
        )
    return row_id


def delete_assignments_by_doc_ids(
    user_id: str,
    doc_ids: List[str],
    canvas_credential_key: str = None,
) -> int:
    ids = {str(doc_id) for doc_id in (doc_ids or []) if doc_id}
    if not ids:
        return 0
    removed = 0
    with _lock:
        kept = []
        for row in _assignments:
            if (
                row.get("user_id") == user_id
                and str(row.get("id")) in ids
                and (not canvas_credential_key or row.get("canvas_credential_key") == canvas_credential_key)
            ):
                removed += 1
                continue
            kept.append(row)
        _assignments[:] = kept
    return removed


def update_assignment(
    user_id: str,
    course_id: str,
    canvas_assignment_id,
    updates: Dict,
    canvas_credential_key: str = None,
):
    field_map = {
        "normalizedDueAt": "normalized_due_at",
        "originalDueAt": "original_due_at",
        "canvasAssignmentId": "canvas_assignment_id",
        "sourceOfTruth": "source_of_truth",
        "discoveredKey": "discovered_key",
        "courseName": "course_name",
        "courseCode": "course_code",
    }
    with _lock:
        for row in _assignments:
            if row.get("user_id") != user_id:
                continue
            if str(row.get("course_id")) != str(course_id):
                continue
            if canvas_credential_key and row.get("canvas_credential_key") != canvas_credential_key:
                continue
            if str(row.get("canvas_assignment_id")) != str(canvas_assignment_id):
                continue
            for key, value in (updates or {}).items():
                db_key = field_map.get(key, key)
                row[db_key] = value
            return


def demo_db_adapter():
    """Return callables wired to the in-memory demo store."""
    return {
        "save_course": save_course,
        "save_course_file_text_versioned": save_course_file_text_versioned,
        "archive_course_file_texts": archive_course_file_texts,
        "get_course_sync_version": get_course_sync_version,
        "increment_course_sync_version": increment_course_sync_version,
        "cleanup_old_file_versions": cleanup_old_file_versions,
        "save_assignment": save_assignment,
        "get_course_assignments": get_course_assignments,
        "delete_discovered_assignments": delete_discovered_assignments,
        "get_course_file_texts": get_course_file_texts,
        "get_user_courses": get_user_courses,
        "get_course": get_course,
        "update_assignment": update_assignment,
        "delete_assignments_by_doc_ids": delete_assignments_by_doc_ids,
    }


def is_demo_credential_key(canvas_credential_key: str | None) -> bool:
    return str(canvas_credential_key or "") == DEMO_CREDENTIAL_KEY
