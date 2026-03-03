# Canvas Organizer Backend - Cloud Version
# ==========================================
# This version supports both:
# 1. CLOUD MODE: Multi-user with Firebase Auth + Firestore (production)
# 2. LOCAL MODE: Single-user with SQLite (development/testing)
#
# Set USE_FIRESTORE=true environment variable to enable cloud mode.
# In local mode, no authentication is required and SQLite is used.

import os
import json
import hashlib
import logging
import uuid

logger = logging.getLogger(__name__)
import requests
import time
import socket
import ipaddress
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, g
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address


def _rate_limit_key():
    """Use X-Forwarded-For when behind Cloud Run/proxy, else remote_addr."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip() or get_remote_address()
    return get_remote_address()


from pathlib import Path
from urllib.parse import unquote, urlparse, urljoin
from fnmatch import fnmatch

# NOTE: Avoid importing heavy optional dependencies at module import time.
# Cloud Run cold starts are dominated by Python import time; keep the import graph
# small for endpoints like /api/health and /api/canvas/courses.

# Determine mode based on environment
USE_FIRESTORE = os.getenv('USE_FIRESTORE', 'false').lower() == 'true'
# Force cloud mode on Cloud Run (K_SERVICE); local mode has no auth.
if os.getenv('K_SERVICE') and not USE_FIRESTORE:
    USE_FIRESTORE = True
    logger.info("Cloud Run detected: forcing USE_FIRESTORE=true (local mode has no auth)")

if USE_FIRESTORE:
    # Cloud mode: Use Firestore + Firebase Auth
    from db_firestore import (
        init_db, get_user, save_course, get_user_courses, 
        save_courses_batch,
        save_assignment, get_course_assignments, get_user_assignments, get_user_assignments_lite, get_assignment_by_canvas_id,
        update_assignment, delete_discovered_assignments, delete_assignments_by_doc_ids,
        save_course_file_text, get_course_file_texts, delete_course_file_texts,
        save_announcement, get_course_announcements,
        save_syllabus_rules, get_syllabus_rules,
        get_reading_items, update_course_metadata, get_course,
        get_user_canvas_credentials, update_user_canvas_credentials,
        build_canvas_credential_key,
        consume_hourly_rate_limit,
        get_user_preferences, update_user_preferences,
        # New versioning functions for smart resync
        archive_course_file_texts, save_course_file_text_versioned,
        get_course_sync_version, increment_course_sync_version,
        cleanup_old_file_versions,
        save_ai_usage_log, get_ai_usage_logs
    )
    from auth import require_auth, optional_auth
    logger.info("MODE: CLOUD (Firestore + Firebase Auth)")
else:
    # Local mode: Use SQLite (legacy)
    from db import get_db, init_db
    logger.warning("MODE: LOCAL (SQLite, no auth)")
    logger.warning("SECURITY: Local mode has NO authentication. Do not expose to the network.")
    
    # Create no-op decorators for local mode
    def require_auth(f):
        from functools import wraps
        @wraps(f)
        def decorated(*args, **kwargs):
            # In local mode, use a fixed dev user
            request.user_id = "local-dev-user"
            request.user_email = "dev@localhost"
            request.user_name = "Local Developer"
            return f(*args, **kwargs)
        return decorated
    
    optional_auth = require_auth

try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

import re

STORAGE_ROOT = os.path.join("data", "storage")
SCHEDULE_KEYWORDS = ['syllabus', 'schedule', 'calendar']
FILE_EXTENSIONS = ['.pdf', '.docx', '.doc', '.txt', '.xlsx', '.xls']
CANVAS_REQUEST_TIMEOUT_SECONDS = int(os.getenv("CANVAS_REQUEST_TIMEOUT_SECONDS", "20"))
CANVAS_ALLOWED_HOST_PATTERNS = [
    p.strip().lower()
    for p in os.getenv("CANVAS_ALLOWED_HOST_PATTERNS", "*.instructure.com").split(",")
    if p.strip()
] or ["*.instructure.com"]
try:
    COURSE_SYNC_RATE_LIMIT_PER_HOUR = int(os.getenv("COURSE_SYNC_RATE_LIMIT_PER_HOUR", "300"))
except (TypeError, ValueError):
    COURSE_SYNC_RATE_LIMIT_PER_HOUR = 300
if COURSE_SYNC_RATE_LIMIT_PER_HOUR < 1:
    COURSE_SYNC_RATE_LIMIT_PER_HOUR = 1
# Only allow rate limit relaxation in development (not on Cloud Run / K_SERVICE)
_is_production = bool(os.getenv("K_SERVICE"))
_relax_requested = os.getenv("RELAX_SYNC_RATE_LIMITS_FOR_TESTING", "false").strip().lower() in {"1", "true", "yes", "on"}
if _is_production and _relax_requested:
    # Block: never honor RELAX_SYNC_RATE_LIMITS in production
    pass  # COURSE_SYNC_RATE_LIMIT_PER_HOUR stays at configured value
elif not _is_production and _relax_requested:
    COURSE_SYNC_RATE_LIMIT_PER_HOUR = max(COURSE_SYNC_RATE_LIMIT_PER_HOUR, 2000)

try:
    CANVAS_COURSES_CACHE_SECONDS = int(os.getenv("CANVAS_COURSES_CACHE_SECONDS", "60"))
except (TypeError, ValueError):
    CANVAS_COURSES_CACHE_SECONDS = 60
if CANVAS_COURSES_CACHE_SECONDS < 0:
    CANVAS_COURSES_CACHE_SECONDS = 0

_CANVAS_COURSES_CACHE = {}
_CANVAS_COURSES_CACHE_LOCK = threading.Lock()


def _courses_cache_get(cache_key: str):
    if not cache_key or CANVAS_COURSES_CACHE_SECONDS <= 0:
        return None
    now = time.time()
    with _CANVAS_COURSES_CACHE_LOCK:
        entry = _CANVAS_COURSES_CACHE.get(cache_key)
        if not entry:
            return None
        if entry.get("expires_at", 0) <= now:
            _CANVAS_COURSES_CACHE.pop(cache_key, None)
            return None
        return entry.get("courses")


def _courses_cache_set(cache_key: str, courses):
    if not cache_key or CANVAS_COURSES_CACHE_SECONDS <= 0:
        return
    expires_at = time.time() + CANVAS_COURSES_CACHE_SECONDS
    with _CANVAS_COURSES_CACHE_LOCK:
        _CANVAS_COURSES_CACHE[cache_key] = {"expires_at": expires_at, "courses": courses}

# -----------------------------
# APP SETUP
# -----------------------------
app = Flask(__name__)

# Rate limiter: protects auth and credential endpoints from brute force / abuse
limiter = Limiter(
    key_func=_rate_limit_key,
    app=app,
    default_limits=["200/hour"],
    storage_uri="memory://",
)

# -----------------------------------------------------------------------------
# CORS configuration
# -----------------------------------------------------------------------------
# Browser fetches include an `Authorization` header which triggers CORS preflight
# (OPTIONS). If preflight does not return Access-Control-Allow-Origin, the browser
# will block *all* API calls with "No 'Access-Control-Allow-Origin' header ...".

_DEFAULT_ALLOWED_ORIGINS = [
    "https://canvas-organizer-4437b.web.app",
    "https://canvas-organizer-4437b.firebaseapp.com",
    "https://canvassync.app",
    "https://www.canvassync.app",
]

# Firebase Hosting preview channels use `--<channel>` in the hostname, e.g.
# `https://canvas-organizer-4437b--pr-1234.web.app`.
_DEFAULT_ALLOWED_ORIGIN_PATTERNS = [
    "https://canvas-organizer-4437b--*.web.app",
    "https://canvas-organizer-4437b--*.firebaseapp.com",
]

_LOCAL_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]


def _split_csv_env(name: str) -> list[str]:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return []
    return [v.strip() for v in raw.split(",") if v.strip()]


def _env_truthy(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


# Default False in production; require explicit opt-in to avoid accidental exposure
ENABLE_CLOUD_COST_AUDIT_ENDPOINT = _env_truthy("ENABLE_CLOUD_COST_AUDIT_ENDPOINT", default=not _is_production)
CLOUD_COST_ALLOWED_EMAILS = {email.lower() for email in _split_csv_env("CLOUD_COST_ALLOWED_EMAILS")}


# Allow runtime config via env vars (comma-separated). These are additive.
# - CORS_ALLOWED_ORIGINS: exact origins
# - CORS_ALLOWED_ORIGIN_PATTERNS: glob-style patterns (matched via fnmatch)
allowed_origins = list(_DEFAULT_ALLOWED_ORIGINS)
allowed_origins.extend(_split_csv_env("CORS_ALLOWED_ORIGINS"))
allowed_origins = list(dict.fromkeys(allowed_origins))

allowed_origin_patterns = list(_DEFAULT_ALLOWED_ORIGIN_PATTERNS)
allowed_origin_patterns.extend(_split_csv_env("CORS_ALLOWED_ORIGIN_PATTERNS"))
allowed_origin_patterns = list(dict.fromkeys(allowed_origin_patterns))

# In production, reject overly permissive CORS config (e.g. "*" allows any origin).
if os.getenv("K_SERVICE"):
    _unsafe_origins = {"*"}
    allowed_origins = [o for o in allowed_origins if o not in _unsafe_origins]
    _unsafe_patterns = {"*", "*.*", "https://*", "http://*"}
    allowed_origin_patterns = [p for p in allowed_origin_patterns if p not in _unsafe_patterns]
    if any(o in _unsafe_origins for o in _split_csv_env("CORS_ALLOWED_ORIGINS")):
        logger.warning("CORS: Rejected unsafe origin '*' in production")
    if any(p in _unsafe_patterns for p in _split_csv_env("CORS_ALLOWED_ORIGIN_PATTERNS")):
        logger.warning("CORS: Rejected unsafe pattern in production")

if not os.getenv("K_SERVICE"):
    # Local development only
    allowed_origins.extend(_LOCAL_DEV_ORIGINS)


def _origin_is_allowed(origin: str) -> bool:
    if not origin:
        return False
    if origin in allowed_origins:
        return True
    for pat in allowed_origin_patterns:
        if fnmatch(origin, pat):
            return True
    return False


def _set_vary_origin(response):
    existing = response.headers.get("Vary")
    if not existing:
        response.headers["Vary"] = "Origin"
        return
    if "origin" in existing.lower():
        return
    response.headers["Vary"] = f"{existing}, Origin"


def _apply_cors_headers(response):
    """
    Defense-in-depth: ensure CORS headers are present even for automatically
    generated responses (including OPTIONS) and error paths.

    We intentionally implement this ourselves instead of relying on Flask-CORS
    behavior so that preflight responses never miss headers.
    """
    try:
        origin = request.headers.get("Origin")
        if not origin or not _origin_is_allowed(origin):
            return response

        response.headers["Access-Control-Allow-Origin"] = origin
        _set_vary_origin(response)
        response.headers["Access-Control-Allow-Credentials"] = "true"

        # Fixed allowlist; do not echo client-requested headers (security)
        response.headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        response.headers["Access-Control-Max-Age"] = "600"
    except Exception:
        pass
    return response


# Keep Flask-CORS enabled as a backstop, but do not rely on it for correctness.
CORS(
    app,
    origins=allowed_origins,
    supports_credentials=True,
    allow_headers=["Content-Type", "Authorization"],
    methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
)


@app.after_request
def add_cors_headers(response):
    return _apply_cors_headers(response)


@app.after_request
def add_security_headers(response):
    """Add security headers to mitigate clickjacking, MIME sniffing, downgrade attacks, XSS."""
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    # CSP: defense-in-depth against XSS (applies to any HTML the backend may serve)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none'"
    )
    return response


@app.before_request
def handle_cors_preflight():
    # Ensure every OPTIONS preflight gets a fast response with CORS headers.
    if request.method == "OPTIONS":
        origin = request.headers.get("Origin") or ""
        if origin and not _origin_is_allowed(origin):
            logger.warning("CORS: Blocked preflight origin=%s path=%s", origin, request.path)
        resp = app.make_response(("", 204))
        return _apply_cors_headers(resp)

os.makedirs(STORAGE_ROOT, exist_ok=True)
# NOTE: Avoid doing network initialization at import time in Cloud Run. If Firebase/ADC
# init blocks (or the metadata server is unreachable), the revision can fail to become
# ready and Cloud Run will return 503s without CORS headers (making debugging painful).
if not USE_FIRESTORE:
    try:
        init_db()
    except Exception as exc:
        logger.error("BOOT: init_db failed: %s", exc)


# -----------------------------
# HELPERS
# -----------------------------
def extract_course_code_fallback(name: str) -> str:
    """Fallback if AI hasn't run yet."""
    if not name: return "UNK"
    match = re.search(r'\b([A-Z]{2,4})\s?(\d{3,4})\b', name)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    return name[:6].upper()


def extract_course_code(name: str) -> str:
    """Extract short code like 'CS 1331' or 'MATH 2551' from course name."""
    if not name:
        return "UNK"
    match = re.search(r'\b([A-Z]{2,4})\s?(\d{3,4})\b', name)
    if match:
        return f"{match.group(1)} {match.group(2)}"
    parts = name.split()
    if len(parts) > 1:
        return "".join(p[0] for p in parts if p).upper()[:4]
    return name[:6].upper()


def normalize_course_code(value: str) -> str:
    """Normalize course code strings into a stable format for comparisons."""
    text = (value or "").strip()
    if not text:
        return ""
    match = re.search(r"\b([A-Za-z]{2,6})\s*[- ]?\s*(\d{3,4})\b", text)
    if match:
        return f"{match.group(1).upper()} {match.group(2)}"
    return text.upper()


def _extract_canvas_course_id_from_record(course_record: dict) -> str:
    """Best-effort extraction of Canvas course id from course payload variants."""
    if not isinstance(course_record, dict):
        return ""
    return str(
        course_record.get("canvasCourseIdStr")
        or course_record.get("canvasCourseId")
        or course_record.get("id")
        or ""
    ).strip()


def get_grouped_course_ids_by_code(
    user_id: str,
    primary_course_id: str,
    canvas_credential_key: str = None,
):
    """
    Return course ids that share the same normalized class code as the primary course.
    Used to unify lecture/lab/studio sections (e.g., duplicate MATH 2552 sections)
    so AI resolution operates on one merged context.
    """
    primary_id = str(primary_course_id or "").strip()
    if not primary_id:
        return []

    if not USE_FIRESTORE:
        return [primary_id]

    try:
        all_courses = get_user_courses(user_id, canvas_credential_key) or []
    except Exception as e:
        logger.warning("Could not fetch user courses for grouping: %s", e)
        return [primary_id]

    by_id = {}
    for course in all_courses:
        cid = _extract_canvas_course_id_from_record(course)
        if cid:
            by_id[cid] = course

    primary_course = by_id.get(primary_id) or get_course(user_id, primary_id, canvas_credential_key) or {}
    target_code = normalize_course_code(
        primary_course.get("courseCode") or primary_course.get("course_code") or ""
    )

    # Do not group unknown/empty codes to avoid accidental merges.
    if not target_code or target_code == "UNK":
        return [primary_id]

    grouped = []
    for cid, course in by_id.items():
        code = normalize_course_code(course.get("courseCode") or course.get("course_code") or "")
        if code == target_code:
            grouped.append(cid)

    # Ensure primary course is always included and ordered first.
    if primary_id not in grouped:
        grouped.append(primary_id)
    ordered = [primary_id] + [cid for cid in grouped if cid != primary_id]
    return list(dict.fromkeys(ordered))


def is_transient_ai_error(exc: Exception) -> bool:
    """
    Best-effort classification of temporary AI/provider failures.
    """
    text = str(exc or "").lower()
    transient_markers = (
        "resource exhausted",
        "quota",
        "rate limit",
        "too many requests",
        "service unavailable",
        "temporarily unavailable",
        "deadline exceeded",
        "connection reset",
        "429",
        "503",
    )
    return any(marker in text for marker in transient_markers)


