# Firebase/Firestore Database Adapter
# Replaces SQLite with Google Cloud Firestore for multi-user cloud deployment
# This file provides the same interface as the old db.py but uses Firestore

import logging
import os

logger = logging.getLogger(__name__)
import hashlib
import base64
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
from cryptography.fernet import Fernet, InvalidToken

# Firebase Admin SDK imports
from firebase_admin import credentials, firestore, initialize_app
import firebase_admin

# Track initialization state
_initialized = False
TOKEN_ENCRYPTION_PREFIX = "enc:v1:"


def _get_token_cipher(required: bool = False) -> Optional[Fernet]:
    """
    Build a Fernet cipher from CANVAS_TOKEN_ENCRYPTION_KEY if configured.
    Expected value is a Fernet key (urlsafe base64-encoded 32-byte key).
    """
    key = (os.getenv("CANVAS_TOKEN_ENCRYPTION_KEY") or "").strip()
    if not key:
        if required:
            raise RuntimeError("CANVAS_TOKEN_ENCRYPTION_KEY is required but not set.")
        return None

    key_bytes = key.encode("utf-8")
    try:
        return Fernet(key_bytes)
    except Exception:
        # Support raw 32-byte keys as a fallback format.
        if len(key_bytes) == 32:
            return Fernet(base64.urlsafe_b64encode(key_bytes))
        raise ValueError(
            "Invalid CANVAS_TOKEN_ENCRYPTION_KEY. Provide a Fernet key or raw 32-byte key."
        )


def ensure_token_encryption_configured():
    """Fail fast if encryption key is missing/invalid."""
    _get_token_cipher(required=True)


def encrypt_canvas_token(token: str) -> str:
    """
    Encrypt Canvas token for storage.
    Requires CANVAS_TOKEN_ENCRYPTION_KEY in cloud mode. No plaintext fallback.
    """
    if not token:
        return token
    cipher = _get_token_cipher(required=True)
    ciphertext = cipher.encrypt(token.encode("utf-8")).decode("utf-8")
    return f"{TOKEN_ENCRYPTION_PREFIX}{ciphertext}"


