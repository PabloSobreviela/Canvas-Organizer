"""
Demo mode: syllabus PDFs stand in for Canvas file downloads; mock assignments stand in
for the Canvas assignments API. Date resolution uses the same LLM pipeline as production.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

# Fixed UUID so Supabase accepts demo rows (users.id is UUID)
DEMO_USER_ID = os.getenv("DEMO_USER_ID", "a0000000-0000-4000-8000-000000000001")
DEMO_CREDENTIAL_KEY = "demo"
DEMO_FILES_DIR = Path(__file__).resolve().parent / "demo_files"

DEMO_COURSES: Dict[str, Dict[str, Any]] = {
    "math2552": {
        "id": "math2552",
        "name": "Differential Equations (MATH 2552)",
        "courseCode": "MATH 2552",
        "materials": [
            {
                "filename": "Math_2552_Syllabus (2).pdf",
                "display_name": "MATH 2552 Syllabus",
                "file_type": "syllabus",
                "file_id": "demo-math2552-syllabus",
            },
            {
                "filename": "schedule (1).pdf",
                "display_name": "MATH 2552 Suggested Schedule",
                "file_type": "schedule",
                "file_id": "demo-math2552-schedule",
            },
        ],
    },
}


def is_demo_user(user_id: str = None, is_demo: bool = False) -> bool:
    if is_demo:
        return True
    return str(user_id or "").strip() == DEMO_USER_ID


def get_demo_courses_payload() -> List[Dict[str, Any]]:
    return [
        {
            "id": cfg["id"],
            "name": cfg["name"],
            "courseCode": cfg["courseCode"],
            "status": "NOT_SYNCED",
            "isCurrentlyActive": True,
        }
        for cfg in DEMO_COURSES.values()
    ]


def _extract_file_text(filepath: str) -> str:
    ext = Path(filepath).suffix.lower()
    if ext == ".pdf":
        from parsers.syllabus_text import extract_text_from_pdf_with_tables

        return extract_text_from_pdf_with_tables(filepath)
    if ext == ".txt":
        with open(filepath, "r", encoding="utf-8", errors="ignore") as handle:
            return handle.read()
    return ""


def _mock_canvas_assignments() -> List[Dict[str, Any]]:
    """Canvas-like assignment payloads with no due dates (filled by AI from syllabi)."""
    assignments: List[Dict[str, Any]] = []
    next_id = 1001

    for index in range(1, 16):
        assignments.append(
            {
                "id": next_id,
                "name": f"Webwork HW {index:02d}",
                "description": "",
                "due_at": None,
            }
        )
        next_id += 1

    for index in range(1, 6):
        assignments.append(
            {
                "id": next_id,
                "name": f"Quiz {index}",
                "description": "",
                "due_at": None,
            }
        )
        next_id += 1

    assignments.extend(
        [
            {"id": next_id, "name": "Midterm 1", "description": "", "due_at": None},
            {"id": next_id + 1, "name": "Midterm 2", "description": "", "due_at": None},
        ]
    )
    return assignments


def sync_demo_course_materials(
    user_id: str,
    course_id: str,
    *,
    now_iso: Callable[[], str],
    save_course,
    save_course_file_text_versioned,
    archive_course_file_texts,
    get_course_sync_version,
    increment_course_sync_version,
    cleanup_old_file_versions,
) -> Dict[str, Any]:
    cfg = DEMO_COURSES.get(str(course_id))
    if not cfg:
        raise ValueError(f"Unknown demo course: {course_id}")

    course_name = cfg["name"]
    course_code = cfg["courseCode"]
    save_course(
        user_id,
        {
            "id": course_id,
            "name": course_name,
            "course_code": course_code,
        },
        DEMO_CREDENTIAL_KEY,
    )

    sync_version = get_course_sync_version(user_id, course_id, DEMO_CREDENTIAL_KEY)
    previous_files = archive_course_file_texts(user_id, course_id, "syllabus", DEMO_CREDENTIAL_KEY)
    previous_files += archive_course_file_texts(user_id, course_id, "schedule", DEMO_CREDENTIAL_KEY)
    is_resync = len(previous_files) > 0 or sync_version > 0
    sync_version = increment_course_sync_version(user_id, course_id, DEMO_CREDENTIAL_KEY)

    extracted_materials: List[Dict[str, Any]] = []
    for material in cfg["materials"]:
        file_path = DEMO_FILES_DIR / material["filename"]
        if not file_path.is_file():
            raise FileNotFoundError(f"Demo file missing: {file_path}")

        text = _extract_file_text(str(file_path))
        if not text or len(text.strip()) < 50:
            raise ValueError(f"Could not extract enough text from {material['filename']}")

        extracted_materials.append(
            {
                "source_type": "demo_file",
                "name": material["display_name"],
                "file_type": material["file_type"],
                "file_id": material["file_id"],
                "text": text,
                "metadata": {
                    "file_id": material["file_id"],
                    "path": str(file_path),
                    "source": "demo_files",
                },
            }
        )

        save_course_file_text_versioned(
            user_id,
            course_id,
            {
                "file_id": material["file_id"],
                "canvas_file_id": material["file_id"],
                "file_type": material["file_type"],
                "file_name": material["display_name"],
                "storage_path": f"demo:{material['filename']}",
                "extracted_text": text,
            },
            sync_version,
            DEMO_CREDENTIAL_KEY,
        )

    if is_resync:
        cleanup_old_file_versions(user_id, course_id, keep_versions=2, canvas_credential_key=DEMO_CREDENTIAL_KEY)

    return {
        "course_id": course_id,
        "timestamp": now_iso(),
        "is_resync": is_resync,
        "sync_version": sync_version,
        "previous_files_count": len(previous_files),
        "materials_extracted": len(extracted_materials),
        "materials": [
            {"name": m["name"], "source_type": m["source_type"], "text_length": len(m["text"])}
            for m in extracted_materials
        ],
        "demo": True,
    }


def _format_demo_assignments_response(
    rows: List[Dict[str, Any]],
    course_id: str,
    now_iso: Callable[[], str],
) -> Dict[str, Any]:
    result = []
    for row in rows:
        if row.get("category") == "PLACEHOLDER":
            continue
        result.append(
            {
                "cid": row.get("canvasAssignmentId"),
                "nam": row.get("name"),
                "des": row.get("description"),
                "due": row.get("normalizedDueAt") or row.get("originalDueAt"),
                "st": row.get("status"),
                "cat": row.get("category"),
                "dk": row.get("discoveredKey"),
            }
        )
    return {"crs": course_id, "a": result, "demo": True, "timestamp": now_iso()}


def sync_demo_assignments(
    user_id: str,
    course_id: str,
    *,
    now_iso: Callable[[], str],
    save_assignment,
    get_course_assignments,
    delete_discovered_assignments,
) -> Dict[str, Any]:
    cfg = DEMO_COURSES.get(str(course_id))
    if not cfg:
        raise ValueError(f"Unknown demo course: {course_id}")

    course_name = cfg["name"]
    course_code = cfg["courseCode"]
    mock_assignments = _mock_canvas_assignments()
    existing_rows = get_course_assignments(user_id, course_id, DEMO_CREDENTIAL_KEY)
    existing_canvas = [
        row for row in existing_rows
        if row.get("canvasAssignmentId") is not None and row.get("category") != "PLACEHOLDER"
    ]

    # After AI resolve, the frontend fetches assignments again — do not wipe resolved dates.
    if len(existing_canvas) >= len(mock_assignments):
        return _format_demo_assignments_response(existing_rows, course_id, now_iso)

    delete_discovered_assignments(user_id, course_id, DEMO_CREDENTIAL_KEY)

    for assignment in mock_assignments:
        canvas_assignment_id = assignment.get("id")
        name = assignment.get("name") or ""
        description = assignment.get("description") or ""
        due_at = assignment.get("due_at")
        status = "OK" if due_at else "MISSING_DUE_DATE"

        save_assignment(
            user_id,
            course_id,
            {
                "course_id": course_id,
                "canvas_assignment_id": canvas_assignment_id,
                "name": name,
                "description": description,
                "original_due_at": due_at,
                "normalized_due_at": None,
                "source_of_truth": "Canvas",
                "status": status,
                "category": "PENDING",
                "deliverable": 1,
                "raw_canvas_json": json.dumps(assignment, ensure_ascii=False),
                "course_name": course_name,
                "course_code": course_code,
            },
            DEMO_CREDENTIAL_KEY,
        )

    return _format_demo_assignments_response(
        get_course_assignments(user_id, course_id, DEMO_CREDENTIAL_KEY),
        course_id,
        now_iso,
    )