def force_assignment_if_deliverable_keywords(name: str, desc: str):
    """Hard override: WeBWorK / Gradescope / Homework is an ASSIGNMENT."""
    t = f"{name or ''} {desc or ''}".lower()
    if "webwork" in t or "gradescope" in t:
        return True
    if re.search(r"\bhomework\b", t) or re.search(r"\bhw\b", t):
        return True
    return False


def extract_text_from_xlsx(filepath: str, max_chars: int = 20000) -> str:
    """Minimal XLSX -> text extraction."""
    import openpyxl
    wb = openpyxl.load_workbook(filepath, data_only=True, read_only=True)
    out = []
    try:
        for ws in wb.worksheets:
            out.append(f"## Sheet: {ws.title}")
            for row in ws.iter_rows(values_only=True):
                if not row:
                    continue
                vals = []
                for v in row:
                    if v is None:
                        continue
                    s = str(v).strip()
                    if s:
                        vals.append(s)
                if vals:
                    out.append("\t".join(vals))
                if sum(len(x) for x in out) > max_chars:
                    out.append("...")
                    return "\n".join(out)[:max_chars]
        return "\n".join(out).strip()
    finally:
        wb.close()


def extract_text_safely(filepath: str) -> str:
    """Uses extract_text_from_file() for most types, adds XLSX support."""
    ext = Path(filepath).suffix.lower()
    if ext in {".xlsx", ".xlsm", ".xltx", ".xltm", ".xls"}:
        return extract_text_from_xlsx(filepath)
    from parsers.syllabus_text import extract_text_from_file
    return extract_text_from_file(filepath)


def infer_category_from_canvas_assignment(canvas_json):
    """Infer category from Canvas assignment. Only ASSIGNMENT and EXAM categories."""
    name = (canvas_json.get("name") or "").strip().lower()
    
    # Check for exam/quiz keywords
    exam_keywords = ["quiz", "exam", "midterm", "final", "test"]
    if any(k in name for k in exam_keywords):
        return "EXAM", 1

    return "ASSIGNMENT", 1


def infer_category_from_discovered_item(name: str, description: str = ""):
    """Infer category from item name/description. Only ASSIGNMENT and EXAM categories."""
    n = (name or "").strip().lower()
    d = (description or "").strip().lower()

    # Exam/Quiz keywords -> EXAM
    exam_keywords = [
        "quiz", "exam", "midterm", "final", "test"
    ]
    if any(k in n for k in exam_keywords) or any(k in d for k in exam_keywords):
        return "EXAM", 1

    # Everything else is an ASSIGNMENT
    return "ASSIGNMENT", 1


def normalize_due_for_dedupe(raw_due: str) -> str:
    """Normalize due strings to stable YYYY-MM-DD when possible for dedupe keys."""
    due = str(raw_due or "").strip()
    if not due:
        return ""
    if "T" in due:
        due = due.split("T", 1)[0].strip()
    m = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", due)
    if m:
        return m.group(1)
    return due


def normalize_discovered_name_for_dedupe(raw_name: str) -> str:
    """
    Normalize discovered item names so small wording/category drifts
    (e.g., quiz/test/exam) map to one semantic key.
    """
    text = str(raw_name or "").strip().lower()
    if not text:
        return ""

    text = text.replace("&", " and ")
    text = re.sub(r"#\s*(\d+)", r" \1 ", text)
    text = re.sub(r"\b(quizzes?|tests?|midterms?|finals?|exams?)\b", " exam ", text)
    text = re.sub(r"\b(homeworks?|hws?|assignments?)\b", " assignment ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build_discovered_item_dedupe_key(
    name: str,
    due: str = "",
    category: str = "",
    description: str = "",
) -> str:
    """
    Build a semantic dedupe key for discovered (non-Canvas) items.

    Goal: preserve one logical item across wording shifts while avoiding over-merges.
    """
    normalized_name = normalize_discovered_name_for_dedupe(name)
    if not normalized_name:
        normalized_name = normalize_discovered_name_for_dedupe(description)
    if not normalized_name:
        normalized_name = "item"

    # Remove noisy filler terms to stabilize across minor title edits.
    stopwords = {"the", "a", "an", "for", "to", "of", "on", "in", "due", "from"}
    tokens = [t for t in normalized_name.split() if t and t not in stopwords]
    normalized_name = " ".join(tokens) or "item"

    cat = str(category or "").strip().upper()
    if cat == "QUIZ":
        cat = "EXAM"
    if cat not in ("EXAM", "ASSIGNMENT", "PLACEHOLDER"):
        inferred_cat, _ = infer_category_from_discovered_item(name, description)
        cat = inferred_cat or "ASSIGNMENT"

    number_match = re.search(r"\b(\d{1,3})\b", normalized_name)
    number_token = ""
    if number_match:
        number_token = number_match.group(1).lstrip("0") or "0"

    is_generic = normalized_name in {"exam", "assignment", "item"} or len(normalized_name.split()) <= 1
    due_token = normalize_due_for_dedupe(due) if is_generic else ""

    key_parts = [cat.lower(), normalized_name]
    if number_token:
        key_parts.append(f"n{number_token}")
    if due_token:
        key_parts.append(f"d{due_token}")
    return "|".join(key_parts)


def dedupe_discovered_ai_results(items):
    """
    Collapse duplicate discovered rows returned by AI using semantic keys.
    Keeps the highest-priority action per key.
    """
    action_priority = {"UPDATE": 3, "KEEP": 2, "ADD": 1}
    chosen = {}

    def score(item):
        action = str(item.get("action") or "").strip().upper()
        due = normalize_due_for_dedupe(item.get("due") or item.get("normalized_due_at"))
        name_len = len(str(item.get("nam") or item.get("name") or "").strip())
        return (1 if due else 0, action_priority.get(action, 0), name_len)

    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        name = (raw.get("nam") or raw.get("name") or "").strip()
        if not name:
            continue
        due = raw.get("due") or raw.get("normalized_due_at")
        cat = raw.get("cat") or raw.get("category") or ""
        desc = raw.get("des") or raw.get("description") or ""
        key = build_discovered_item_dedupe_key(name=name, due=due, category=cat, description=desc)
        if not key:
            continue

        current = chosen.get(key)
        if current is None or score(raw) > score(current):
            chosen[key] = raw

    return list(chosen.values())


def normalize_assignment_family(category: str, name: str = "", description: str = "") -> str:
    """Map category/name into the canonical family used for dedupe matching."""
    cat = str(category or "").strip().upper()
    if cat == "QUIZ":
        cat = "EXAM"
    if cat in ("EXAM", "ASSIGNMENT"):
        return cat
    inferred, _ = infer_category_from_discovered_item(name, description)
    return inferred or "ASSIGNMENT"


def extract_sequence_token(name: str, description: str = "") -> str:
    """
    Extract likely sequence token (e.g., 1, 2, 3) used in item titles.
    Restricts to 1-3 digits so course codes like 3010 are ignored.
    Prefers assignment-like numbers (1-20) over year-like numbers (e.g. 24 from Su24).
    """
    normalized_name = normalize_discovered_name_for_dedupe(name)
    name_candidates = re.findall(r"\b(\d{1,3})\b", normalized_name) if normalized_name else []
    if not name_candidates:
        return ""

    # Prefer assignment-like sequence numbers (1-20) over year-like (24, 25, etc.)
    assignment_like = [c for c in name_candidates if c.isdigit() and 1 <= int(c) <= 20]
    if assignment_like:
        return (assignment_like[-1].lstrip("0") or "0")
    return (name_candidates[-1].lstrip("0") or "0")


def parse_due_date_for_compare(raw_due: str):
    """Best-effort date parse for dedupe comparisons (returns date or None)."""
    token = normalize_due_for_dedupe(raw_due)
    if not token:
        return None
    try:
        return datetime.strptime(token, "%Y-%m-%d").date()
    except Exception:
        return None


def build_assignment_semantic_signature(
    name: str,
    due: str = "",
    category: str = "",
    description: str = "",
) -> dict:
    """
    Build a compact semantic signature for cross-source dedupe matching.
    """
    normalized_name = normalize_discovered_name_for_dedupe(name)
    stopwords = {
        "the", "a", "an", "for", "to", "of", "on", "in", "due", "from",
        "exam", "assignment", "and", "class", "course",
    }
    tokens = {
        token
        for token in normalized_name.split()
        if token and token not in stopwords and not token.isdigit()
    }
    return {
        "family": normalize_assignment_family(category, name, description),
        "sequence": extract_sequence_token(name, description),
        "tokens": tokens,
        "due_date": parse_due_date_for_compare(due),
        "normalized_name": normalized_name,
    }


def _normalized_name_contains_or_equals(norm_a: str, norm_b: str, min_len: int = 3) -> bool:
    """
    Return True if norm_a and norm_b refer to the same logical item by name.
    Handles cases like "exam 3" vs "exam 3 su24 key" (one contains the other).
    Avoids false positives like "exam 1" matching "exam 12" (word-boundary safe).
    """
    if not norm_a or not norm_b:
        return False
    a, b = norm_a.strip(), norm_b.strip()
    if len(a) < min_len or len(b) < min_len:
        return False

    def _safe_contains(shorter: str, longer: str) -> bool:
        if shorter not in longer:
            return False
        idx = longer.find(shorter)
        end = idx + len(shorter)
        # Require word boundary: next char must be space, end, or non-digit
        if end < len(longer) and longer[end].isdigit():
            return False  # e.g. "exam 1" in "exam 12"
        return True

    if _safe_contains(a, b) or _safe_contains(b, a):
        return True
    a_words = set(w for w in a.split() if len(w) >= 2 and not w.isdigit())
    b_words = set(w for w in b.split() if len(w) >= 2 and not w.isdigit())
    if not a_words or not b_words:
        return False
    overlap = len(a_words & b_words) / max(len(a_words | b_words), 1)
    return overlap >= 0.8


def discovered_matches_canvas(
    name: str,
    due: str,
    category: str,
    description: str,
    canvas_signatures: list,
) -> bool:
    """
    Return True if a discovered item is semantically equivalent to any Canvas item.
    This prevents Canvas + discovered duplicates for the same logical assessment.
    """
    discovered_sig = build_assignment_semantic_signature(
        name=name,
        due=due,
        category=category,
        description=description,
    )
    discovered_norm = normalize_discovered_name_for_dedupe(name)
    discovered_due = discovered_sig.get("due_date")

    for canvas_sig in canvas_signatures or []:
        if canvas_sig.get("family") != discovered_sig.get("family"):
            continue

        discovered_seq = discovered_sig.get("sequence")
        canvas_seq = canvas_sig.get("sequence")
        canvas_due = canvas_sig.get("due_date")

        # Strong match: same category family + same sequence number.
        if discovered_seq and canvas_seq and discovered_seq == canvas_seq:
            if discovered_due and canvas_due:
                if abs((discovered_due - canvas_due).days) > 45:
                    continue
            return True

        # Fallback when sequence numbers are absent.
        discovered_tokens = discovered_sig.get("tokens") or set()
        canvas_tokens = canvas_sig.get("tokens") or set()
        if not discovered_seq and not canvas_seq and discovered_tokens and canvas_tokens:
            overlap = len(discovered_tokens & canvas_tokens)
            union = len(discovered_tokens | canvas_tokens) or 1
            similarity = overlap / union
            if similarity >= 0.85:
                if discovered_due and canvas_due and abs((discovered_due - canvas_due).days) > 14:
                    continue
                return True

        # Name containment fallback: "Exam 3" vs "Exam 3 Su24 Key.pdf" - same logical item.
        canvas_norm = canvas_sig.get("normalized_name") or ""
        if canvas_norm and _normalized_name_contains_or_equals(discovered_norm, canvas_norm):
            if discovered_due and canvas_due and abs((discovered_due - canvas_due).days) > 14:
                continue
            return True

    return False


def canvas_headers(token):
    return {"Authorization": f"Bearer {token}"}


def canvas_assignment_is_completed(canvas_assignment: dict) -> bool:
    """
    Infer whether the current user has completed/submitted a Canvas assignment.
    Uses per-user submission details when available.
    """
    if not isinstance(canvas_assignment, dict):
        return False

    submission = canvas_assignment.get("submission")
    if not isinstance(submission, dict):
        # Docs: when include[]=submission is used, this field represents
        # the current user's submission. If absent, user has no submission.
        return False

    if submission.get("excused") is True:
        return True
    if submission.get("missing") is True:
        return False

    workflow_state = str(submission.get("workflow_state") or "").strip().lower()
    if workflow_state == "unsubmitted":
        return False

    submitted_at = submission.get("submitted_at")
    if submitted_at:
        return True

    # attempt > 0 is another strong signal that a submission was made.
    try:
        attempt = int(submission.get("attempt") or 0)
    except (TypeError, ValueError):
        attempt = 0
    if attempt > 0:
        return True

    # Conservative fallback for states that generally indicate an active submission.
    if workflow_state in {"submitted", "pending_review"}:
        return True

    return False


def is_schedule_file(filename):
    if not filename:
        return False
    lower = filename.lower()
    return any(keyword in lower for keyword in SCHEDULE_KEYWORDS)


def is_file_url(url):
    if not url:
        return False
    lower = url.lower()
    return any(ext in lower for ext in FILE_EXTENSIONS)


def is_canvas_origin_url(url: str, base_url: str) -> bool:
    """
    Return True when `url` points to a trusted Canvas file host.
    Accepts the primary Canvas host and Canvas user-content hosts.
    """
    try:
        parsed_url = urlparse((url or "").strip())
        parsed_base = urlparse((base_url or "").strip())
    except Exception:
        return False

    host = (parsed_url.hostname or "").strip().lower().rstrip(".")
    base_host = (parsed_base.hostname or "").strip().lower().rstrip(".")
    if parsed_url.scheme != "https" or not host:
        return False
    if host == base_host:
        return True
    if host == "canvas-user-content.com" or host.endswith(".canvas-user-content.com"):
        return True
    return False


def normalize_canvas_course_id(course_id: str) -> str:
    """
    Canvas course IDs are numeric. Enforce that here to prevent path traversal
    and malformed identifiers entering downstream logic.
    """
    value = (course_id or "").strip()
    if not value:
        raise ValueError("course_id is empty.")
    if not re.fullmatch(r"\d{1,20}", value):
        raise ValueError("course_id must be a numeric Canvas course ID.")
    return value


def make_course_storage_dir(course_id: str, user_id: str = None, canvas_credential_key: str = None):
    """
    Build a safe local cache directory for sync artifacts.
    In cloud mode, scope by user + connected credential to prevent cache bleed.
    """
    safe_course_id = normalize_canvas_course_id(str(course_id))
    path_parts = [STORAGE_ROOT]

    if user_id:
        user_hash = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()[:16]
        path_parts.append(f"user_{user_hash}")

    if canvas_credential_key:
        cred_hash = hashlib.sha256(str(canvas_credential_key).encode("utf-8")).hexdigest()[:16]
        path_parts.append(f"cred_{cred_hash}")

    path_parts.append(f"course_{safe_course_id}")
    base = os.path.abspath(os.path.join(*path_parts))
    root = os.path.abspath(STORAGE_ROOT)

    # Defense-in-depth: assert computed path stays within configured storage root.
    if os.path.commonpath([root, base]) != root:
        raise ValueError("Computed storage path escapes storage root.")

    schedule_dir = os.path.join(base, "schedules")
    os.makedirs(schedule_dir, exist_ok=True)
    return base, schedule_dir


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def persist_ai_usage_log(
    user_id: str,
    usage_payload: dict,
    *,
    course_id: str = None,
    canvas_credential_key: str = None,
):
    """
    Persist Gemini token/cost usage logs in a backend-only store.
    """
    if not usage_payload or not isinstance(usage_payload, dict):
        return

    payload = dict(usage_payload)
    if course_id and not payload.get("course_id"):
        payload["course_id"] = str(course_id)

    if USE_FIRESTORE:
        try:
            save_ai_usage_log(user_id, payload, canvas_credential_key)
        except Exception as e:
            logger.warning("Failed to persist Firestore AI usage log: %s", e)
        return

    # Local mode: SQLite
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO ai_usage_logs (
                user_id, course_id, request_id, operation, model,
                input_tokens, output_tokens, total_tokens, cached_tokens,
                estimated_cost_usd, currency, pricing_source, status,
                prompt_chars, is_resync, raw_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            str(user_id),
            str(payload.get("course_id") or ""),
            str(payload.get("request_id") or ""),
            str(payload.get("operation") or ""),
            str(payload.get("model") or ""),
            int(payload.get("input_tokens") or 0),
            int(payload.get("output_tokens") or 0),
            int(payload.get("total_tokens") or 0),
            int(payload.get("cached_tokens") or 0),
            float(payload.get("estimated_cost_usd") or 0.0),
            str(payload.get("currency") or "USD"),
            str(payload.get("pricing_source") or "unconfigured"),
            str(payload.get("status") or "ok"),
            int(payload.get("prompt_chars") or 0),
            1 if bool(payload.get("is_resync")) else 0 if payload.get("is_resync") is not None else None,
            json.dumps(payload, ensure_ascii=True),
            now_iso(),
        ))
        conn.commit()
    except Exception as e:
        logger.warning("Failed to persist SQLite AI usage log: %s", e)
    finally:
        if conn:
            conn.close()