def decrypt_canvas_token(stored_value: str) -> Optional[str]:
    """
    Decrypt stored Canvas token value.
    - Legacy plaintext values are returned as-is.
    - Encrypted values require CANVAS_TOKEN_ENCRYPTION_KEY.
    """
    if not stored_value:
        return stored_value

    if not str(stored_value).startswith(TOKEN_ENCRYPTION_PREFIX):
        # Legacy plaintext token - DEPRECATED: migrate to encrypted storage.
        # Plaintext tokens are a security risk if the database is compromised.
        logger.warning(
            "Legacy plaintext Canvas token detected. Set CANVAS_TOKEN_ENCRYPTION_KEY and re-save credentials to encrypt."
        )
        return stored_value

    cipher = _get_token_cipher(required=False)
    if cipher is None:
        logger.warning("CANVAS_TOKEN_ENCRYPTION_KEY is not configured; cannot decrypt encrypted Canvas token.")
        return None

    ciphertext = str(stored_value)[len(TOKEN_ENCRYPTION_PREFIX):]
    try:
        return cipher.decrypt(ciphertext.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        logger.warning("Failed to decrypt Canvas token: invalid key or corrupted ciphertext.")
        return None


def init_firebase():
    """Initialize Firebase Admin SDK (call once at startup)"""
    global _initialized
    if _initialized:
        return
    
    # Check if already initialized by another module
    try:
        firebase_admin.get_app()
        _initialized = True
        return
    except ValueError:
        pass  # Not initialized yet
    
    # Prefer an explicit Firebase project id so ID token verification matches the frontend
    # (and so other env vars like GCP_PROJECT_ID for Vertex can't accidentally break auth).
    firebase_project_id = (os.getenv("FIREBASE_PROJECT_ID") or "").strip() or None

    # Try different credential sources
    options = {}
    
    if os.getenv('FIREBASE_SERVICE_ACCOUNT'):
        # Production: Use service account file path
        cred = credentials.Certificate(os.getenv('FIREBASE_SERVICE_ACCOUNT'))
    elif os.getenv('K_SERVICE'):
        # Cloud Run: K_SERVICE env var indicates we're on Cloud Run, use ADC
        logger.info("Cloud Run detected; using Application Default Credentials")
        cred = credentials.ApplicationDefault()
        # Must specify project ID for token verification with ADC
        project_id = firebase_project_id or os.getenv('GOOGLE_CLOUD_PROJECT') or os.getenv('GCP_PROJECT_ID')
        if project_id:
            options['projectId'] = project_id
            print(f"[ENV] Using Firebase project ID: {project_id}")
    elif os.getenv('GOOGLE_APPLICATION_CREDENTIALS'):
        # Other cloud environments with ADC
        cred = credentials.ApplicationDefault()
    else:
        # Local development: Try to find firebase-key.json
        local_key = os.path.join(os.path.dirname(__file__), 'firebase_key.json')
        if os.path.exists(local_key):
            cred = credentials.Certificate(local_key)
        else:
            raise RuntimeError(
                "No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var "
                "or place firebase-key.json in the backend directory."
            )
    
    # If explicitly configured, prefer FIREBASE_PROJECT_ID for initialization too.
    if firebase_project_id and not options.get("projectId"):
        options["projectId"] = firebase_project_id

    initialize_app(cred, options)

    # Validate the intended Firebase project to prevent hard-to-debug sign-in failures.
    try:
        app = firebase_admin.get_app()
        actual_project_id = getattr(app, "project_id", None) or (getattr(app, "options", {}) or {}).get("projectId")
        if firebase_project_id and actual_project_id and firebase_project_id != actual_project_id:
            raise RuntimeError(
                f"Firebase project mismatch: FIREBASE_PROJECT_ID={firebase_project_id} "
                f"but initialized project_id={actual_project_id}. Check credentials/env."
            )
        if actual_project_id:
            logger.info("Firebase Admin project: %s", actual_project_id)
    except Exception as e:
        logger.warning("Firebase project check failed: %s", e)
    _initialized = True
    logger.info("Firebase Admin SDK initialized")


def get_db():
    """Get Firestore client (analogous to old get_db() returning SQLite connection)"""
    init_firebase()
    return firestore.client()


def now_iso() -> str:
    """Return current UTC timestamp as ISO string"""
    return datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_canvas_url(api_url: str) -> str:
    """Normalize Canvas base URL for stable token scoping."""
    return (api_url or "").strip().lower().rstrip("/")


def build_canvas_credential_key(api_url: str, token: str) -> str:
    """
    Build a stable, non-reversible key representing a Canvas credential pair.
    Used to scope data to the currently connected Canvas token.
    """
    raw = f"{normalize_canvas_url(api_url)}|{(token or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


# =============================================================================
# RATE LIMITING
# =============================================================================

def consume_hourly_rate_limit(user_id: str, limit_key: str, limit_per_hour: int) -> Dict[str, Any]:
    """
    Atomically consume one unit from a user's hourly rate limit bucket.

    Returns:
        {
            "allowed": bool,
            "count": int,                  # current count in this hour
            "limit": int,                  # configured hourly limit
            "retry_after_seconds": int,    # seconds until next hour window
            "window_start": str,           # ISO timestamp (UTC)
            "window_end": str,             # ISO timestamp (UTC)
        }
    """
    if limit_per_hour <= 0:
        raise ValueError("limit_per_hour must be greater than 0.")

    db = get_db()
    now = datetime.utcnow()
    window_start = now.replace(minute=0, second=0, microsecond=0)
    window_end = window_start + timedelta(hours=1)
    bucket_id = window_start.strftime("%Y%m%d%H")
    # Keep limiter docs outside user-writable paths so clients cannot tamper with counters.
    raw_doc_key = f"{user_id}|{limit_key}|hour|{bucket_id}"
    doc_id = hashlib.sha256(raw_doc_key.encode("utf-8")).hexdigest()
    limit_ref = db.collection("_systemRateLimits").document(doc_id)

    @firestore.transactional
    def _consume(transaction):
        snap = limit_ref.get(transaction=transaction)
        current_count = 0
        if snap.exists:
            data = snap.to_dict() or {}
            current_count = int(data.get("count") or 0)

        if current_count >= limit_per_hour:
            return False, current_count

        next_count = current_count + 1
        payload = {
            "userId": user_id,
            "key": limit_key,
            "window": "hour",
            "bucketId": bucket_id,
            "count": next_count,
            "limit": limit_per_hour,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if snap.exists:
            transaction.update(limit_ref, payload)
        else:
            payload["createdAt"] = firestore.SERVER_TIMESTAMP
            transaction.set(limit_ref, payload)

        return True, next_count

    allowed, count = _consume(db.transaction())
    retry_after_seconds = max(1, int((window_end - now).total_seconds()))
    return {
        "allowed": bool(allowed),
        "count": int(count),
        "limit": int(limit_per_hour),
        "retry_after_seconds": retry_after_seconds,
        "window_start": window_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end": window_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# =============================================================================
# USER OPERATIONS
# =============================================================================

def create_user(user_id: str, email: str, display_name: str = None) -> str:
    """Create new user document in Firestore"""
    db = get_db()
    user_ref = db.collection('users').document(user_id)
    user_ref.set({
        'email': email,
        'displayName': display_name,
        'canvasApiUrl': None,
        'canvasApiTokenEncrypted': None,
        'canvasCredentialKey': None,
        # UI preferences (synced across browsers/devices)
        # Keys are Canvas course id strings; values are hex colors / booleans.
        'courseColors': {},
        'starredCourses': {},
        'syncEnabledCourses': {},
        # Checklist state for assignments (keyed by assignment doc id or stable item id).
        'completedItems': {},
        'createdAt': firestore.SERVER_TIMESTAMP,
        'lastLogin': firestore.SERVER_TIMESTAMP
    })
    print(f"[OK] Created user: {user_id} ({email})")
    return user_id


def get_user(user_id: str) -> Optional[Dict]:
    """Get user document by Firebase UID"""
    db = get_db()
    user_ref = db.collection('users').document(user_id)
    user_doc = user_ref.get()
    if user_doc.exists:
        return {'id': user_doc.id, **user_doc.to_dict()}
    return None


def update_user_last_login(user_id: str):
    """Update user's last login timestamp"""
    db = get_db()
    user_ref = db.collection('users').document(user_id)
    user_ref.update({
        'lastLogin': firestore.SERVER_TIMESTAMP
    })


def get_user_preferences(user_id: str) -> Dict[str, Any]:
    """
    Return user UI preferences that should sync across browsers/devices.
    """
    user = get_user(user_id) or {}
    return {
        "courseColors": user.get("courseColors") or {},
        "starredCourses": user.get("starredCourses") or {},
        "syncEnabledCourses": user.get("syncEnabledCourses") or {},
        "completedItems": user.get("completedItems") or {},
    }


def update_user_preferences(
    user_id: str,
    course_colors: Optional[Dict[str, str]] = None,
    starred_courses: Optional[Dict[str, bool]] = None,
    sync_enabled_courses: Optional[Dict[str, bool]] = None,
    completed_items: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    """
    Update user UI preferences.

    Important: this must support removals (e.g. un-starring a course or un-checking
    a checklist item). Firestore `set(..., merge=True)` merges map fields and will
    not delete missing keys, so we use `update(...)` to replace the full map field
    when a map is provided.

    Args:
        course_colors: map of courseId -> color hex string
        starred_courses: map of courseId -> bool
        sync_enabled_courses: map of courseId -> bool (included in batch sync)
    """
    db = get_db()
    user_ref = db.collection("users").document(user_id)

    payload: Dict[str, Any] = {"updatedAt": firestore.SERVER_TIMESTAMP}
    if course_colors is not None:
        # Replaces the full map when provided (supports removing colors by omitting keys).
        payload["courseColors"] = course_colors or {}
    if starred_courses is not None:
        # Store only truthy entries (replaces the full map; supports un-starring).
        payload["starredCourses"] = {k: True for k, v in (starred_courses or {}).items() if v}
    if sync_enabled_courses is not None:
        # Store only truthy entries (replaces the full map; supports un-selecting).
        payload["syncEnabledCourses"] = {k: True for k, v in (sync_enabled_courses or {}).items() if v}
    if completed_items is not None:
        # Store only truthy entries (replaces the full map; supports un-checking).
        payload["completedItems"] = {k: True for k, v in (completed_items or {}).items() if v}

    # IMPORTANT:
    # - `set(..., merge=True)` will merge map fields and will NOT delete removed keys.
    # - `update({...})` sets the field value and replaces the full map, so deletions work.
    try:
        user_ref.update(payload)
    except Exception as e:
        msg = str(e) or ""
        if "404" in msg or "NotFound" in msg or "not found" in msg.lower():
            user_ref.set(payload, merge=True)
        else:
            raise

    return get_user_preferences(user_id)


def update_user_canvas_credentials(user_id: str, api_url: str, token: str) -> str:
    """Store Canvas API credentials for a user"""
    db = get_db()
    user_ref = db.collection('users').document(user_id)
    credential_key = build_canvas_credential_key(api_url, token)
    stored_token = encrypt_canvas_token(token)
    user_ref.update({
        'canvasApiUrl': api_url,
        'canvasApiTokenEncrypted': stored_token,
        'canvasCredentialKey': credential_key,
        'updatedAt': firestore.SERVER_TIMESTAMP
    })
    return credential_key


def get_user_canvas_credentials(user_id: str) -> Optional[Dict]:
    """Get user's Canvas API credentials"""
    db = get_db()
    user = get_user(user_id)
    if user:
        stored_token = user.get('canvasApiTokenEncrypted')
        decrypted_token = decrypt_canvas_token(stored_token)

        # Opportunistic migration: legacy plaintext -> encrypted when key is configured.
        if stored_token and decrypted_token and not str(stored_token).startswith(TOKEN_ENCRYPTION_PREFIX):
            cipher = _get_token_cipher()
            if cipher:
                db.collection('users').document(user_id).update({
                    'canvasApiTokenEncrypted': encrypt_canvas_token(decrypted_token),
                    'updatedAt': firestore.SERVER_TIMESTAMP
                })

        return {
            'api_url': user.get('canvasApiUrl'),
            # "token" is the decrypted runtime value used for Canvas API calls.
            'token': decrypted_token,
            # Backward-compatible alias for older callsites.
            'encrypted_token': decrypted_token,
            'canvas_credential_key': user.get('canvasCredentialKey')
        }
    return None


# =============================================================================
# COURSE OPERATIONS
# =============================================================================

def save_course(user_id: str, course_data: Dict, canvas_credential_key: str = None) -> str:
    """Save course to user's subcollection"""
    db = get_db()
    canvas_course_id = str(course_data.get('canvasCourseId') or course_data.get('id'))

    doc_id = f"{canvas_credential_key}_{canvas_course_id}" if canvas_credential_key else canvas_course_id
    course_ref = db.collection('users').document(user_id)\
                   .collection('courses').document(doc_id)
    
    course_ref.set({
        'courseName': course_data.get('name'),
        'courseCode': course_data.get('course_code'),
        'canvasCourseId': int(canvas_course_id) if canvas_course_id.isdigit() else canvas_course_id,
        'canvasCourseIdStr': canvas_course_id,
        'canvasCredentialKey': canvas_credential_key,
        'syncedAt': firestore.SERVER_TIMESTAMP,
        'metadata': course_data.get('metadata', {})
    }, merge=True)
    
    return course_ref.id


def save_courses_batch(user_id: str, courses: List[Dict], canvas_credential_key: str = None) -> int:
    """
    Batch-save many courses in a single (or few) Firestore commits.

    Firestore per-document writes add noticeable latency when a user has many courses.
    Using batched writes keeps /api/canvas/courses fast on reload.
    """
    if not courses:
        return 0

    db = get_db()
    user_doc = db.collection("users").document(user_id)

    # Firestore batches support up to 500 operations. Keep some margin.
    max_ops = 450
    batch = db.batch()
    ops = 0
    saved = 0

    def commit_if_needed(force: bool = False):
        nonlocal batch, ops
        if ops == 0:
            return
        if force or ops >= max_ops:
            batch.commit()
            batch = db.batch()
            ops = 0

    for course_data in courses:
        canvas_course_id = str(course_data.get("canvasCourseId") or course_data.get("id") or "").strip()
        if not canvas_course_id:
            continue

        doc_id = f"{canvas_credential_key}_{canvas_course_id}" if canvas_credential_key else canvas_course_id
        course_ref = user_doc.collection("courses").document(doc_id)

        payload = {
            "courseName": course_data.get("name"),
            "courseCode": course_data.get("course_code"),
            "canvasCourseId": int(canvas_course_id) if canvas_course_id.isdigit() else canvas_course_id,
            "canvasCourseIdStr": canvas_course_id,
            "canvasCredentialKey": canvas_credential_key,
            "syncedAt": firestore.SERVER_TIMESTAMP,
            "metadata": course_data.get("metadata", {}),
        }
        batch.set(course_ref, payload, merge=True)
        ops += 1
        saved += 1
        commit_if_needed()

    commit_if_needed(force=True)
    return saved


def get_user_courses(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get all courses for a user"""
    db = get_db()
    courses_ref = db.collection('users').document(user_id).collection('courses')
    query = courses_ref
    if canvas_credential_key:
        query = query.where('canvasCredentialKey', '==', canvas_credential_key)
    courses = query.stream()
    return [{'id': doc.id, **doc.to_dict()} for doc in courses]


def get_course(user_id: str, course_id: str, canvas_credential_key: str = None) -> Optional[Dict]:
    """Get single course by ID"""
    db = get_db()
    courses_ref = db.collection('users').document(user_id).collection('courses')
    query = courses_ref.where('canvasCourseIdStr', '==', str(course_id))
    for course_doc in query.stream():
        data = course_doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        return {'id': course_doc.id, **data}
    return None


def update_course_metadata(user_id: str, course_id: str, course_code: str, canvas_credential_key: str = None):
    """Update course metadata (like AI-extracted course code)"""
    db = get_db()
    courses_ref = db.collection('users').document(user_id).collection('courses')
    query = courses_ref.where('canvasCourseIdStr', '==', str(course_id))
    for course_doc in query.stream():
        data = course_doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        course_doc.reference.update({
            'courseCode': course_code,
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        return


# =============================================================================
# ASSIGNMENT OPERATIONS
# =============================================================================

def save_assignment(user_id: str, course_id: str, assignment_data: Dict, canvas_credential_key: str = None) -> str:
    """Save assignment to user's subcollection"""
    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    
    # Create compound document ID for uniqueness
    canvas_id = assignment_data.get('canvas_assignment_id') or assignment_data.get('canvasAssignmentId')
    existing_doc_id = str(
        assignment_data.get("existing_doc_id")
        or assignment_data.get("existingDocId")
        or ""
    ).strip()
    discovered_key = str(
        assignment_data.get("discovered_key")
        or assignment_data.get("discoveredKey")
        or ""
    ).strip().lower()
    doc_id = existing_doc_id

    if not doc_id:
        if canvas_id:
            base_doc_id = f"{course_id}_{canvas_id}"
            doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
        elif discovered_key:
            # Reuse any existing discovered doc with this semantic key before falling back.
            # Query by discoveredKey first to avoid streaming all assignments in the course.
            existing_query = assignments_ref.where('discoveredKey', '==', discovered_key)
            for existing_doc in existing_query.stream():
                data = existing_doc.to_dict() or {}
                if str(data.get('courseId') or "") != str(course_id):
                    continue
                if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
                    continue
                if data.get('canvasAssignmentId') is not None:
                    continue
                if str(data.get('discoveredKey') or "").strip().lower() != discovered_key:
                    continue
                doc_id = existing_doc.id
                break
            if not doc_id:
                # Stable discovered-item id resilient to wording/category aliases.
                key_hash = hashlib.md5(discovered_key.encode("utf-8")).hexdigest()[:16]
                base_doc_id = f"{course_id}_discx_{key_hash}"
                doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
        else:
            # For discovered assignments without Canvas ID/key, use stable hash
            name = assignment_data.get('name', 'unknown')
            due_fragment = assignment_data.get('normalized_due_at') or assignment_data.get('original_due_at') or ''
            name_hash = hashlib.md5(f"{name}|{due_fragment}".encode()).hexdigest()[:12]
            base_doc_id = f"{course_id}_disc_{name_hash}"
            doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
    
    assignment_ref = assignments_ref.document(doc_id)
    
    assignment_ref.set({
        'courseId': str(course_id),
        'name': assignment_data.get('name'),
        'description': assignment_data.get('description'),
        'originalDueAt': assignment_data.get('original_due_at'),
        'normalizedDueAt': assignment_data.get('normalized_due_at'),
        'canvasAssignmentId': canvas_id,
        'sourceOfTruth': assignment_data.get('source_of_truth', 'Canvas'),
        'confidence': assignment_data.get('confidence'),
        'status': assignment_data.get('status', 'OK'),
        'category': assignment_data.get('category', 'ASSIGNMENT'),
        'deliverable': assignment_data.get('deliverable', 1),
        'rawCanvasJson': assignment_data.get('raw_canvas_json'),
        'discoveredKey': discovered_key or None,
        # Add course metadata for frontend display
        'courseName': assignment_data.get('course_name'),
        'courseCode': assignment_data.get('course_code'),
        'canvasCredentialKey': canvas_credential_key,
        'syncedAt': firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    return assignment_ref.id


def get_course_assignments(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get all assignments for a course"""
    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    query = assignments_ref.where('courseId', '==', str(course_id))
    assignments = []
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        assignments.append({'id': doc.id, **data})
    return assignments


def get_user_assignments(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """
    Get all assignments for a user.

    This is significantly faster than calling get_course_assignments() per course
    because it avoids N queries (one per course) on login/reload.
    """
    db = get_db()
    assignments_ref = db.collection("users").document(user_id).collection("assignments")
    query = assignments_ref
    if canvas_credential_key:
        query = query.where("canvasCredentialKey", "==", canvas_credential_key)
    return [{"id": doc.id, **(doc.to_dict() or {})} for doc in query.stream()]


def get_user_assignments_lite(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """
    Get a minimal assignment payload for fast startup.

    Important: exclude heavy fields (e.g., description, rawCanvasJson) which can
    make the response large and slow to parse on the client.
    """
    db = get_db()
    assignments_ref = db.collection("users").document(user_id).collection("assignments")
    query = assignments_ref
    if canvas_credential_key:
        query = query.where("canvasCredentialKey", "==", canvas_credential_key)

    # Only return fields the UI needs to render the assignment list/calendar.
    # Firestore returns only these fields over the wire.
    query = query.select([
        "courseId",
        "name",
        "originalDueAt",
        "normalizedDueAt",
        "canvasAssignmentId",
        "sourceOfTruth",
        "confidence",
        "status",
        "category",
        "deliverable",
        "discoveredKey",
        "courseName",
        "courseCode",
        "canvasCredentialKey",
        "syncedAt",
        "updatedAt",
        "createdAt",
    ])

    return [{"id": doc.id, **(doc.to_dict() or {})} for doc in query.stream()]


def get_assignment_by_canvas_id(
    user_id: str,
    course_id: str,
    canvas_assignment_id: int,
    canvas_credential_key: str = None
) -> Optional[Dict]:
    """Get assignment by Canvas assignment ID"""
    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    if canvas_credential_key:
        doc_id = f"{canvas_credential_key}_{course_id}_{canvas_assignment_id}"
        assignment_ref = assignments_ref.document(doc_id)
        assignment_doc = assignment_ref.get()
        if assignment_doc.exists:
            return {'id': assignment_doc.id, **assignment_doc.to_dict()}

    query = assignments_ref.where('courseId', '==', str(course_id))\
                           .where('canvasAssignmentId', '==', canvas_assignment_id)
    for assignment_doc in query.stream():
        data = assignment_doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        return {'id': assignment_doc.id, **data}
    return None


def update_assignment(
    user_id: str,
    course_id: str,
    canvas_assignment_id: int,
    updates: Dict,
    canvas_credential_key: str = None
):
    """Update an existing assignment"""
    db = get_db()
    updates['updatedAt'] = firestore.SERVER_TIMESTAMP
    assignments_ref = db.collection('users').document(user_id).collection('assignments')

    if canvas_credential_key:
        doc_id = f"{canvas_credential_key}_{course_id}_{canvas_assignment_id}"
        assignment_ref = assignments_ref.document(doc_id)
        assignment_doc = assignment_ref.get()
        if assignment_doc.exists:
            assignment_ref.update(updates)
            return

    query = assignments_ref.where('courseId', '==', str(course_id))\
                           .where('canvasAssignmentId', '==', canvas_assignment_id)
    for assignment_doc in query.stream():
        data = assignment_doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        assignment_doc.reference.update(updates)
        return


def delete_discovered_assignments(user_id: str, course_id: str, canvas_credential_key: str = None):
    """Delete all discovered (non-Canvas) assignments for a course to avoid duplicates"""
    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    
    # Query for discovered assignments (those without Canvas ID)
    query = assignments_ref.where('courseId', '==', str(course_id))\
                           .where('canvasAssignmentId', '==', None)
    
    batch = db.batch()
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        batch.delete(doc.reference)
    batch.commit()


def delete_assignments_by_doc_ids(
    user_id: str,
    doc_ids: List[str],
    canvas_credential_key: str = None,
) -> int:
    """
    Delete specific assignment documents by Firestore document id.
    Returns number of deleted documents.
    """
    unique_ids = []
    seen = set()
    for raw in doc_ids or []:
        doc_id = str(raw or "").strip()
        if not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        unique_ids.append(doc_id)

    if not unique_ids:
        return 0

    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    batch = db.batch()
    pending_ops = 0
    deleted = 0

    for doc_id in unique_ids:
        ref = assignments_ref.document(doc_id)
        snap = ref.get()
        if not snap.exists:
            continue
        data = snap.to_dict() or {}
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        batch.delete(ref)
        pending_ops += 1
        deleted += 1

        # Firestore batch limit is 500 operations.
        if pending_ops >= 450:
            batch.commit()
            batch = db.batch()
            pending_ops = 0

    if pending_ops > 0:
        batch.commit()

    return deleted


# =============================================================================
# COURSE FILE TEXT OPERATIONS (for schedules, syllabi, etc.)
# =============================================================================

def save_course_file_text(user_id: str, course_id: str, file_data: Dict, canvas_credential_key: str = None) -> str:
    """Save extracted text from course files"""
    db = get_db()
    
    # Create document ID from file info
    file_id = file_data.get('file_id') or abs(hash(file_data.get('file_name', '')))
    base_doc_id = f"{course_id}_{file_id}"
    doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
    
    file_ref = db.collection('users').document(user_id)\
                 .collection('courseFileText').document(doc_id)
    
    file_ref.set({
        'courseId': str(course_id),
        'canvasFileId': file_data.get('canvas_file_id'),
        'fileType': file_data.get('file_type', 'schedule'),
        'fileName': file_data.get('file_name'),
        'storagePath': file_data.get('storage_path'),
        'extractedText': file_data.get('extracted_text'),
        'canvasCredentialKey': canvas_credential_key,
        'createdAt': firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    return file_ref.id


def get_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = 'schedule',
    canvas_credential_key: str = None
) -> List[Dict]:
    """Get extracted texts for a course by file type"""
    db = get_db()
    files_ref = db.collection('users').document(user_id).collection('courseFileText')
    query = files_ref.where('courseId', '==', str(course_id))\
                     .where('fileType', '==', file_type)
    files = []
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        files.append({'id': doc.id, **data})
    return files


def delete_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = 'schedule',
    canvas_credential_key: str = None
):
    """Delete course file texts by type (for re-sync)"""
    db = get_db()
    files_ref = db.collection('users').document(user_id).collection('courseFileText')
    query = files_ref.where('courseId', '==', str(course_id))\
                     .where('fileType', '==', file_type)
    
    batch = db.batch()
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        batch.delete(doc.reference)
    batch.commit()


def archive_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = 'schedule',
    canvas_credential_key: str = None
) -> List[Dict]:
    """
    Archive (mark as previous) course file texts instead of deleting.
    Returns the list of archived files for comparison with new files.
    """
    db = get_db()
    files_ref = db.collection('users').document(user_id).collection('courseFileText')
    query = files_ref.where('courseId', '==', str(course_id))\
                     .where('fileType', '==', file_type)
    
    archived = []
    batch = db.batch()
    
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        archived.append({
            'id': doc.id,
            'fileType': data.get('fileType'),
            'fileName': data.get('fileName'),
            'storagePath': data.get('storagePath'),
            'extractedText': data.get('extractedText'),
            'createdAt': data.get('createdAt'),
            'syncVersion': data.get('syncVersion', 1)
        })
        # Mark as previous version
        batch.update(doc.reference, {
            'isPrevious': True,
            'archivedAt': firestore.SERVER_TIMESTAMP
        })
    
    batch.commit()
    return archived


def save_course_file_text_versioned(
    user_id: str,
    course_id: str,
    file_data: Dict,
    sync_version: int,
    canvas_credential_key: str = None
) -> str:
    """Save extracted text from course files with version tracking"""
    db = get_db()
    
    # Create document ID from file info and version
    file_id = file_data.get('file_id') or abs(hash(file_data.get('file_name', '')))
    base_doc_id = f"{course_id}_{file_id}_v{sync_version}"
    doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
    
    file_ref = db.collection('users').document(user_id)\
                 .collection('courseFileText').document(doc_id)
    
    file_ref.set({
        'courseId': str(course_id),
        'canvasFileId': file_data.get('canvas_file_id'),
        'fileType': file_data.get('file_type', 'schedule'),
        'fileName': file_data.get('file_name'),
        'storagePath': file_data.get('storage_path'),
        'extractedText': file_data.get('extracted_text'),
        'syncVersion': sync_version,
        'isPrevious': False,
        'canvasCredentialKey': canvas_credential_key,
        'createdAt': firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    return file_ref.id


def get_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    """Get the current sync version for a course"""
    db = get_db()
    course = get_course(user_id, course_id, canvas_credential_key)
    if course:
        return course.get('syncVersion', 0)
    return 0


def increment_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    """Increment and return the new sync version for a course"""
    db = get_db()
    courses_ref = db.collection('users').document(user_id).collection('courses')
    query = courses_ref.where('canvasCourseIdStr', '==', str(course_id))
    course_doc = None
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        course_doc = doc
        break

    current_version = course_doc.to_dict().get('syncVersion', 0) if course_doc else 0
    new_version = current_version + 1
    if course_doc:
        course_doc.reference.update({
            'syncVersion': new_version,
            'lastSyncAt': firestore.SERVER_TIMESTAMP
        })
    else:
        # Create a minimal course record if one does not exist yet.
        doc_id = f"{canvas_credential_key}_{course_id}" if canvas_credential_key else str(course_id)
        course_ref = courses_ref.document(doc_id)
        course_ref.set({
            'canvasCourseId': int(course_id) if str(course_id).isdigit() else str(course_id),
            'canvasCourseIdStr': str(course_id),
            'canvasCredentialKey': canvas_credential_key,
            'syncVersion': new_version,
            'lastSyncAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
    return new_version


def cleanup_old_file_versions(
    user_id: str,
    course_id: str,
    keep_versions: int = 2,
    canvas_credential_key: str = None
):
    """Clean up old file versions, keeping only the most recent N versions"""
    db = get_db()
    files_ref = db.collection('users').document(user_id).collection('courseFileText')
    if keep_versions < 1:
        keep_versions = 1

    # Keep current (isPrevious=False) plus the last (keep_versions-1) previous sync versions.
    course = get_course(user_id, course_id, canvas_credential_key)
    current_version = int(course.get('syncVersion', 0) or 0) if course else 0
    min_prev_version = max(1, current_version - (keep_versions - 1))

    query = files_ref.where('courseId', '==', str(course_id))\
                     .where('isPrevious', '==', True)

    batch = db.batch()
    deletes = 0
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        sv = int(data.get('syncVersion', 0) or 0)
        if sv and sv < min_prev_version:
            batch.delete(doc.reference)
            deletes += 1

    if deletes:
        batch.commit()


# =============================================================================
# ANNOUNCEMENT OPERATIONS
# =============================================================================

def save_announcement(user_id: str, announcement_data: Dict, canvas_credential_key: str = None) -> str:
    """Save Canvas announcement"""
    db = get_db()
    
    canvas_id = announcement_data.get('canvas_announcement_id')
    course_id = announcement_data.get('course_id')
    base_doc_id = f"{course_id}_{canvas_id}"
    doc_id = f"{canvas_credential_key}_{base_doc_id}" if canvas_credential_key else base_doc_id
    
    announcement_ref = db.collection('users').document(user_id)\
                         .collection('announcements').document(doc_id)
    
    announcement_ref.set({
        'courseId': str(course_id),
        'canvasAnnouncementId': canvas_id,
        'title': announcement_data.get('title'),
        'message': announcement_data.get('message'),
        'postedAt': announcement_data.get('posted_at'),
        'rawJson': announcement_data.get('raw_json'),
        'canvasCredentialKey': canvas_credential_key
    }, merge=True)
    
    return announcement_ref.id


def get_course_announcements(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get announcements for a course ordered by date"""
    db = get_db()
    announcements_ref = db.collection('users').document(user_id).collection('announcements')
    query = announcements_ref.where('courseId', '==', str(course_id))
    query = query.order_by('postedAt')
    announcements = []
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        announcements.append({'id': doc.id, **data})
    return announcements


# =============================================================================
# SYLLABUS RULES OPERATIONS
# =============================================================================

def save_syllabus_rules(
    user_id: str,
    course_id: str,
    course_name: str,
    rules_json: str,
    canvas_credential_key: str = None
) -> str:
    """Save AI-extracted syllabus rules"""
    db = get_db()
    
    rules_ref = db.collection('users').document(user_id)\
                  .collection('syllabusRules').document(
                      f"{canvas_credential_key}_{course_id}" if canvas_credential_key else str(course_id)
                  )
    
    rules_ref.set({
        'courseId': str(course_id),
        'courseName': course_name,
        'rulesJson': rules_json,
        'canvasCredentialKey': canvas_credential_key,
        'extractedAt': firestore.SERVER_TIMESTAMP
    }, merge=True)
    
    return rules_ref.id


def get_syllabus_rules(user_id: str, course_id: str, canvas_credential_key: str = None) -> Optional[Dict]:
    """Get syllabus rules for a course"""
    db = get_db()
    rules_ref = db.collection('users').document(user_id).collection('syllabusRules')
    query = rules_ref.where('courseId', '==', str(course_id))
    for rules_doc in query.stream():
        data = rules_doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        return {'id': rules_doc.id, **data}
    return None


# =============================================================================
# READING ITEMS OPERATIONS (legacy support)
# =============================================================================

def get_reading_items(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get reading/lecture items for a course (from assignments with category READING/LECTURE)"""
    db = get_db()
    assignments_ref = db.collection('users').document(user_id).collection('assignments')
    
    # Query for non-deliverable items
    query = assignments_ref.where('courseId', '==', str(course_id))\
                           .where('deliverable', '==', 0)
    
    items = []
    for doc in query.stream():
        data = doc.to_dict()
        if canvas_credential_key and data.get('canvasCredentialKey') != canvas_credential_key:
            continue
        category = data.get('category', '')
        if category in ('LECTURE', 'READING', 'ATTENDANCE') and category != 'PLACEHOLDER':
            items.append({
                'name': data.get('name'),
                'details': data.get('description'),
                'dueAt': data.get('normalizedDueAt')
            })
    
    # Sort by due date
    items.sort(key=lambda x: x.get('dueAt') or '')
    return items


# =============================================================================
# AI USAGE LOG OPERATIONS
# =============================================================================

def save_ai_usage_log(
    user_id: str,
    log_data: Dict[str, Any],
    canvas_credential_key: str = None
) -> str:
    """
    Persist a single Gemini usage event for later inspection.
    """
    db = get_db()
    logs_ref = db.collection("users").document(user_id).collection("aiUsageLogs")
    doc_ref = logs_ref.document()

    payload = {
        "courseId": str(log_data.get("course_id") or ""),
        "requestId": str(log_data.get("request_id") or ""),
        "operation": str(log_data.get("operation") or ""),
        "model": str(log_data.get("model") or ""),
        "inputTokens": int(log_data.get("input_tokens") or 0),
        "outputTokens": int(log_data.get("output_tokens") or 0),
        "totalTokens": int(log_data.get("total_tokens") or 0),
        "cachedTokens": int(log_data.get("cached_tokens") or 0),
        "estimatedCostUsd": float(log_data.get("estimated_cost_usd") or 0.0),
        "currency": str(log_data.get("currency") or "USD"),
        "pricingSource": str(log_data.get("pricing_source") or "unconfigured"),
        "status": str(log_data.get("status") or "ok"),
        "promptChars": int(log_data.get("prompt_chars") or 0),
        "canvasCredentialKey": canvas_credential_key,
        "createdAt": firestore.SERVER_TIMESTAMP,
        # Keep a raw payload copy for debugging/audit.
        "rawJson": json.dumps(log_data or {}, ensure_ascii=True),
    }

    if log_data.get("is_resync") is not None:
        payload["isResync"] = bool(log_data.get("is_resync"))

    doc_ref.set(payload)
    return doc_ref.id


def get_ai_usage_logs(
    user_id: str,
    *,
    limit: int = 50,
    course_id: str = None,
    canvas_credential_key: str = None
) -> List[Dict[str, Any]]:
    """
    Return latest Gemini usage log entries for a user.
    """
    db = get_db()
    logs_ref = db.collection("users").document(user_id).collection("aiUsageLogs")

    try:
        requested_limit = int(limit or 50)
    except (TypeError, ValueError):
        requested_limit = 50
    requested_limit = max(1, min(requested_limit, 200))

    # Pull a larger window and filter in Python to avoid composite index requirements.
    query = logs_ref.order_by("createdAt", direction=firestore.Query.DESCENDING).limit(max(20, requested_limit * 3))

    logs: List[Dict[str, Any]] = []
    target_course_id = str(course_id) if course_id is not None else None
    for doc in query.stream():
        data = doc.to_dict() or {}

        if target_course_id and str(data.get("courseId") or "") != target_course_id:
            continue
        if canvas_credential_key and data.get("canvasCredentialKey") != canvas_credential_key:
            continue

        created_at = data.get("createdAt")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        else:
            created_at = str(created_at) if created_at is not None else None

        raw_data = {}
        raw_json = data.get("rawJson")
        if raw_json:
            try:
                raw_data = json.loads(raw_json)
            except Exception:
                raw_data = {}

        logs.append({
            "id": doc.id,
            "courseId": data.get("courseId"),
            "requestId": data.get("requestId"),
            "operation": data.get("operation"),
            "model": data.get("model"),
            "inputTokens": int(data.get("inputTokens") or 0),
            "outputTokens": int(data.get("outputTokens") or 0),
            "totalTokens": int(data.get("totalTokens") or 0),
            "cachedTokens": int(data.get("cachedTokens") or 0),
            "estimatedCostUsd": float(data.get("estimatedCostUsd") or 0.0),
            "currency": data.get("currency") or "USD",
            "pricingSource": data.get("pricingSource") or "unconfigured",
            "status": data.get("status") or "ok",
            "promptChars": int(data.get("promptChars") or 0),
            "isResync": bool(data.get("isResync")) if data.get("isResync") is not None else None,
            "createdAt": created_at,
            "raw": raw_data,
        })

        if len(logs) >= requested_limit:
            break

    return logs


# =============================================================================
# INITIALIZATION (for development/testing)
# =============================================================================

def init_db():
    """
    Initialize Firestore (analogous to old SQLite init_db).
    With Firestore, collections are created automatically when documents are added.
    This function just ensures Firebase is initialized and token encryption is configured.
    """
    init_firebase()
    ensure_token_encryption_configured()
    logger.info("Firestore database ready (collections created on first write)")


if __name__ == "__main__":
    init_db()
    logger.info("Firestore connection test successful!")