def fetch_ai_usage_logs_for_user(
    user_id: str,
    *,
    limit: int = 50,
    course_id: str = None,
    canvas_credential_key: str = None,
):
    """
    Read Gemini usage logs from backend storage.
    """
    try:
        limit_int = int(limit or 50)
    except (TypeError, ValueError):
        limit_int = 50
    limit_int = max(1, min(limit_int, 200))

    if USE_FIRESTORE:
        try:
            return get_ai_usage_logs(
                user_id,
                limit=limit_int,
                course_id=course_id,
                canvas_credential_key=canvas_credential_key,
            )
        except Exception as e:
            logger.warning("Failed to fetch Firestore AI usage logs: %s", e)
            return []

    # Local mode: SQLite
    conn = None
    try:
        conn = get_db()
        cur = conn.cursor()
        params = [str(user_id)]
        where = "WHERE user_id = ?"
        if course_id is not None and str(course_id).strip():
            where += " AND course_id = ?"
            params.append(str(course_id).strip())

        cur.execute(f"""
            SELECT id, course_id, request_id, operation, model,
                   input_tokens, output_tokens, total_tokens, cached_tokens,
                   estimated_cost_usd, currency, pricing_source, status,
                   prompt_chars, is_resync, raw_json, created_at
            FROM ai_usage_logs
            {where}
            ORDER BY created_at DESC
            LIMIT ?
        """, (*params, limit_int))

        rows = []
        for row in cur.fetchall():
            raw = {}
            raw_json = row["raw_json"]
            if raw_json:
                try:
                    raw = json.loads(raw_json)
                except Exception:
                    raw = {}
            rows.append({
                "id": row["id"],
                "courseId": row["course_id"],
                "requestId": row["request_id"],
                "operation": row["operation"],
                "model": row["model"],
                "inputTokens": int(row["input_tokens"] or 0),
                "outputTokens": int(row["output_tokens"] or 0),
                "totalTokens": int(row["total_tokens"] or 0),
                "cachedTokens": int(row["cached_tokens"] or 0),
                "estimatedCostUsd": float(row["estimated_cost_usd"] or 0.0),
                "currency": row["currency"] or "USD",
                "pricingSource": row["pricing_source"] or "unconfigured",
                "status": row["status"] or "ok",
                "promptChars": int(row["prompt_chars"] or 0),
                "isResync": bool(row["is_resync"]) if row["is_resync"] is not None else None,
                "createdAt": row["created_at"],
                "raw": raw,
            })
        return rows
    except Exception as e:
        logger.warning("Failed to fetch SQLite AI usage logs: %s", e)
        return []
    finally:
        if conn:
            conn.close()


def is_allowed_canvas_hostname(hostname: str) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host:
        return False
    return any(fnmatch(host, pattern) for pattern in CANVAS_ALLOWED_HOST_PATTERNS)


def normalize_canvas_base_url(base_url: str) -> str:
    """
    Strictly validate and normalize a Canvas base URL to prevent SSRF and token exfiltration.
    """
    raw = (base_url or "").strip()
    if not raw:
        raise ValueError("Base URL is empty.")

    # Convenience: allow users to input host without scheme.
    if "://" not in raw:
        raw = f"https://{raw}"

    parsed = urlparse(raw)
    scheme = (parsed.scheme or "").lower()
    if scheme != "https":
        raise ValueError("Base URL must use https.")
    if parsed.username or parsed.password:
        raise ValueError("Base URL must not include username/password.")
    if parsed.query or parsed.fragment:
        raise ValueError("Base URL must not include query or fragment.")
    if parsed.path and parsed.path not in ("", "/"):
        raise ValueError("Base URL must not include a path.")
    if parsed.port not in (None, 443):
        raise ValueError("Base URL port must be 443.")

    hostname = (parsed.hostname or "").strip().lower().rstrip(".")
    if not hostname:
        raise ValueError("Base URL must include a hostname.")

    # Disallow direct IPs so callers cannot target internal IP ranges.
    try:
        ip_literal = ipaddress.ip_address(hostname)
    except ValueError:
        ip_literal = None
    if ip_literal is not None:
        raise ValueError("Base URL hostname must be a domain name, not an IP address.")

    if not is_allowed_canvas_hostname(hostname):
        allowed = ", ".join(CANVAS_ALLOWED_HOST_PATTERNS)
        raise ValueError(
            f"Hostname '{hostname}' is not allowed. Allowed patterns: {allowed}"
        )

    # Resolve and reject non-public destinations to block internal network targeting.
    try:
        addr_info = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ValueError(f"Hostname '{hostname}' could not be resolved.") from exc

    resolved_ips = set()
    for entry in addr_info:
        sockaddr = entry[4]
        if not sockaddr:
            continue
        ip_text = sockaddr[0]
        try:
            resolved_ips.add(ipaddress.ip_address(ip_text))
        except ValueError:
            continue

    if not resolved_ips:
        raise ValueError(f"Hostname '{hostname}' did not resolve to a valid IP.")

    for ip_obj in resolved_ips:
        if not ip_obj.is_global:
            raise ValueError("Base URL resolves to a non-public IP, which is not allowed.")

    return f"https://{hostname}"


def resolve_canvas_credentials(user_id: str, payload: dict):
    """
    Resolve Canvas credentials for a request.
    In cloud mode we prefer server-stored credentials to avoid client-side override.
    If none are stored yet, fall back to the provided payload so the user can connect
    in-session (useful when credentials persistence is misconfigured).
    """
    payload = payload or {}
    payload_base_url = str(payload.get("base_url") or "").strip()
    payload_token = str(payload.get("token") or "").strip()

    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(user_id) or {}
        base_url = str(creds.get("api_url") or "").strip()
        token = str(creds.get("token") or creds.get("encrypted_token") or "").strip()

        if not base_url or not token:
            # Fallback for first-time connect and for deployments where persistence fails.
            base_url = payload_base_url
            token = payload_token
            if not base_url or not token:
                return None, None, "No saved Canvas credentials. Reconnect Canvas."
    else:
        base_url = payload_base_url
        token = payload_token

    if not base_url or not token:
        return None, None, "Missing base_url or token"

    try:
        normalized_base_url = normalize_canvas_base_url(base_url)
    except ValueError as exc:
        return None, None, f"Invalid base_url: {exc}"

    return normalized_base_url, token, None


def get_canvas_download_url(base_url: str, headers: dict, file_id: int) -> str:
    """Get reliable download URL for Canvas file bytes."""
    try:
        meta = requests.get(
            f"{base_url.rstrip('/')}/api/v1/files/{file_id}",
            headers=headers,
            allow_redirects=True,
            timeout=20
        )
        if meta.status_code == 200:
            data = meta.json()
            for key in ("download_url", "url"):
                u = data.get(key)
                if isinstance(u, str) and u.strip():
                    if "/download" in u:
                        return u
    except Exception:
        pass
    return f"{base_url.rstrip('/')}/files/{file_id}/download?download_frd=1"


def parse_canvas_link_header(link_header: str) -> dict:
    """
    Parse Canvas-style RFC5988 Link headers.
    Returns a dict like {"next": "https://...", "current": "..."}.
    """
    out = {}
    if not link_header:
        return out
    try:
        parts = [p.strip() for p in link_header.split(",") if p.strip()]
        for part in parts:
            m_url = re.search(r"<([^>]+)>", part)
            m_rel = re.search(r'rel=\"?([^\";]+)\"?', part)
            if not m_url or not m_rel:
                continue
            out[m_rel.group(1).strip()] = m_url.group(1).strip()
    except Exception:
        return {}
    return out


def canvas_get_paginated_list(url: str, headers: dict, params: dict = None, timeout: int = None, max_pages: int = 30):
    """
    Fetch a Canvas API endpoint that returns a JSON list and may be paginated.
    """
    results = []
    next_url = url
    page = 0
    next_params = dict(params or {})
    if "per_page" not in next_params:
        next_params["per_page"] = 100

    while next_url and page < max_pages:
        page += 1
        resp = requests.get(
            next_url,
            headers=headers,
            params=next_params if next_params else None,
            timeout=timeout or CANVAS_REQUEST_TIMEOUT_SECONDS,
        )
        if resp.status_code != 200:
            raise RuntimeError(f"Canvas API failed: {resp.status_code} for {next_url}")
        data = resp.json()
        if isinstance(data, list):
            results.extend(data)
        else:
            results.append(data)
        links = parse_canvas_link_header(resp.headers.get("Link"))
        next_url = links.get("next")
        next_params = None  # next_url already includes query

    return results


def extract_links_from_html(html, base_url, include_all_files: bool = False):
    """Extract Canvas file links (same-origin) plus Google Sheets/Docs.

    By default we only include "schedule-like" links to avoid downloading everything.
    Set include_all_files=True for syllabus/front-page bodies where file names may not
    contain schedule keywords (e.g., a syllabus PDF named "CourseOutline.pdf").
    """
    links = []
    if not html or not HAS_BS4:
        return links

    soup = BeautifulSoup(html, "html.parser")
    base_host = (urlparse(base_url).hostname or "").strip().lower().rstrip(".")

    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        text = (a.get_text(strip=True) or "").strip()

        if not href:
            continue

        if not href.startswith(("http://", "https://", "/")):
            href = urljoin(f"{base_url.rstrip('/')}/", href)
        elif href.startswith("/"):
            href = base_url.rstrip("/") + href

        parsed_href = urlparse(href)
        href_host = (parsed_href.hostname or "").strip().lower().rstrip(".")
        if parsed_href.scheme != "https" or not href_host:
            continue

        is_canvas_origin = href_host == base_host
        href_lower = href.lower()
        path_lower = (parsed_href.path or "").lower()

        is_google_doc = href_host in {"docs.google.com", "drive.google.com"} and "/document/" in path_lower
        is_google_sheet = href_host == "docs.google.com" and "/spreadsheets/" in path_lower
        is_canvas_file = False
        file_id = None

        m = re.search(r'/files/(\d+)', path_lower) if is_canvas_origin else None
        if m and is_canvas_origin:
            file_id = int(m.group(1))
            href = f"{base_url.rstrip('/')}/files/{file_id}/download?download_frd=1"
            is_canvas_file = True
        elif is_canvas_origin and is_file_url(href):
            is_canvas_file = True

        # Only allow:
        # 1) Canvas-hosted files on the same origin
        # 2) Google Docs/Sheets links
        if not (is_canvas_file or is_google_doc or is_google_sheet):
            continue

        fallback_name = unquote(href.split("?")[0].split("/")[-1]) if href else "Untitled"
        display_name = text or fallback_name
        display_lower = display_name.lower()
        url_lower = href.lower()
        filename_lower = fallback_name.lower()

        if not include_all_files:
            matches = (
                any(kw in display_lower for kw in SCHEDULE_KEYWORDS) or
                any(kw in url_lower for kw in SCHEDULE_KEYWORDS) or
                any(kw in filename_lower for kw in SCHEDULE_KEYWORDS) or
                is_google_doc or is_google_sheet
            )
            if not matches:
                continue

        links.append({
            "url": href,
            "text": display_name,
            "filename": fallback_name,
            "file_id": file_id,
            "is_file": is_canvas_file,
            "is_google_sheet": is_google_sheet,
            "is_google_doc": is_google_doc
        })

    return links


def fetch_google_sheet_as_text(url: str) -> str:
    """Fetch a Google Sheet and convert to text."""
    try:
        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
        if not match:
            print(f"   [WARN] Could not extract sheet ID from URL: {url}")
            return ""

        sheet_id = match.group(1)
        export_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"

        response = requests.get(export_url, timeout=30)

        if response.status_code != 200:
            print(f"   [WARN] Failed to fetch Google Sheet (status {response.status_code})")
            return ""

        import csv
        from io import StringIO

        csv_content = response.text
        reader = csv.reader(StringIO(csv_content))

        lines = []
        for row in reader:
            cells = [cell.strip() for cell in row if cell.strip()]
            if cells:
                lines.append(" | ".join(cells))

        return "\n".join(lines)

    except Exception as e:
        print(f"   [ERROR] Error fetching Google Sheet: {e}")
        return ""


def fetch_google_doc_as_text(url: str) -> str:
    """Fetch a Google Doc and convert to plain text."""
    try:
        match = re.search(r'/document/d/([a-zA-Z0-9-_]+)', url)
        if not match:
            print(f"   Could not extract document ID from URL: {url}")
            return ""

        doc_id = match.group(1)
        export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=txt"
        response = requests.get(export_url, timeout=30)

        if response.status_code != 200:
            print(f"   Failed to fetch Google Doc (status {response.status_code})")
            return ""

        return response.text or ""
    except Exception as e:
        print(f"   Error fetching Google Doc: {e}")
        return ""


def html_to_text(html):
    if not html:
        return ""
    if HAS_BS4:
        soup = BeautifulSoup(html, "html.parser")
        return soup.get_text(separator="\n", strip=True)
    text = re.sub(r"<[^>]+>", " ", html)
    return " ".join(text.split())


# =============================================================================
# HEALTH CHECK / AUTH TEST
# =============================================================================

@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "timestamp": now_iso()
    })


@app.route("/api/auth/me", methods=["GET"])
@limiter.limit("60/minute")
@require_auth
def get_current_user():
    """Get current authenticated user info"""
    return jsonify({
        "user_id": request.user_id,
        "email": getattr(request, 'user_email', None),
        "name": getattr(request, 'user_name', None)
    })


@app.route("/api/user/data", methods=["GET"])
@require_auth
def get_user_data():
    """Load user's cached courses and assignments from Firestore.
    Called on login to restore previous session data."""
    user_id = request.user_id
    include_assignments = (request.args.get("includeAssignments") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )
    
    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(user_id)
        active_credential_key = creds.get('canvas_credential_key') if creds else None

        # Only return data for the currently connected Canvas token.
        if not active_credential_key:
            return jsonify({
                "courses": [],
                "assignments": [],
                "cached": False
            })

        # Get all courses for this user/token scope
        courses = get_user_courses(user_id, active_credential_key)

        if not include_assignments:
            return jsonify({
                "courses": courses,
                "assignments": [],
                "cached": True,
                "canvas_credential_key": active_credential_key,
            })

        courses_by_id = {
            str(c.get('canvasCourseId') or c.get('canvasCourseIdStr') or c.get('id')): c
            for c in courses
        }

        # Fast path: fetch all assignments in a single query to avoid N+1 Firestore reads.
        all_assignments = get_user_assignments(user_id, active_credential_key)

        # Backfill assignment course metadata so course tags survive reloads.
        for a in all_assignments:
            course_id_str = str(a.get("courseId") or "").strip()
            if not course_id_str:
                continue
            course_info = courses_by_id.get(course_id_str, {})
            if not a.get("courseName"):
                a["courseName"] = course_info.get("courseName")
            if not a.get("courseCode"):
                a["courseCode"] = course_info.get("courseCode")
        
        return jsonify({
            "courses": courses,
            "assignments": all_assignments,
            "cached": True,
            "canvas_credential_key": active_credential_key,
        })
    else:
        # Local mode - return empty (no persistence)
        return jsonify({
            "courses": [],
            "assignments": [],
            "cached": False
        })


@app.route("/api/user/bootstrap", methods=["GET"])
@require_auth
def get_user_bootstrap():
    """
    Startup payload optimized for day-to-day app use.
    Returns credentials status, preferences, courses, and optional lite assignments
    in one authenticated request to reduce request fan-out on page load.
    """
    user_id = request.user_id
    include_assignments = (request.args.get("includeAssignments") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )

    if not USE_FIRESTORE:
        return jsonify({
            "has_credentials": False,
            "base_url": None,
            "canvas_credential_key": None,
            "courses": [],
            "assignments": [],
            "preferences": {
                "courseColors": {},
                "starredCourses": {},
                "syncEnabledCourses": {},
                "completedItems": {},
            },
            "cached": False,
        })

    user_record = get_user(user_id) or {}
    active_credential_key = str(user_record.get("canvasCredentialKey") or "").strip() or None
    raw_base_url = str(user_record.get("canvasApiUrl") or "").strip()
    safe_base_url = None
    if raw_base_url:
        try:
            safe_base_url = normalize_canvas_base_url(raw_base_url)
        except ValueError as exc:
            logger.warning("Stored Canvas base URL is invalid for user %s: %s", user_id, exc)
            safe_base_url = None

    has_credentials = bool(active_credential_key and safe_base_url)

    preferences = {
        "courseColors": user_record.get("courseColors") or {},
        "starredCourses": user_record.get("starredCourses") or {},
        "syncEnabledCourses": user_record.get("syncEnabledCourses") or {},
        "completedItems": user_record.get("completedItems") or {},
    }

    courses = []
    assignments = []

    if active_credential_key:
        courses = get_user_courses(user_id, active_credential_key)
        if include_assignments:
            assignments = get_user_assignments_lite(user_id, active_credential_key)

            # Backfill course metadata in the response only when needed.
            needs_backfill = any((not a.get("courseName")) or (not a.get("courseCode")) for a in assignments)
            if needs_backfill:
                courses_by_id = {
                    str(c.get('canvasCourseId') or c.get('canvasCourseIdStr') or c.get('id')): c
                    for c in courses
                }
                for a in assignments:
                    course_id_str = str(a.get("courseId") or "").strip()
                    if not course_id_str:
                        continue
                    course_info = courses_by_id.get(course_id_str, {})
                    if not a.get("courseName"):
                        a["courseName"] = course_info.get("courseName")
                    if not a.get("courseCode"):
                        a["courseCode"] = course_info.get("courseCode")

    return jsonify({
        "has_credentials": has_credentials,
        "base_url": safe_base_url,
        "canvas_credential_key": active_credential_key,
        "courses": courses,
        "assignments": assignments,
        "preferences": preferences,
        "cached": bool(active_credential_key),
    })


@app.route("/api/user/courses", methods=["GET"])
@require_auth
def get_user_courses_api():
    """
    Fast path for startup: return only cached courses (no assignments).

    The full /api/user/data endpoint can be slower for users with many assignments.
    """
    user_id = request.user_id

    if not USE_FIRESTORE:
        return jsonify({
            "courses": [],
            "cached": False,
        })

    creds = get_user_canvas_credentials(user_id)
    active_credential_key = creds.get('canvas_credential_key') if creds else None
    if not active_credential_key:
        return jsonify({
            "courses": [],
            "cached": False,
        })

    courses = get_user_courses(user_id, active_credential_key)
    return jsonify({
        "courses": courses,
        "cached": True,
        "canvas_credential_key": active_credential_key,
    })


@app.route("/api/user/assignments", methods=["GET"])
@require_auth
def get_user_assignments_api():
    """
    Return cached assignments for the currently connected Canvas credentials.

    This is designed to be called after /api/user/courses so the UI can render
    the course list immediately, then hydrate assignments in the background.
    """
    user_id = request.user_id

    if not USE_FIRESTORE:
        return jsonify({
            "assignments": [],
            "cached": False,
        })

    creds = get_user_canvas_credentials(user_id)
    active_credential_key = creds.get('canvas_credential_key') if creds else None
    if not active_credential_key:
        return jsonify({
            "assignments": [],
            "cached": False,
        })

    lite = (request.args.get("lite") or "1").strip().lower() not in ("0", "false", "no")
    assignments = (
        get_user_assignments_lite(user_id, active_credential_key)
        if lite
        else get_user_assignments(user_id, active_credential_key)
    )

    # Backfill course metadata only if needed (avoids an extra read on startup).
    needs_backfill = any((not a.get("courseName")) or (not a.get("courseCode")) for a in assignments)
    if needs_backfill:
        courses = get_user_courses(user_id, active_credential_key)
        courses_by_id = {
            str(c.get('canvasCourseId') or c.get('canvasCourseIdStr') or c.get('id')): c
            for c in courses
        }
        for a in assignments:
            course_id_str = str(a.get("courseId") or "").strip()
            if not course_id_str:
                continue
            course_info = courses_by_id.get(course_id_str, {})
            if not a.get("courseName"):
                a["courseName"] = course_info.get("courseName")
            if not a.get("courseCode"):
                a["courseCode"] = course_info.get("courseCode")

    return jsonify({
        "assignments": assignments,
        "cached": True,
        "canvas_credential_key": active_credential_key,
    })


@app.route("/api/ai/usage-logs", methods=["GET"])
@require_auth
def get_ai_usage_logs_api():
    """
    Return recent Gemini token/cost logs from backend storage.
    """
    user_id = request.user_id

    try:
        limit = int((request.args.get("limit") or "50").strip())
    except ValueError:
        limit = 50
    limit = max(1, min(limit, 200))

    course_id = (request.args.get("course_id") or "").strip() or None
    active_credential_key = None

    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(user_id)
        active_credential_key = creds.get("canvas_credential_key") if creds else None

        # Keep this scoped to the currently connected Canvas credentials.
        if not active_credential_key:
            return jsonify({
                "logs": [],
                "count": 0,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_tokens": 0,
                "total_estimated_cost_usd": 0.0,
                "canvas_credential_key": None,
            })

    logs = fetch_ai_usage_logs_for_user(
        user_id,
        limit=limit,
        course_id=course_id,
        canvas_credential_key=active_credential_key,
    )

    total_input_tokens = sum(int(item.get("inputTokens") or 0) for item in logs)
    total_output_tokens = sum(int(item.get("outputTokens") or 0) for item in logs)
    total_tokens = sum(int(item.get("totalTokens") or 0) for item in logs)
    total_estimated_cost = round(sum(float(item.get("estimatedCostUsd") or 0.0) for item in logs), 10)

    return jsonify({
        "logs": logs,
        "count": len(logs),
        "total_input_tokens": total_input_tokens,
        "total_output_tokens": total_output_tokens,
        "total_tokens": total_tokens,
        "total_estimated_cost_usd": total_estimated_cost,
        "canvas_credential_key": active_credential_key,
    })


@app.route("/api/cloud/cost-audit", methods=["GET"])
@require_auth
def get_cloud_cost_audit_api():
    """
    Return Cloud Run + Artifact Registry spend from BigQuery Billing Export.
    """
    if not ENABLE_CLOUD_COST_AUDIT_ENDPOINT:
        return jsonify({"error": "Cloud cost audit endpoint is disabled."}), 404

    # Deny by default: require explicit allowlist when endpoint is enabled.
    if not CLOUD_COST_ALLOWED_EMAILS:
        return jsonify({"error": "Cloud cost audit access is not configured. Set CLOUD_COST_ALLOWED_EMAILS."}), 403
    request_email = str(getattr(request, "user_email", "") or "").strip().lower()
    if request_email not in CLOUD_COST_ALLOWED_EMAILS:
        return jsonify({"error": "Not allowed to access cloud cost audit data."}), 403

    try:
        days = int((request.args.get("days") or "7").strip())
    except ValueError:
        return jsonify({"error": "days must be an integer."}), 400
    days = max(1, min(days, 120))

    granularity = str(request.args.get("granularity") or "day").strip().lower()
    if granularity not in {"hour", "day"}:
        return jsonify({"error": "granularity must be 'hour' or 'day'."}), 400

    try:
        limit = int((request.args.get("limit") or "300").strip())
    except ValueError:
        return jsonify({"error": "limit must be an integer."}), 400
    limit = max(10, min(limit, 2000))

    project_filter = (request.args.get("project_id") or "").strip() or None
    cloud_run_service = (request.args.get("cloud_run_service") or "").strip() or None
    artifact_repository = (request.args.get("artifact_repository") or "").strip() or None

    try:
        from cloud_cost_audit import (
            CostAuditConfigError,
            CostAuditQueryError,
            fetch_cloud_cost_snapshot,
        )
        payload = fetch_cloud_cost_snapshot(
            days=days,
            granularity=granularity,
            detail_limit=limit,
            project_filter=project_filter,
            cloud_run_service=cloud_run_service,
            artifact_repository=artifact_repository,
        )
        return jsonify(payload)
    except CostAuditConfigError:
        return jsonify({"error": "Cloud cost audit is not properly configured.", "code": "COST_AUDIT_CONFIG"}), 400
    except CostAuditQueryError:
        return jsonify({"error": "Cloud cost audit query failed.", "code": "COST_AUDIT_QUERY"}), 502
    except Exception as exc:
        logger.error("Unexpected cloud cost audit failure: %s", exc)
        return jsonify({"error": "Unexpected failure in cloud cost audit endpoint."}), 500


@app.route("/api/user/canvas-credentials", methods=["POST"])
@limiter.limit("10/minute")
@require_auth
def save_canvas_credentials():
    """Save Canvas credentials to Firestore for this user.
    Ties the Canvas token to the user's Google account."""
    payload = request.get_json(silent=True) or {}
    base_url_raw = str(payload.get("base_url") or "").strip()
    token = str(payload.get("token") or "").strip()
    
    if not base_url_raw or not token:
        return jsonify({"error": "Missing base_url or token"}), 400

    try:
        base_url = normalize_canvas_base_url(base_url_raw)
    except ValueError as exc:
        return jsonify({"error": f"Invalid base_url: {exc}"}), 400
    
    if USE_FIRESTORE:
        # Store in Firestore (token encryption handled in db layer).
        try:
            credential_key = update_user_canvas_credentials(request.user_id, base_url, token)
        except RuntimeError as exc:
            logger.error("Failed to store Canvas credentials securely: %s", exc)
            return jsonify({"error": "Server encryption is not configured"}), 500
        return jsonify({"success": True, "canvas_credential_key": credential_key})
    else:
        # Local mode - no persistence
        return jsonify({"success": True, "note": "Local mode, not persisted"})


@app.route("/api/user/canvas-credentials", methods=["GET"])
@require_auth
def get_canvas_credentials():
    """Get Canvas credentials from Firestore for this user."""
    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(request.user_id)
        if creds and creds.get('api_url'):
            try:
                safe_base_url = normalize_canvas_base_url(creds['api_url'])
            except ValueError as exc:
                logger.warning("Stored Canvas base URL is invalid for user %s: %s", request.user_id, exc)
                return jsonify({"has_credentials": False})
            return jsonify({
                "base_url": safe_base_url,
                "canvas_credential_key": creds.get('canvas_credential_key'),
                "has_credentials": True
            })
    return jsonify({"has_credentials": False})


@app.route("/api/user/preferences", methods=["GET"])
@require_auth
def get_user_preferences_api():
    """Get user UI preferences (course colors, starred courses, sync-enabled courses, completed items)."""
    if not USE_FIRESTORE:
        return jsonify({"courseColors": {}, "starredCourses": {}, "syncEnabledCourses": {}, "completedItems": {}})

    return jsonify(get_user_preferences(request.user_id))


@app.route("/api/user/preferences", methods=["PUT"])
@require_auth
def update_user_preferences_api():
    """Update user UI preferences (course colors, starred courses, sync-enabled courses, completed items)."""
    if not USE_FIRESTORE:
        return jsonify({"error": "Preferences are not available in local mode."}), 400

    payload = request.get_json(silent=True) or {}
    course_colors = payload.get("courseColors", None)
    starred_courses = payload.get("starredCourses", None)
    sync_enabled_courses = payload.get("syncEnabledCourses", None)
    completed_items = payload.get("completedItems", None)

    # Basic validation: ensure maps when provided
    if course_colors is not None and not isinstance(course_colors, dict):
        return jsonify({"error": "courseColors must be an object/map"}), 400
    if starred_courses is not None and not isinstance(starred_courses, dict):
        return jsonify({"error": "starredCourses must be an object/map"}), 400
    if sync_enabled_courses is not None and not isinstance(sync_enabled_courses, dict):
        return jsonify({"error": "syncEnabledCourses must be an object/map"}), 400
    if completed_items is not None and not isinstance(completed_items, dict):
        return jsonify({"error": "completedItems must be an object/map"}), 400

    updated = update_user_preferences(
        request.user_id,
        course_colors=course_colors,
        starred_courses=starred_courses,
        sync_enabled_courses=sync_enabled_courses,
        completed_items=completed_items,
    )
    return jsonify(updated)


# =============================================================================
# CANVAS PASSTHROUGH APIs
# =============================================================================

@app.route("/api/canvas/test", methods=["POST"])
@limiter.limit("30/minute")
@require_auth
def test_canvas():
    payload = request.get_json(silent=True) or {}
    base_url_raw = str(payload.get("base_url") or "").strip()
    token = str(payload.get("token") or "").strip()

    if not base_url_raw or not token:
        return jsonify({"valid": False, "error": "Missing base_url or token"}), 400

    try:
        base_url = normalize_canvas_base_url(base_url_raw)
    except ValueError as exc:
        return jsonify({"valid": False, "error": f"Invalid base_url: {exc}"}), 400

    try:
        r = requests.get(
            f"{base_url}/api/v1/courses",
            headers=canvas_headers(token),
            params={"per_page": 1},
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )
        return jsonify({
            "valid": r.status_code == 200,
            "status": r.status_code
        })
    except Exception as e:
        return jsonify({"valid": False, "error": str(e)}), 500


@app.route("/api/canvas/courses", methods=["POST"])
@require_auth
def canvas_courses():
    payload = request.get_json(silent=True) or {}
    user_id = request.user_id

    base_url, token, error = resolve_canvas_credentials(user_id, payload)
    if error:
        return jsonify({"error": error}), 400

    active_credential_key = build_canvas_credential_key(base_url, token) if USE_FIRESTORE else None
    cache_key = f"{user_id}:{active_credential_key}" if active_credential_key else None
    cached = _courses_cache_get(cache_key)
    if cached is not None:
        return jsonify(cached)

    # Canvas API supports filtering by enrollment_state to return "active" vs "completed" courses.
    # This is the most reliable way to match what Canvas considers current vs past, and it respects
    # term / course / section date overrides when used with include[]=concluded.
    def fetch_courses(enrollment_state: str):
        return requests.get(
            f"{base_url}/api/v1/courses",
            headers=canvas_headers(token),
            params={
                "per_page": 100,
                "include[]": ["term", "concluded"],
                "enrollment_state": enrollment_state,
            },
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )

    # Fetch in parallel. Canvas API calls dominate perceived "connect" latency.
    with ThreadPoolExecutor(max_workers=3) as executor:
        fut_active = executor.submit(fetch_courses, "active")
        fut_completed = executor.submit(fetch_courses, "completed")
        # Canvas docs list invited/pending under a combined value.
        fut_invited = executor.submit(fetch_courses, "invited_or_pending")

        active_res = fut_active.result()
        completed_res = fut_completed.result()
        invited_res = fut_invited.result()

    if invited_res.status_code == 400:
        # Older Canvas versions sometimes use "invited".
        invited_res = fetch_courses("invited")

    for r in (active_res, invited_res, completed_res):
        if r.status_code != 200:
            return jsonify({
                "error": "Failed to fetch courses from Canvas",
                "status": r.status_code,
                "details": r.text[:500] if getattr(r, "text", None) else None,
            }), 400

    courses_by_id = {}
    for c in (completed_res.json() or []):
        cid = str(c.get("id"))
        c["_app_is_currently_active"] = False
        c["_app_active_source"] = "enrollment_state:completed"
        courses_by_id[cid] = c

    for c in (active_res.json() or []):
        cid = str(c.get("id"))
        # include[]=concluded tells us if Canvas considers the course concluded (dates included).
        c["_app_is_currently_active"] = c.get("concluded") is not True
        c["_app_active_source"] = "enrollment_state:active" if c["_app_is_currently_active"] else "concluded"
        courses_by_id[cid] = c

    for c in (invited_res.json() or []):
        cid = str(c.get("id"))
        c["_app_is_currently_active"] = c.get("concluded") is not True
        c["_app_active_source"] = "enrollment_state:invited_or_pending" if c["_app_is_currently_active"] else "concluded"
        courses_by_id[cid] = c

    courses = list(courses_by_id.values())

    if USE_FIRESTORE:
        # Get AI overrides from Firestore
        user_courses = {
            str(c.get('canvasCourseId') or c.get('canvasCourseIdStr') or c.get('id')): c
            for c in get_user_courses(user_id, active_credential_key)
        }
        
        to_save = []
        for c in courses:
            cid = str(c.get("id"))
            stored_course = user_courses.get(cid)

            # Use stored course code if available
            if stored_course and stored_course.get('courseCode'):
                effective_course_code = stored_course['courseCode']
            else:
                # Try to extract from Canvas data
                raw_code = c.get("course_code") or ""
                sis_code = c.get("sis_course_id") or ""
                name = c.get("name") or ""
                
                def find_dept_num(s: str):
                    m = re.search(r"\b([A-Za-z]{2,6})\s*[- ]?\s*(\d{3,4})\b", s)
                    return f"{m.group(1).upper()} {m.group(2)}" if m else None
                
                code = find_dept_num(raw_code) or find_dept_num(sis_code) or find_dept_num(name)
                effective_course_code = code or raw_code or extract_course_code_fallback(name)

            c["course_code"] = effective_course_code

            # Save resolved course metadata to Firestore after course_code is finalized.
            to_save.append({
                'canvasCourseId': c.get("id"),
                'name': c.get("name"),
                'course_code': effective_course_code,
                'metadata': {
                    'isCurrentlyActive': c.get('_app_is_currently_active'),
                    'activeSource': c.get('_app_active_source'),
                },
            })

        # Batch writes to avoid 1 network RTT per course (big latency win on reload).
        save_courses_batch(user_id, to_save, active_credential_key)
    else:
        # Local mode: Use SQLite
        conn = get_db()
        try:
            metadata = {row["course_id"]: row["course_code"] for row in
                        conn.execute("SELECT course_id, course_code FROM course_metadata").fetchall()}
        except:
            metadata = {}
        conn.close()

        for c in courses:
            cid = str(c.get("id"))
            if cid in metadata:
                c["course_code"] = metadata[cid]
            else:
                raw_code = c.get("course_code") or ""
                sis_code = c.get("sis_course_id") or ""
                name = c.get("name") or ""

                def find_dept_num(s: str):
                    m = re.search(r"\b([A-Za-z]{2,6})\s*[- ]?\s*(\d{3,4})\b", s)
                    return f"{m.group(1).upper()} {m.group(2)}" if m else None

                code = find_dept_num(raw_code) or find_dept_num(sis_code) or find_dept_num(name)
                c["course_code"] = code or raw_code or name

    _courses_cache_set(cache_key, courses)
    return jsonify(courses)


# =============================================================================
# ANNOUNCEMENTS
# =============================================================================

@app.route("/api/sync_announcements", methods=["POST"])
@require_auth
def sync_announcements():
    payload = request.get_json(silent=True) or {}
    course_ids = payload.get("course_ids") or []
    user_id = request.user_id

    if not isinstance(course_ids, list) or not course_ids:
        return jsonify({"error": "Missing course_ids"}), 400

    base_url, token, error = resolve_canvas_credentials(user_id, payload)
    if error:
        return jsonify({"error": error}), 400

    active_credential_key = build_canvas_credential_key(base_url, token) if USE_FIRESTORE else None

    params = []
    for cid in course_ids:
        params.append(("context_codes[]", f"course_{cid}"))

    r = requests.get(
        f"{base_url}/api/v1/announcements",
        headers=canvas_headers(token),
        params=params,
        timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
    )

    if r.status_code != 200:
        return jsonify({
            "error": "Failed to fetch announcements",
            "status": r.status_code,
        }), 400

    announcements = r.json()
    
    if USE_FIRESTORE:
        for a in announcements:
            context_id = a.get("context_id")
            if not context_id and "context_code" in a:
                context_code = a.get("context_code", "")
                if context_code.startswith("course_"):
                    context_id = context_code.split("_", 1)[1]

            if not context_id:
                continue

            save_announcement(user_id, {
                'canvas_announcement_id': a.get("id"),
                'course_id': str(context_id),
                'title': a.get("title"),
                'message': a.get("message"),
                'posted_at': a.get("created_at") or a.get("posted_at"),
                'raw_json': json.dumps(a)
            }, active_credential_key)
    else:
        # Local mode: SQLite
        conn = get_db()
        cur = conn.cursor()

        for a in announcements:
            context_id = a.get("context_id")
            if not context_id and "context_code" in a:
                context_code = a.get("context_code", "")
                if context_code.startswith("course_"):
                    context_id = context_code.split("_", 1)[1]

            if not context_id:
                continue

            cur.execute("""
                INSERT OR IGNORE INTO canvas_announcements (
                    canvas_announcement_id, course_id, title, message, posted_at, raw_json
                ) VALUES (?, ?, ?, ?, ?, ?)
            """, (
                a.get("id"),
                str(context_id),
                a.get("title"),
                a.get("message"),
                a.get("created_at") or a.get("posted_at"),
                json.dumps(a)
            ))

        conn.commit()
        conn.close()

    return jsonify({"inserted": len(announcements)})


def get_all_announcements(course_id, user_id=None, canvas_credential_key=None):
    if USE_FIRESTORE and user_id:
        announcements = get_course_announcements(user_id, course_id, canvas_credential_key)
        return [{
            'canvas_announcement_id': a.get('canvasAnnouncementId'),
            'title': a.get('title'),
            'message': a.get('message'),
            'posted_at': a.get('postedAt')
        } for a in announcements]
    else:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT canvas_announcement_id, title, message, posted_at
            FROM canvas_announcements
            WHERE course_id = ?
            ORDER BY datetime(posted_at) ASC
        """, (str(course_id),))
        rows = cur.fetchall()
        conn.close()
        return [dict(r) for r in rows]


# =============================================================================
# ASSIGNMENTS SYNC
# =============================================================================

@app.route("/api/sync_assignments", methods=["POST"])
@require_auth
def sync_assignments():
    payload = request.get_json(silent=True) or {}
    course_id = str(payload.get("course_id") or "").strip()
    user_id = request.user_id

    base_url, token, error = resolve_canvas_credentials(user_id, payload)
    if error:
        return jsonify({"error": error}), 400

    if not course_id:
        return jsonify({"error": "Missing course_id"}), 400

    active_credential_key = build_canvas_credential_key(base_url, token) if USE_FIRESTORE else None

    try:
        assignments = canvas_get_paginated_list(
            f"{base_url}/api/v1/courses/{course_id}/assignments",
            headers=canvas_headers(token),
            params={"per_page": 100},
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )
    except Exception as e:
        logger.warning("Canvas API request failed: %s", e)
        return jsonify({"error": "Error communicating with Canvas API."}), 500
    now = now_iso()

    if USE_FIRESTORE:
        # Get course metadata for storing with assignments
        course_info = get_course(user_id, course_id, active_credential_key)
        course_name = course_info.get('courseName') if course_info else None
        course_code = course_info.get('courseCode') if course_info else None
        if not course_code:
            course_code = extract_course_code_fallback(course_name or "")
            if course_code and course_info:
                update_course_metadata(user_id, course_id, course_code, active_credential_key)
        
        for a in assignments:
            canvas_assignment_id = a.get("id")
            name = a.get("name") or ""
            description = a.get("description") or ""
            due_at = a.get("due_at")

            existing = get_assignment_by_canvas_id(
                user_id, course_id, canvas_assignment_id, active_credential_key
            )
            
            # Never overwrite a real Canvas due_at with a stale/AI-normalized value.
            # AI is only meant to fill in missing dates (Canvas due_at is the source of truth when present).
            if due_at:
                normalized_due = due_at
            else:
                normalized_due = existing.get('normalizedDueAt') if existing else None

            assignment_data = {
                'course_id': course_id,
                'canvas_assignment_id': canvas_assignment_id,
                'name': name,
                'description': description,
                'original_due_at': due_at,
                'normalized_due_at': normalized_due,
                'source_of_truth': 'Canvas',
                'status': 'OK' if due_at else 'MISSING_DUE_DATE',
                'category': existing.get('category', 'PENDING') if existing else 'PENDING',
                'deliverable': 1,
                'raw_canvas_json': json.dumps(a, ensure_ascii=False),
                'course_name': course_name,
                'course_code': course_code,
            }
            
            save_assignment(user_id, course_id, assignment_data, active_credential_key)

        # Fetch and return assignments
        all_assignments = get_course_assignments(user_id, course_id, active_credential_key)
        result = []
        for row in all_assignments:
            if row.get('category') == 'PLACEHOLDER':
                continue
            result.append({
                "cid": row.get("canvasAssignmentId"),
                "nam": row.get("name"),
                "des": row.get("description"),
                "due": row.get("normalizedDueAt") or row.get("originalDueAt"),
                "st": row.get("status"),
                "cat": row.get("category"),
                "dk": row.get("discoveredKey"),
            })

        return jsonify({"crs": course_id, "a": result})
    
    else:
        # Local mode: SQLite
        conn = get_db()
        cur = conn.cursor()

        for a in assignments:
            canvas_assignment_id = a.get("id")
            name = a.get("name") or ""
            description = a.get("description") or ""
            due_at = a.get("due_at")

            category = "PENDING"
            deliverable = 1
            status = "OK" if due_at else "MISSING_DUE_DATE"
            raw_json_str = json.dumps(a, ensure_ascii=False)

            cur.execute("""
                SELECT id, normalized_due_at, status
                FROM assignments_normalized
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (course_id, canvas_assignment_id))
            row = cur.fetchone()

            if row is None:
                cur.execute("""
                    INSERT INTO assignments_normalized (
                        course_id, canvas_assignment_id, name, description,
                        original_due_at, normalized_due_at, source_of_truth,
                        confidence, status, raw_canvas_json, category,
                        deliverable, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    course_id, canvas_assignment_id, name, description,
                    due_at, due_at, "Canvas", None, status, raw_json_str,
                    category, deliverable, now, now,
                ))
            else:
                existing_normalized = row["normalized_due_at"]
                existing_status = row["status"] or status
                normalized_due = existing_normalized if existing_normalized is not None else due_at

                cur.execute("""
                    UPDATE assignments_normalized
                    SET name = ?, description = ?, original_due_at = ?,
                        normalized_due_at = ?, status = ?, raw_canvas_json = ?,
                        updated_at = ?
                    WHERE course_id = ? AND canvas_assignment_id = ?
                """, (
                    name, description, due_at, normalized_due,
                    existing_status, raw_json_str, now,
                    course_id, canvas_assignment_id,
                ))

        conn.commit()
        conn.close()

        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT canvas_assignment_id, name, description, original_due_at,
                   normalized_due_at, status, category
            FROM assignments_normalized
            WHERE course_id = ? AND category != 'PLACEHOLDER'
            ORDER BY datetime(normalized_due_at) IS NULL, normalized_due_at
        """, (course_id,))

        rows = cur.fetchall()
        conn.close()

        result = []
        for row in rows:
            result.append({
                "cid": row["canvas_assignment_id"],
                "nam": row["name"],
                "des": row["description"],
                "due": row["normalized_due_at"] if row["normalized_due_at"] else row["original_due_at"],
                "st": row["status"],
                "cat": row["category"],
                "dk": None,
            })

        return jsonify({"crs": course_id, "a": result})


@app.route("/api/assignments/refresh-completion", methods=["POST"])
@require_auth
def refresh_canvas_assignment_completion():
    """
    Lightweight reload watcher:
    - Pull Canvas assignment submission states
    - Return canvas-backed item IDs that should be auto-checked as completed
    """
    payload = request.get_json(silent=True) or {}
    user_id = request.user_id

    base_url, token, error = resolve_canvas_credentials(user_id, payload)
    if error:
        return jsonify({"error": error}), 400

    active_credential_key = build_canvas_credential_key(base_url, token) if USE_FIRESTORE else None

    raw_course_ids = payload.get("course_ids")
    course_ids = []
    if isinstance(raw_course_ids, list):
        for value in raw_course_ids:
            cid = str(value or "").strip()
            if cid:
                course_ids.append(cid)
    course_ids = list(dict.fromkeys(course_ids))

    # If caller doesn't pass course_ids, fall back to all known courses for this user scope.
    if not course_ids:
        if USE_FIRESTORE:
            known_courses = get_user_courses(user_id, active_credential_key)
            for c in known_courses:
                cid = str(c.get("canvasCourseIdStr") or c.get("canvasCourseId") or c.get("id") or "").strip()
                if cid:
                    course_ids.append(cid)
        else:
            conn = get_db()
            cur = conn.cursor()
            cur.execute("""
                SELECT DISTINCT course_id
                FROM assignments_normalized
                WHERE canvas_assignment_id IS NOT NULL
            """)
            course_ids = [str(r["course_id"]) for r in cur.fetchall() if r["course_id"]]
            conn.close()
        course_ids = list(dict.fromkeys(course_ids))

    if not course_ids:
        return jsonify({
            "course_count": 0,
            "inspected_count": 0,
            "completed_count": 0,
            "inspected_item_ids": [],
            "completed_item_ids": [],
        }), 200

    inspected_item_ids = set()
    completed_item_ids = set()
    errors = []

    for course_id in course_ids:
        try:
            assignments = canvas_get_paginated_list(
                f"{base_url}/api/v1/courses/{course_id}/assignments",
                headers=canvas_headers(token),
                params={"per_page": 100, "include[]": "submission"},
                timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
            )
        except Exception as e:
            errors.append({"course_id": course_id, "error": str(e)})
            continue

        for a in assignments:
            canvas_assignment_id = a.get("id")
            if not canvas_assignment_id:
                continue
            item_id = f"{str(course_id)}-{str(canvas_assignment_id)}"
            inspected_item_ids.add(item_id)
            if canvas_assignment_is_completed(a):
                completed_item_ids.add(item_id)

    response = {
        "course_count": len(course_ids),
        "inspected_count": len(inspected_item_ids),
        "completed_count": len(completed_item_ids),
        "inspected_item_ids": sorted(inspected_item_ids),
        "completed_item_ids": sorted(completed_item_ids),
    }
    if errors:
        response["errors"] = errors[:20]

    return jsonify(response), 200


# =============================================================================
# READING ITEMS
# =============================================================================

@app.route("/api/reading_items/<course_id>", methods=["GET"])
@require_auth
def reading_items(course_id):
    user_id = request.user_id
    try:
        course_id = normalize_canvas_course_id(str(course_id or "").strip())
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400

    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(user_id)
        active_credential_key = creds.get('canvas_credential_key') if creds else None
        items = get_reading_items(user_id, course_id, active_credential_key)
        rows = [{"nam": i['name'], "des": i.get('details'), "due": i.get('dueAt')} for i in items]
        return jsonify(rows)
    else:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT name, description as details, normalized_due_at as due_at
            FROM assignments_normalized
            WHERE course_id = ? 
              AND (category IN ('LECTURE', 'READING', 'ATTENDANCE') OR deliverable = 0)
              AND category != 'PLACEHOLDER'
            ORDER BY datetime(normalized_due_at) IS NULL, normalized_due_at
        """, (str(course_id),))

        rows = []
        for r in cur.fetchall():
            rows.append({
                "nam": r["name"],
                "des": r["details"],
                "due": r["due_at"],
            })

        conn.close()
        return jsonify(rows)


# =============================================================================
# COURSE MATERIALS SYNC
# =============================================================================

@app.route("/api/sync_course_materials", methods=["POST"])
@require_auth
def sync_course_materials():
    payload = request.get_json(silent=True) or {}
    course_id = str(payload.get("course_id") or "").strip()
    user_id = request.user_id

    base_url, token, error = resolve_canvas_credentials(user_id, payload)
    if error:
        return jsonify({"error": error}), 400

    if not course_id:
        return jsonify({"error": "Missing course_id"}), 400

    try:
        course_id = normalize_canvas_course_id(course_id)
    except ValueError as exc:
        return jsonify({"error": f"Invalid course_id: {exc}"}), 400

    active_credential_key = build_canvas_credential_key(base_url, token) if USE_FIRESTORE else None

    if USE_FIRESTORE:
        rate_limit = consume_hourly_rate_limit(
            user_id=user_id,
            limit_key="course_sync",
            limit_per_hour=COURSE_SYNC_RATE_LIMIT_PER_HOUR,
        )
        if not rate_limit.get("allowed"):
            response = jsonify({
                "error": "Rate limit exceeded for course syncs.",
                "limit": rate_limit.get("limit"),
                "count": rate_limit.get("count"),
                "retry_after_seconds": rate_limit.get("retry_after_seconds"),
                "window_start": rate_limit.get("window_start"),
                "window_end": rate_limit.get("window_end"),
            })
            response.status_code = 429
            response.headers["Retry-After"] = str(rate_limit.get("retry_after_seconds", 60))
            return response

    headers = canvas_headers(token)
    course_base, schedule_dir = make_course_storage_dir(
        course_id,
        user_id=user_id if USE_FIRESTORE else None,
        canvas_credential_key=active_credential_key if USE_FIRESTORE else None,
    )

    extracted_materials = []
    files_to_download = []

    def dedupe_download_targets(download_targets: list[dict]) -> list[dict]:
        """
        Remove duplicate download entries so we do not fetch/extract the same file
        multiple times under different sources.
        """
        deduped = []
        seen_keys = set()

        for target in download_targets or []:
            if not isinstance(target, dict):
                continue

            raw_file_id = target.get("file_id")
            file_id_token = str(raw_file_id).strip() if raw_file_id is not None else ""
            url_token = str(target.get("url") or "").strip().lower()
            display_token = str(target.get("display_name") or "").strip().lower()

            if file_id_token:
                dedupe_key = f"id:{file_id_token}"
            elif url_token:
                dedupe_key = f"url:{url_token}"
            elif display_token:
                dedupe_key = f"display:{display_token}"
            else:
                dedupe_key = f"raw:{hashlib.md5(json.dumps(target, sort_keys=True).encode('utf-8')).hexdigest()[:16]}"

            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)
            deduped.append(target)

        return deduped
    
    # Check if this is a resync by looking for existing files
    is_resync = False
    previous_files = []
    sync_version = 1
    file_types_to_version = ["schedule", "syllabus", "front_page", "modules"]
    
    if USE_FIRESTORE:
        sync_version = get_course_sync_version(user_id, course_id, active_credential_key)
        existing_files_count = 0
        for ft in file_types_to_version:
            try:
                existing_files_count += len(get_course_file_texts(user_id, course_id, ft, active_credential_key))
            except Exception:
                pass
        is_resync = existing_files_count > 0 and sync_version > 0
        
        if is_resync:
            # Archive previous files instead of deleting
            previous_files = []
            for ft in file_types_to_version:
                previous_files.extend(archive_course_file_texts(user_id, course_id, ft, active_credential_key))
            sync_version = increment_course_sync_version(user_id, course_id, active_credential_key)
            print(f"[RESYNC] Archived {len(previous_files)} previous files (sync v{sync_version})")
        else:
            sync_version = increment_course_sync_version(user_id, course_id, active_credential_key)

    print(f"\n{'=' * 60}")
    print(f"[SYNC] {'RE' if is_resync else ''}SYNCING COURSE MATERIALS: {course_id} (v{sync_version})")
    print(f"{'=' * 60}\n")

    # STEP 1: Fetch Front Page
    print("[SYNC 1/6] Fetching front page...")
    try:
        front_page_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}/front_page",
            headers=headers,
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )

        if front_page_response.status_code == 200:
            page_data = front_page_response.json()
            body_html = page_data.get("body") or ""
            title = page_data.get("title") or "Front Page"

            if body_html:
                text = html_to_text(body_html)
                if text and len(text.strip()) > 50:
                    extracted_materials.append({
                        "source_type": "canvas_page",
                        "name": f"Canvas Page: {title}",
                        "file_type": "front_page",
                        "file_id": "front_page",
                        "text": text,
                        "metadata": {"page_id": page_data.get("page_id"), "source": "front_page"}
                    })
                    print(f"   [OK] Extracted front page: {title} ({len(text)} chars)")

                links = extract_links_from_html(body_html, base_url)
                for link in links:
                    if link['is_file']:
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "front_page_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })
        else:
            print(f"   [WARN] Front page not available (status {front_page_response.status_code})")
    except Exception as e:
        print(f"   [ERROR] Error fetching front page: {e}")

    # STEP 2: Fetch Syllabus Body
    print("\n[SYNC 2/6] Fetching syllabus from course...")
    try:
        syllabus_response = requests.get(
            f"{base_url}/api/v1/courses/{course_id}",
            headers=headers,
            params={"include[]": "syllabus_body"},
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )

        if syllabus_response.status_code == 200:
            course_data = syllabus_response.json()
            syllabus_html = course_data.get("syllabus_body") or ""

            if syllabus_html:
                links = extract_links_from_html(syllabus_html, base_url, include_all_files=True)
                for link in links:
                    if link.get('is_google_sheet') or link.get('is_google_doc'):
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "syllabus_google_link",
                            "file_id": f"google_{abs(hash(link['url']))}",
                            "is_google_sheet": link.get('is_google_sheet', False),
                            "is_google_doc": link.get('is_google_doc', False),
                        })
                    elif link['is_file']:
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "syllabus_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })

                text = html_to_text(syllabus_html)
                if text and len(text.strip()) > 50:
                    extracted_materials.append({
                        "source_type": "canvas_page",
                        "name": "Canvas Page: Syllabus",
                        "file_type": "syllabus",
                        "file_id": "syllabus_body",
                        "text": text,
                        "metadata": {"source": "syllabus_body"}
                    })
                    print(f"   [OK] Extracted syllabus body ({len(text)} chars)")
        else:
            print(f"   [WARN] Syllabus fetch failed (status {syllabus_response.status_code})")
    except Exception as e:
        print(f"   [ERROR] Error fetching syllabus: {e}")

    # STEP 3: List Files from Files Section
    print("\n[SYNC 3/6] Listing files from Files section...")
    try:
        # Single paginated request path (avoid duplicate first-page fetches).
        all_files = canvas_get_paginated_list(
            f"{base_url}/api/v1/courses/{course_id}/files",
            headers=headers,
            params={"per_page": 100},
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )
        schedule_files = [f for f in all_files if is_schedule_file(f.get("display_name") or f.get("filename"))]

        print(f"   [OK] Found {len(schedule_files)} schedule files out of {len(all_files)} total")

        for f in schedule_files:
            fid = f.get("id")
            display = f.get("display_name") or f.get("filename") or f"file_{fid}"
            if not fid:
                continue

            if not any(str(x.get("file_id")) == str(fid) for x in files_to_download):
                files_to_download.append({
                    "file_id": int(fid),
                    "display_name": display,
                    "url": None,
                    "source": "files_section"
                })
    except RuntimeError as e:
        if "Canvas API failed: 403" in str(e):
            print("   [WARN] Files section forbidden (403)")
        else:
            print(f"   [WARN] Files section fetch failed: {e}")
    except Exception as e:
        print(f"   [ERROR] Error listing files: {e}")

    # STEP 4: List Files from Modules (abbreviated for brevity)
    print("\n[SYNC 4/6] Scanning modules...")
    try:
        try:
            max_module_pages = int(os.getenv("MAX_MODULE_PAGES_TO_FETCH", "20"))
        except (TypeError, ValueError):
            max_module_pages = 20
        if max_module_pages < 0:
            max_module_pages = 0

        # Single paginated request path (avoid duplicate first-page fetches).
        modules = canvas_get_paginated_list(
            f"{base_url}/api/v1/courses/{course_id}/modules",
            headers=headers,
            params={"include[]": "items", "per_page": 100},
            timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
        )

        module_index_lines = []
        page_candidates = []
        module_file_count = 0

        for module in modules:
            module_name = module.get("name", "Unnamed Module")
            items = module.get("items", []) or []

            module_index_lines.append(f"MODULE: {module_name}")

            for item in items:
                item_type = item.get("type") or "Unknown"
                title = item.get("title") or item.get("name") or "Untitled"
                module_index_lines.append(f"- {item_type}: {title}")

                if item_type == "File":
                    file_id = item.get("content_id")
                    display_name = title
                    if file_id and is_schedule_file(display_name):
                        if not any(str(f.get("file_id")) == str(file_id) for f in files_to_download):
                            files_to_download.append({
                                "file_id": int(file_id),
                                "display_name": display_name,
                                "url": None,
                                "source": "module_file"
                            })
                            module_file_count += 1

                elif item_type == "Page":
                    page_url = item.get("page_url")
                    if page_url:
                        page_candidates.append({
                            "page_url": page_url,
                            "title": title,
                            "module_name": module_name
                        })

        # Store a lightweight modules index so resyncs can "discover enough" even if pages aren't fetched.
        module_index_text = "\n".join(module_index_lines).strip()
        if module_index_text and len(module_index_text) > 200:
            extracted_materials.append({
                "source_type": "modules_index",
                "name": "Modules Index",
                "file_type": "modules",
                "file_id": "modules_index",
                "text": module_index_text,
                "metadata": {"source": "modules_index"}
            })

        def is_priority_page(title: str) -> bool:
            t = (title or "").lower()
            return (
                any(kw in t for kw in SCHEDULE_KEYWORDS) or
                ("due" in t) or
                ("week" in t) or
                ("deadlin" in t)
            )

        page_candidates.sort(key=lambda x: (0 if is_priority_page(x.get("title")) else 1, (x.get("title") or "").lower()))

        fetched_pages = 0
        for cand in page_candidates:
            if fetched_pages >= max_module_pages:
                break

            page_url = cand.get("page_url")
            title = cand.get("title") or page_url
            if not page_url:
                continue

            try:
                page_response = requests.get(
                    f"{base_url}/api/v1/courses/{course_id}/pages/{page_url}",
                    headers=headers,
                    timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
                )

                if page_response.status_code != 200:
                    continue

                page_data = page_response.json() or {}
                body_html = page_data.get("body") or ""
                if not body_html:
                    continue

                text = html_to_text(body_html)
                if text and len(text.strip()) > 50:
                    extracted_materials.append({
                        "source_type": "canvas_page",
                        "name": f"Module Page: {title}",
                        "file_type": "modules",
                        "file_id": f"module_page_{page_url}",
                        "text": text,
                        "metadata": {"page_url": page_url, "source": "module_page"}
                    })

                links = extract_links_from_html(body_html, base_url)
                for link in links:
                    if link.get('is_google_sheet') or link.get('is_google_doc'):
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "module_page_google_link",
                            "file_id": f"google_{abs(hash(link['url']))}",
                            "is_google_sheet": link.get('is_google_sheet', False),
                            "is_google_doc": link.get('is_google_doc', False),
                        })
                    elif link.get('is_file'):
                        files_to_download.append({
                            "url": link['url'],
                            "display_name": link['text'],
                            "source": "module_page_link",
                            "file_id": link.get("file_id") or f"link_{hash(link['url'])}"
                        })

                fetched_pages += 1
            except Exception:
                continue

        print(f"   [OK] Module scan queued {module_file_count} schedule files and fetched {fetched_pages} pages")
    except RuntimeError as e:
        if "Canvas API failed: 403" in str(e):
            print("   [WARN] Modules section forbidden (403)")
        else:
            print(f"   [WARN] Modules fetch failed: {e}")
    except Exception as e:
        print(f"   [ERROR] Error scanning modules: {e}")

    original_download_target_count = len(files_to_download)
    files_to_download = dedupe_download_targets(files_to_download)
    if len(files_to_download) < original_download_target_count:
        print(
            f"   [DEDUPE] Reduced duplicate download targets from "
            f"{original_download_target_count} to {len(files_to_download)}"
        )

    # STEP 5: Download All Collected Files
    print(f"\n[SYNC 5/6] Downloading {len(files_to_download)} schedule files...")

    for file_info in files_to_download:
        file_id = file_info.get("file_id", f"unknown_{hash(file_info.get('url', ''))}")
        display_name = file_info.get("display_name") or str(file_id)
        url = file_info.get("url")
        is_google_sheet = file_info.get("is_google_sheet", False)
        is_google_doc = file_info.get("is_google_doc", False)

        if is_google_sheet:
            print(f"   [INFO] Fetching Google Sheet: {display_name}")
            text = fetch_google_sheet_as_text(url)
            if text and len(text.strip()) > 50:
                extracted_materials.append({
                    "source_type": "google_sheet",
                    "name": f"Google Sheet: {display_name}",
                    "file_type": "schedule",
                    "file_id": str(file_id),
                    "text": text,
                    "metadata": {"url": url}
                })
            continue

        if is_google_doc:
            print(f"   Fetching Google Doc: {display_name}")
            text = fetch_google_doc_as_text(url)
            if text and len(text.strip()) > 50:
                extracted_materials.append({
                    "source_type": "google_doc",
                    "name": f"Google Doc: {display_name}",
                    "file_type": "schedule",
                    "file_id": str(file_id),
                    "text": text,
                    "metadata": {"url": url}
                })
            continue

        if isinstance(file_id, int) and not url:
            url = get_canvas_download_url(base_url, headers, file_id)

        safe_name = display_name.replace("/", "_").replace("\\", "_").split("?")[0]
        local_filename = f"{file_id}_{safe_name}"
        local_path = os.path.join(schedule_dir, local_filename)

        if not url:
            continue

        if not is_canvas_origin_url(url, base_url):
            print(f"   Skipping non-Canvas file URL for safety: {display_name}")
            continue

        if not os.path.exists(local_path):
            try:
                resp = requests.get(
                    url,
                    headers=headers,
                    stream=True,
                    allow_redirects=True,
                    timeout=CANVAS_REQUEST_TIMEOUT_SECONDS,
                )
                if resp.status_code == 200:
                    with open(local_path, "wb") as out:
                        for chunk in resp.iter_content(chunk_size=8192):
                            if chunk:
                                out.write(chunk)
                    print(f"   [OK] Downloaded: {display_name}")
                else:
                    continue
            except Exception as e:
                print(f"   [ERROR] Error downloading {display_name}: {e}")
                continue

        try:
            text = extract_text_safely(local_path)
            if text and len(text.strip()) > 50:
                extracted_materials.append({
                    "source_type": "file",
                    "name": display_name,
                    "file_type": "schedule",
                    "file_id": str(file_id),
                    "text": text,
                    "metadata": {"file_id": file_id if isinstance(file_id, int) else None, "path": local_path}
                })
        except Exception as e:
            print(f"   [ERROR] Extraction failed for {display_name}: {e}")

    deduped_materials = []
    seen_material_keys = set()
    for material in extracted_materials:
        if not isinstance(material, dict):
            continue
        text = str(material.get("text") or "")
        text_hash = hashlib.md5(text.encode("utf-8", errors="ignore")).hexdigest()[:16] if text else ""
        material_key = (
            str(material.get("file_type") or ""),
            str(material.get("file_id") or material.get("name") or ""),
            text_hash,
        )
        if material_key in seen_material_keys:
            continue
        seen_material_keys.add(material_key)
        deduped_materials.append(material)
    if len(deduped_materials) < len(extracted_materials):
        print(
            f"   [DEDUPE] Reduced duplicate extracted materials from "
            f"{len(extracted_materials)} to {len(deduped_materials)}"
        )
    extracted_materials = deduped_materials

    # STEP 6: Store in Database
    print(f"\n[SYNC 6/6] Storing {len(extracted_materials)} materials in database...")

    if USE_FIRESTORE:
        # Use versioned save (previous files already archived above)
        for material in extracted_materials:
            save_course_file_text_versioned(user_id, course_id, {
                'file_id': material.get("file_id") or material.get("name"),
                'canvas_file_id': (material.get("metadata") or {}).get("file_id"),
                'file_type': material.get('file_type', 'schedule'),
                'file_name': material["name"],
                'storage_path': material["metadata"].get("path", f"canvas_page:{material['metadata'].get('source', 'unknown')}"),
                'extracted_text': material["text"]
            }, sync_version, active_credential_key)
        
        # Cleanup old versions (keep last 2)
        if is_resync:
            cleanup_old_file_versions(user_id, course_id, keep_versions=2, canvas_credential_key=active_credential_key)
    else:
        conn = get_db()
        cur = conn.cursor()

        # Local resync: archive existing materials (all relevant file types)
        cur.execute("""
            SELECT id, file_name, extracted_text
            FROM course_file_text
            WHERE course_id = ? AND file_type IN ('schedule', 'syllabus', 'front_page', 'modules')
              AND (is_previous IS NULL OR is_previous = 0)
        """, (course_id,))
        existing_files = [dict(r) for r in cur.fetchall()]
        if existing_files:
            is_resync = True
            previous_files = existing_files
            # Keep only the latest previous set
            cur.execute("""
                DELETE FROM course_file_text
                WHERE course_id = ? AND file_type IN ('schedule', 'syllabus', 'front_page', 'modules') AND is_previous = 1
            """, (course_id,))
            cur.execute("""
                UPDATE course_file_text
                SET is_previous = 1, archived_at = ?
                WHERE course_id = ? AND file_type IN ('schedule', 'syllabus', 'front_page', 'modules')
                  AND (is_previous IS NULL OR is_previous = 0)
            """, (now_iso(), course_id))

        for material in extracted_materials:
            cur.execute("""
                INSERT INTO course_file_text (
                    course_id, canvas_file_id, file_type, file_name,
                    storage_path, extracted_text, created_at, is_previous, archived_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                course_id,
                material["metadata"].get("file_id"),
                material.get("file_type", "schedule"),
                material["name"],
                material["metadata"].get("path", f"canvas_page:{material['metadata'].get('source', 'unknown')}"),
                material["text"],
                now_iso(),
                0,
                None
            ))

        conn.commit()
        conn.close()

    print(f"   [OK] Inserted {len(extracted_materials)} materials into database")

    summary = {
        "course_id": course_id,
        "timestamp": now_iso(),
        "is_resync": is_resync,
        "sync_version": sync_version,
        "previous_files_count": len(previous_files) if is_resync else 0,
        "materials_extracted": len(extracted_materials),
        "materials": [
            {"name": m["name"], "source_type": m["source_type"], "text_length": len(m["text"])}
            for m in extracted_materials
        ]
    }

    print(f"\n{'=' * 60}")
    print(f"[OK] {'RE' if is_resync else ''}SYNC COMPLETE (v{sync_version})")
    print(f"{'=' * 60}\n")

    return jsonify(summary)


# =============================================================================
# RESOLVE COURSE DATES (AI)
# =============================================================================

@app.route("/api/resolve_course_dates", methods=["POST"])
@require_auth
def resolve_course_dates():
    payload = request.get_json(silent=True) or {}
    course_id = str(payload.get("course_id") or "").strip()
    timezone = payload.get("course_timezone", "America/New_York")
    discover_new = payload.get("discover_new_assignments", True)
    user_id = request.user_id
    if not course_id:
        return jsonify({"error": "Missing course_id"}), 400

    active_credential_key = None
    if USE_FIRESTORE:
        creds = get_user_canvas_credentials(user_id)
        active_credential_key = creds.get('canvas_credential_key') if creds else None

    grouped_course_ids = [course_id]
    canvas_course_lookup = {}

    if USE_FIRESTORE:
        grouped_course_ids = get_grouped_course_ids_by_code(user_id, course_id, active_credential_key) or [course_id]
        print(f"[GROUP SYNC] Resolve scope for {course_id}: {grouped_course_ids}")

        # Get all assignments from Firestore (including discovered)
        assignments_raw = []
        canvas_semantics_by_course = {}

        # Separate Canvas assignments from discovered ones
        canvas_assignments = []
        existing_discovered = []
        existing_discovered_by_course = {}
        seen_canvas_ids = set()
        seen_discovered_keys = set()

        for scoped_course_id in grouped_course_ids:
            scoped_assignments = get_course_assignments(user_id, scoped_course_id, active_credential_key)
            assignments_raw.extend(scoped_assignments)

            for a in scoped_assignments:
                canvas_assignment_id = a.get('canvasAssignmentId')
                if canvas_assignment_id:
                    scoped_course_id_str = str(scoped_course_id)
                    canvas_key = str(canvas_assignment_id)
                    if canvas_key in seen_canvas_ids:
                        continue
                    seen_canvas_ids.add(canvas_key)
                    canvas_course_lookup[canvas_key] = scoped_course_id_str
                    canvas_assignments.append({
                        'course_id': scoped_course_id_str,
                        'canvas_assignment_id': canvas_assignment_id,
                        'name': a.get('name'),
                        'original_due_at': a.get('originalDueAt'),
                        'normalized_due_at': a.get('normalizedDueAt')
                    })
                    canvas_semantics_by_course.setdefault(scoped_course_id_str, []).append(
                        build_assignment_semantic_signature(
                            name=a.get("name"),
                            due=a.get("normalizedDueAt") or a.get("originalDueAt"),
                            category=a.get("category"),
                            description=a.get("description"),
                        )
                    )
                else:
                    scoped_course_id_str = str(scoped_course_id)
                    discovered_doc_id = str(a.get("id") or "").strip()
                    discovered_key = build_discovered_item_dedupe_key(
                        name=a.get("name"),
                        due=a.get("normalizedDueAt"),
                        category=a.get("category"),
                        description=a.get("description"),
                    )
                    scoped_course_key_map = existing_discovered_by_course.setdefault(scoped_course_id_str, {})
                    existing_for_key = scoped_course_key_map.get(discovered_key) if discovered_key else None
                    if discovered_key and not existing_for_key:
                        scoped_course_key_map[discovered_key] = {
                            "id": discovered_doc_id,
                            "name": a.get("name"),
                            "normalized_due_at": a.get("normalizedDueAt"),
                            "category": a.get("category"),
                            "status": a.get("status"),
                            "duplicate_doc_ids": [],
                        }
                    elif discovered_key and existing_for_key and discovered_doc_id:
                        primary_id = str(existing_for_key.get("id") or "").strip()
                        if discovered_doc_id != primary_id:
                            dup_ids = existing_for_key.setdefault("duplicate_doc_ids", [])
                            if discovered_doc_id not in dup_ids:
                                dup_ids.append(discovered_doc_id)
                    if discovered_key in seen_discovered_keys:
                        continue
                    seen_discovered_keys.add(discovered_key)
                    existing_discovered.append({
                        'name': a.get('name'),
                        'normalized_due_at': a.get('normalizedDueAt'),
                        'category': a.get('category'),
                        'status': a.get('status'),
                        'discovered_key': discovered_key,
                    })

        # Legacy format for initial sync
        assignments = [{
            'canvas_assignment_id': a.get('canvas_assignment_id'),
            'name': a.get('name'),
            'original_due_at': a.get('original_due_at'),
            'normalized_due_at': a.get('normalized_due_at')
        } for a in canvas_assignments]

        file_types = ["schedule", "syllabus", "front_page", "modules"]
        files_raw = []
        seen_file_keys = set()
        for scoped_course_id in grouped_course_ids:
            for ft in file_types:
                try:
                    scoped_files = get_course_file_texts(user_id, scoped_course_id, ft, active_credential_key)
                except Exception:
                    continue
                for f in scoped_files:
                    extracted_text = str(f.get('extractedText') or "")
                    file_key = (
                        str(f.get('fileType') or ""),
                        str(f.get('fileName') or ""),
                        bool(f.get('isPrevious')),
                        hashlib.md5(extracted_text.encode("utf-8", errors="ignore")).hexdigest()[:16],
                    )
                    if file_key in seen_file_keys:
                        continue
                    seen_file_keys.add(file_key)
                    files_raw.append(f)

        files_raw.sort(key=lambda f: len((f.get('extractedText') or "")), reverse=True)

        new_files = [{
            'file_name': f.get('fileName'),
            'file_type': f.get('fileType'),
            'extracted_text': f.get('extractedText')
        } for f in files_raw if not f.get('isPrevious')]
        
        # Get previous files (archived from last sync)
        previous_files = [{
            'file_name': f.get('fileName'),
            'file_type': f.get('fileType'),
            'extracted_text': f.get('extractedText')
        } for f in files_raw if f.get('isPrevious')]
        
        # For backwards compatibility
        files = new_files if new_files else [{
            'file_name': f.get('fileName'),
            'file_type': f.get('fileType'),
            'extracted_text': f.get('extractedText')
        } for f in files_raw]

        announcements = []
        seen_announcement_keys = set()
        for scoped_course_id in grouped_course_ids:
            for ann in get_all_announcements(scoped_course_id, user_id, active_credential_key):
                ann_key = (
                    str(ann.get('canvas_announcement_id') or ""),
                    str(ann.get('title') or ""),
                    str(ann.get('posted_at') or ""),
                )
                if ann_key in seen_announcement_keys:
                    continue
                seen_announcement_keys.add(ann_key)
                announcements.append(ann)
        
        # Detect if this is a resync
        is_resync = len(existing_discovered) > 0 or len(previous_files) > 0
    else:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("""
            SELECT canvas_assignment_id, name, original_due_at, normalized_due_at,
                   status, category, description
            FROM assignments_normalized
            WHERE course_id = ?
        """, (course_id,))
        assignments_raw = [dict(r) for r in cur.fetchall()]

        canvas_assignments = [{
            'canvas_assignment_id': a.get('canvas_assignment_id'),
            'name': a.get('name'),
            'description': html_to_text(a.get('description') or ""),
            'original_due_at': a.get('original_due_at'),
            'normalized_due_at': a.get('normalized_due_at')
        } for a in assignments_raw if a.get('canvas_assignment_id')]

        existing_discovered = [{
            'name': a.get('name'),
            'description': html_to_text(a.get('description') or ""),
            'normalized_due_at': a.get('normalized_due_at'),
            'category': a.get('category'),
            'status': a.get('status')
        } for a in assignments_raw if not a.get('canvas_assignment_id')]
        deduped_existing_discovered = {}
        for item in existing_discovered:
            key = build_discovered_item_dedupe_key(
                name=item.get("name"),
                due=item.get("normalized_due_at"),
                category=item.get("category"),
                description=item.get("description"),
            )
            if key and key not in deduped_existing_discovered:
                deduped_existing_discovered[key] = item
        existing_discovered = list(deduped_existing_discovered.values())

        assignments = canvas_assignments

        cur.execute("""
            SELECT file_name, file_type, extracted_text, is_previous
            FROM course_file_text
            WHERE course_id = ? AND file_type IN ('schedule', 'syllabus', 'front_page', 'modules')
            ORDER BY LENGTH(extracted_text) DESC
        """, (course_id,))
        files_raw = [dict(r) for r in cur.fetchall()]

        new_files = [{
            'file_name': f.get('file_name'),
            'file_type': f.get('file_type'),
            'extracted_text': f.get('extracted_text')
        } for f in files_raw if not f.get('is_previous')]

        previous_files = [{
            'file_name': f.get('file_name'),
            'file_type': f.get('file_type'),
            'extracted_text': f.get('extracted_text')
        } for f in files_raw if f.get('is_previous')]

        files = new_files if new_files else [{
            'file_name': f.get('file_name'),
            'file_type': f.get('file_type'),
            'extracted_text': f.get('extracted_text')
        } for f in files_raw]
        conn.close()

        announcements = get_all_announcements(course_id)

        # Local resync detection
        is_resync = len(existing_discovered) > 0 or len(previous_files) > 0

    if len(grouped_course_ids) > 1:
        print(f"[GROUP SYNC] Unified class-code resolve across {len(grouped_course_ids)} courses: {grouped_course_ids}")

    if is_resync:
        print(f"[GEMINI RESYNC] Conservative update with {len(canvas_assignments)} Canvas, {len(existing_discovered)} existing discovered")
        print(f"[GEMINI RESYNC] Comparing {len(previous_files)} previous files with {len(new_files)} new files")
    else:
        print(f"[GEMINI] Resolving {len(assignments)} Canvas assignments using {len(files)} files and {len(announcements)} announcements")

    gemini_usage_payload = None
    gemini_usage_context = {
        "request_id": str(uuid.uuid4()),
        "user_id": user_id,
        "course_id": course_id,
        "is_resync": is_resync,
        "grouped_course_ids": grouped_course_ids,
    }

    try:
        # Lazy import to avoid Cloud Run cold start slowdown for non-AI endpoints.
        from ai.gemini_model import (
            resolve_assignment_dates_with_gemini,
            resync_assignment_dates_with_gemini,
        )

        max_ai_attempts = 1
        gemini_resp = None
        last_ai_error = None
        for attempt in range(1, max_ai_attempts + 1):
            try:
                if is_resync:
                    # Use conservative resync function
                    gemini_resp = resync_assignment_dates_with_gemini(
                        existing_assignments=existing_discovered,
                        canvas_assignments=canvas_assignments,
                        previous_files=previous_files,
                        new_files=new_files,
                        announcements=announcements,
                        course_timezone=timezone,
                        discover_new_assignments=discover_new,
                        telemetry_context=gemini_usage_context,
                    )
                    print(f"[GEMINI RESYNC] Summary: {gemini_resp.get('changes_summary', 'N/A')}")
                else:
                    # Initial sync - use original function
                    gemini_resp = resolve_assignment_dates_with_gemini(
                        assignments=assignments,
                        announcements=announcements,
                        files=files,
                        course_timezone=timezone,
                        confidence_threshold=0.0,
                        discover_new_assignments=discover_new,
                        telemetry_context=gemini_usage_context,
                    )
                break
            except Exception as ai_err:
                last_ai_error = ai_err
                if attempt >= max_ai_attempts or not is_transient_ai_error(ai_err):
                    raise
                backoff_seconds = min(8.0, 1.25 * (2 ** (attempt - 1)))
                print(
                    f"[WARN] Gemini transient failure (attempt {attempt}/{max_ai_attempts}): {ai_err}. "
                    f"Retrying in {backoff_seconds:.1f}s."
                )
                time.sleep(backoff_seconds)

        if gemini_resp is None and last_ai_error is not None:
            raise last_ai_error

        if isinstance(gemini_resp, dict):
            gemini_usage_payload = gemini_resp.pop("_usage", None)
            if gemini_usage_payload:
                persist_ai_usage_log(
                    user_id,
                    gemini_usage_payload,
                    course_id=course_id,
                    canvas_credential_key=active_credential_key,
                )

        ai_course_code = gemini_resp.get("cc") or gemini_resp.get("course_code")
        gemini_results = gemini_resp.get("a") or gemini_resp.get("assignments", [])

        canvas_updates = [r for r in gemini_results if (r.get("cid") or r.get("canvas_assignment_id"))]
        discovered_raw = [r for r in gemini_results if not (r.get("cid") or r.get("canvas_assignment_id"))]
        discovered = dedupe_discovered_ai_results(discovered_raw)
        if len(discovered) < len(discovered_raw):
            print(
                f"[DEDUPE] Collapsed discovered AI rows from {len(discovered_raw)} to {len(discovered)} "
                "using semantic keys."
            )

    except Exception as e:
        logger.error("Gemini resolve failed: %s", e)
        import traceback
        traceback.print_exc()
        status_code = 503 if is_transient_ai_error(e) else 500
        error_label = "AI resolve temporarily unavailable" if status_code == 503 else "AI resolve failed"
        # Do not expose exception details to client; log server-side only.
        return jsonify({"error": error_label}), status_code

    updated = 0
    conflicts = 0
    discovered_count = 0

    if USE_FIRESTORE:
        # Update assignments in Firestore
        canvas_by_id = {str(a.get("canvas_assignment_id")): a for a in canvas_assignments}
        for r in canvas_updates:
            canvas_id = r.get("cid") or r.get("canvas_assignment_id")
            if not canvas_id:
                continue

            st = r.get("st") or r.get("status")
            ai_category = r.get("cat") or r.get("category") or "ASSIGNMENT"
            due = r.get("due") or r.get("normalized_due_at")
            deliverable = 0 if ai_category in ("READING", "ATTENDANCE", "PLACEHOLDER", "LECTURE") else 1

            # Preserve Canvas due_at (and its time) for real Canvas assignments.
            existing_canvas = canvas_by_id.get(str(canvas_id)) or {}
            original_due_at = existing_canvas.get("original_due_at")
            existing_normalized = existing_canvas.get("normalized_due_at")

            due_to_set = original_due_at or due or existing_normalized

            updates = {
                'status': st,
                'category': ai_category,
                'deliverable': deliverable,
            }
            if due_to_set is not None:
                updates['normalizedDueAt'] = due_to_set

            target_course_id = str(
                canvas_course_lookup.get(str(canvas_id))
                or existing_canvas.get("course_id")
                or course_id
            ).strip() or course_id

            update_assignment(user_id, target_course_id, canvas_id, updates, active_credential_key)

            if st == "RESOLVED":
                updated += 1
            elif st == "CONFLICT":
                conflicts += 1

        target_course_ids_for_discovered = grouped_course_ids if grouped_course_ids else [course_id]
        stale_discovered_doc_ids_by_course = {}
        suppressed_discovered_against_canvas = 0

        # Pre-clean existing discovered items that are clearly duplicates of Canvas items.
        for scoped_course_id in target_course_ids_for_discovered:
            scoped_course_id = str(scoped_course_id)
            scoped_course_key_map = existing_discovered_by_course.get(scoped_course_id) or {}
            if not scoped_course_key_map:
                continue
            canvas_signatures = canvas_semantics_by_course.get(scoped_course_id) or []
            if not canvas_signatures:
                continue

            for discovered_key, existing_entry in list(scoped_course_key_map.items()):
                if not discovered_matches_canvas(
                    name=existing_entry.get("name") or "",
                    due=existing_entry.get("normalized_due_at") or "",
                    category=existing_entry.get("category") or "",
                    description="",
                    canvas_signatures=canvas_signatures,
                ):
                    continue

                stale_ids = stale_discovered_doc_ids_by_course.setdefault(scoped_course_id, set())
                primary_id = str(existing_entry.get("id") or "").strip()
                if primary_id:
                    stale_ids.add(primary_id)
                for dup_id in existing_entry.get("duplicate_doc_ids") or []:
                    dup_id = str(dup_id or "").strip()
                    if dup_id:
                        stale_ids.add(dup_id)
                scoped_course_key_map.pop(discovered_key, None)
                suppressed_discovered_against_canvas += 1

        # Handle discovered assignments
        if discovered:
            # For RESYNC: Don't delete existing discovered - merge/update instead
            # For initial sync: Delete and recreate (no existing data to preserve)
            if not is_resync:
                for scoped_course_id in target_course_ids_for_discovered:
                    delete_discovered_assignments(user_id, scoped_course_id, active_credential_key)
                print(
                    f"[INITIAL SYNC] Cleared discovered items for {len(target_course_ids_for_discovered)} "
                    f"course(s), adding {len(discovered)} new entries per course"
                )
            else:
                print(
                    f"[RESYNC] Merging {len(discovered)} items across "
                    f"{len(target_course_ids_for_discovered)} grouped course(s)"
                )

            for r in discovered:
                status = r.get("st") or r.get("status")
                action = r.get("action", "").upper()
                
                # Skip items if they shouldn't be added
                if status not in ("DISCOVERED", "EXISTING") and action not in ("KEEP", "UPDATE", "ADD"):
                    continue

                name = (r.get("nam") or r.get("name") or "").strip()
                desc = (r.get("des") or r.get("description") or "").strip()
                due = r.get("due") or r.get("normalized_due_at")

                if not name:
                    continue

                force_assignment = force_assignment_if_deliverable_keywords(name, desc)
                model_category = (r.get("cat") or r.get("category") or "").strip().upper()
                
                # Normalize QUIZ to EXAM
                if model_category == "QUIZ":
                    model_category = "EXAM"

                if force_assignment:
                    category = "ASSIGNMENT"
                    deliverable = 1
                elif model_category in ("ASSIGNMENT", "EXAM", "PLACEHOLDER"):
                    category = model_category
                    deliverable = 1 if category in ("ASSIGNMENT", "EXAM") else 0
                else:
                    category, deliverable = infer_category_from_discovered_item(name, desc)

                # Skip items without due dates
                if not due:
                    continue

                discovered_key = build_discovered_item_dedupe_key(
                    name=name,
                    due=due,
                    category=category,
                    description=desc,
                )

                # Log the action for resync
                if is_resync and action:
                    if action == "KEEP":
                        print(f"   [KEEP] {category}: {name}")
                    elif action == "UPDATE":
                        print(f"   [UPDATE] {category}: {name} - {r.get('reason', '')}")
                    elif action == "ADD":
                        print(f"   + Adding {category}: {name}")

                for scoped_course_id in target_course_ids_for_discovered:
                    scoped_course_id = str(scoped_course_id)
                    scoped_course_key_map = existing_discovered_by_course.setdefault(scoped_course_id, {})
                    existing_for_key = scoped_course_key_map.get(discovered_key) if discovered_key else None
                    existing_doc_id = str(existing_for_key.get("id") or "").strip() if existing_for_key else ""
                    canvas_signatures = canvas_semantics_by_course.get(scoped_course_id) or []
                    if discovered_matches_canvas(
                        name=name,
                        due=due,
                        category=category,
                        description=desc,
                        canvas_signatures=canvas_signatures,
                    ):
                        stale_ids = stale_discovered_doc_ids_by_course.setdefault(scoped_course_id, set())
                        if existing_doc_id:
                            stale_ids.add(existing_doc_id)
                        if existing_for_key:
                            for dup_id in existing_for_key.get("duplicate_doc_ids") or []:
                                dup_id = str(dup_id or "").strip()
                                if dup_id:
                                    stale_ids.add(dup_id)
                            scoped_course_key_map.pop(discovered_key, None)
                        suppressed_discovered_against_canvas += 1
                        if is_resync:
                            print(f"   [SKIP DUP-CANVAS] {category}: {name}")
                        continue

                    if existing_for_key:
                        stale_ids = stale_discovered_doc_ids_by_course.setdefault(scoped_course_id, set())
                        for dup_id in existing_for_key.get("duplicate_doc_ids") or []:
                            dup_id = str(dup_id or "").strip()
                            if dup_id and dup_id != existing_doc_id:
                                stale_ids.add(dup_id)

                    # Preserve stable naming for existing discovered items so doc ids stay stable
                    # across minor wording changes (quiz/test/exam aliases).
                    name_to_store = (existing_for_key.get("name") if existing_for_key else name) or name

                    saved_doc_id = save_assignment(user_id, scoped_course_id, {
                        'name': name_to_store,
                        'description': desc or "Discovered from schedule",
                        'normalized_due_at': due,
                        'source_of_truth': 'Schedule!',
                        'status': 'DISCOVERED',
                        'category': category,
                        'deliverable': deliverable,
                        'existing_doc_id': existing_doc_id or None,
                        'discovered_key': discovered_key,
                        'raw_canvas_json': json.dumps({
                            "discovered": True,
                            "category": category,
                            "action": action,
                            "grouped_course_ids": target_course_ids_for_discovered,
                        })
                    }, active_credential_key)
                    if discovered_key:
                        remaining_dup_ids = []
                        if existing_for_key:
                            remaining_dup_ids = [
                                str(dup_id).strip()
                                for dup_id in (existing_for_key.get("duplicate_doc_ids") or [])
                                if str(dup_id).strip() and str(dup_id).strip() != str(saved_doc_id).strip()
                            ]
                        scoped_course_key_map[discovered_key] = {
                            "id": saved_doc_id,
                            "name": name_to_store,
                            "normalized_due_at": due,
                            "category": category,
                            "status": "DISCOVERED",
                            "duplicate_doc_ids": remaining_dup_ids,
                        }
                    discovered_count += 1

                if not is_resync or action == "ADD":
                    if len(target_course_ids_for_discovered) > 1:
                        print(
                            f"   [DISCOVERED] {category}: {name} due {due} "
                            f"(applied to {len(target_course_ids_for_discovered)} courses)"
                        )
                    else:
                        print(f"   [DISCOVERED] {category}: {name} due {due}")

            removed_discovered_duplicates = 0
            for scoped_course_id, stale_ids in stale_discovered_doc_ids_by_course.items():
                stale_list = [doc_id for doc_id in sorted(stale_ids) if doc_id]
                if not stale_list:
                    continue
                try:
                    removed_discovered_duplicates += delete_assignments_by_doc_ids(
                        user_id,
                        stale_list,
                        active_credential_key,
                    )
                except Exception as cleanup_err:
                    print(
                        f"[WARN] Failed dedupe cleanup for course {scoped_course_id}: {cleanup_err}"
                    )
            if removed_discovered_duplicates > 0:
                print(
                    f"[DEDUPE] Removed {removed_discovered_duplicates} stale discovered duplicate "
                    f"document(s) across grouped courses."
                )
            if suppressed_discovered_against_canvas > 0:
                print(
                    f"[DEDUPE] Suppressed {suppressed_discovered_against_canvas} discovered item instance(s) "
                    "that matched Canvas assignments."
                )

        # Update course code only when it is missing/UNK to avoid tag drift between reloads.
        if ai_course_code:
            normalized_ai_code = normalize_course_code(ai_course_code)
            for scoped_course_id in target_course_ids_for_discovered:
                existing_course = get_course(user_id, scoped_course_id, active_credential_key)
                existing_course_code = normalize_course_code(
                    existing_course.get('courseCode') if existing_course else ""
                )
                if normalized_ai_code and (
                    not existing_course_code or
                    existing_course_code == "UNK" or
                    existing_course_code == normalized_ai_code
                ):
                    update_course_metadata(user_id, scoped_course_id, normalized_ai_code, active_credential_key)
                else:
                    print(
                        f"[COURSE CODE] Keeping existing code '{existing_course_code}' "
                        f"for course {scoped_course_id}; skipped AI suggestion '{normalized_ai_code}'"
                    )

    else:
        # Local mode: SQLite (existing logic)
        conn = get_db()
        cur = conn.cursor()

        for r in canvas_updates:
            canvas_id = r.get("cid") or r.get("canvas_assignment_id")
            if not canvas_id:
                continue

            st = r.get("st") or r.get("status")
            ai_category = r.get("cat") or r.get("category") or "ASSIGNMENT"
            due = r.get("due") or r.get("normalized_due_at")
            deliverable = 0 if ai_category in ("READING", "ATTENDANCE", "PLACEHOLDER", "LECTURE") else 1

            cur.execute("""
                UPDATE assignments_normalized
                SET normalized_due_at = ?, status = ?, category = ?, deliverable = ?
                WHERE course_id = ? AND canvas_assignment_id = ?
            """, (due, st, ai_category, deliverable, course_id, canvas_id))

            if st == "RESOLVED":
                updated += 1
            elif st == "CONFLICT":
                conflicts += 1

        # Handle discovered assignments
        if discovered:
            if not is_resync:
                cur.execute("""
                    DELETE FROM assignments_normalized 
                    WHERE course_id = ? AND canvas_assignment_id IS NULL
                """, (course_id,))
                conn.commit()
            else:
                print(f"[RESYNC] Merging {len(discovered)} items with existing discovered")

            for r in discovered:
                status = r.get("st") or r.get("status")
                action = (r.get("action") or ("KEEP" if is_resync else "")).upper()
                if action == "REMOVE":
                    continue
                if status not in ("DISCOVERED", "EXISTING") and action not in ("KEEP", "UPDATE", "ADD"):
                    continue

                name = (r.get("nam") or r.get("name") or "").strip()
                desc = (r.get("des") or r.get("description") or "").strip()
                due = r.get("due") or r.get("normalized_due_at")

                if not name:
                    continue

                force_assignment = force_assignment_if_deliverable_keywords(name, desc)
                model_category = (r.get("cat") or r.get("category") or "").strip().upper()
                
                # Normalize QUIZ to EXAM
                if model_category == "QUIZ":
                    model_category = "EXAM"

                if force_assignment:
                    category = "ASSIGNMENT"
                    deliverable = 1
                elif model_category in ("ASSIGNMENT", "EXAM", "PLACEHOLDER"):
                    category = model_category
                    deliverable = 1 if category in ("ASSIGNMENT", "EXAM") else 0
                else:
                    category, deliverable = infer_category_from_discovered_item(name, desc)

                # Skip items without due dates
                if not due:
                    continue

                raw_meta = json.dumps({"discovered": True, "category": category, "action": action})

                if is_resync and action in ("KEEP", "UPDATE"):
                    cur.execute("""
                        UPDATE assignments_normalized
                        SET description = ?, normalized_due_at = ?, status = ?, category = ?,
                            deliverable = ?, raw_canvas_json = ?, updated_at = ?
                        WHERE course_id = ? AND canvas_assignment_id IS NULL AND name = ?
                    """, (
                        desc or "Discovered from schedule",
                        due,
                        "DISCOVERED",
                        category,
                        deliverable,
                        raw_meta,
                        now_iso(),
                        course_id,
                        name
                    ))

                    if cur.rowcount == 0:
                        cur.execute("""
                            INSERT INTO assignments_normalized (
                                course_id, canvas_assignment_id, name, description,
                                original_due_at, normalized_due_at, source_of_truth,
                                confidence, status, raw_canvas_json, category,
                                deliverable, created_at, updated_at
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """, (
                            course_id, None, name, desc or "Discovered from schedule",
                            None, due, "Schedule!", None, "DISCOVERED",
                            raw_meta,
                            category, deliverable, now_iso(), now_iso()
                        ))
                    discovered_count += 1
                    if action == "UPDATE":
                        print(f"   [UPDATE] {category}: {name}")
                    else:
                        print(f"   [KEEP] {category}: {name}")
                else:
                    cur.execute("""
                        INSERT INTO assignments_normalized (
                            course_id, canvas_assignment_id, name, description,
                            original_due_at, normalized_due_at, source_of_truth,
                            confidence, status, raw_canvas_json, category,
                            deliverable, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        course_id, None, name, desc or "Discovered from schedule",
                        None, due, "Schedule!", None, "DISCOVERED",
                        raw_meta,
                        category, deliverable, now_iso(), now_iso()
                    ))
                    discovered_count += 1
                    print(f"   [DISCOVERED] {category}: {name} due {due}")

        conn.commit()
        conn.close()

    return jsonify({
        "course_id": course_id,
        "grouped_course_ids": grouped_course_ids,
        "grouped_course_count": len(grouped_course_ids),
        "is_resync": is_resync,
        "updated": updated,
        "conflicts": conflicts,
        "discovered": discovered_count,
        "changes_summary": gemini_resp.get("changes_summary") if is_resync else None
    }), 200


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    port = int(os.getenv('PORT', 5000))
    debug = os.getenv('FLASK_DEBUG', 'false').lower() == 'true'
    host = '0.0.0.0'

    # Security: In local mode (no auth), refuse to bind to 0.0.0.0 unless explicitly allowed.
    # This prevents accidental exposure of an unauthenticated backend to the network.
    if not USE_FIRESTORE and host == '0.0.0.0':
        allow_local_public = os.getenv("ALLOW_LOCAL_PUBLIC", "").strip().lower() in {"1", "true", "yes", "on"}
        if not allow_local_public:
            host = '127.0.0.1'
            print("[SECURITY] Local mode: binding to 127.0.0.1 only (no auth). Set ALLOW_LOCAL_PUBLIC=1 to bind to 0.0.0.0")

    print("\n[START] Canvas Organizer Backend")
    print(f"   Mode: {'CLOUD (Firestore)' if USE_FIRESTORE else 'LOCAL (SQLite)'}")
    print(f"   Port: {port}")
    print(f"   Debug: {debug}\n")

    app.run(host=host, port=port, debug=debug, use_reloader=False)
