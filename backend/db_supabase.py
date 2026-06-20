# Supabase (Postgres) Database Adapter
# Cloud-mode data access for CanvasSync (Supabase Postgres + RLS deny-all).

import logging
import os
import uuid
import hashlib
import base64
import json
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Any

from cryptography.fernet import Fernet, InvalidToken
from supabase import create_client, Client

from app_config import IS_PRODUCTION

logger = logging.getLogger(__name__)

_supabase_client: Optional[Client] = None
_initialized = False
TOKEN_ENCRYPTION_PREFIX = "enc:v1:"
_DEV_LEGAL_CONSENTS: Dict[str, Dict[str, str]] = {}


def _is_legal_consent_schema_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return (
        "legal_consent" in message
        and ("schema cache" in message or "column" in message or "pgrst204" in message)
    )


# =============================================================================
# TOKEN ENCRYPTION
# =============================================================================

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
        if len(key_bytes) == 32:
            return Fernet(base64.urlsafe_b64encode(key_bytes))
        raise ValueError(
            "Invalid CANVAS_TOKEN_ENCRYPTION_KEY. Provide a Fernet key or raw 32-byte key."
        )


def ensure_token_encryption_configured():
    """Fail fast if encryption key is missing/invalid."""
    _get_token_cipher(required=True)


def encrypt_canvas_token(token: str) -> str:
    """Encrypt Canvas token for storage. No plaintext fallback."""
    if not token:
        return token
    cipher = _get_token_cipher(required=True)
    ciphertext = cipher.encrypt(token.encode("utf-8")).decode("utf-8")
    return f"{TOKEN_ENCRYPTION_PREFIX}{ciphertext}"


def decrypt_canvas_token(stored_value: str) -> Optional[str]:
    """
    Decrypt stored Canvas token value.
    Legacy plaintext values are returned as-is.
    """
    if not stored_value:
        return stored_value

    if not str(stored_value).startswith(TOKEN_ENCRYPTION_PREFIX):
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


# =============================================================================
# INITIALIZATION
# =============================================================================

def get_db() -> Client:
    """Return the initialized Supabase client."""
    global _supabase_client
    if _supabase_client is None:
        init_db()
    return _supabase_client


def now_iso() -> str:
    """Return current UTC timestamp as ISO string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def normalize_canvas_url(api_url: str) -> str:
    """Normalize Canvas base URL for stable token scoping."""
    return (api_url or "").strip().lower().rstrip("/")


def build_canvas_account_key(api_url: str, canvas_user_id: str) -> str:
    """
    Build a stable, non-reversible key identifying a Canvas *account* (a given
    Canvas user on a given instance). This is the correct scope for user data.

    Crucially this depends ONLY on stable identifiers (instance URL + Canvas
    user id), never on the OAuth access token. Access tokens rotate roughly
    hourly; deriving the data-scoping key from the token (the previous design)
    orphaned every row on each refresh. See docs/OIT_READINESS_AUDIT.md (R2).
    """
    raw = f"{normalize_canvas_url(api_url)}|{(str(canvas_user_id) or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def build_canvas_credential_key(api_url: str, token: str) -> str:
    """
    DEPRECATED token-derived scope key. Retained only so the one-time migration
    can recompute/repair historical rows. Do NOT use for new scoping; use
    build_canvas_account_key() instead.
    """
    raw = f"{normalize_canvas_url(api_url)}|{(token or '').strip()}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:24]


def delete_all_user_data(user_id: str) -> None:
    """
    Revoke Canvas OAuth tokens, delete storage objects, and delete the user row
    (cascades to all child tables). Also clears rate-limit buckets.
    """
    from canvas_token_service import revoke_canvas_tokens

    revoke_canvas_tokens(user_id)
    try:
        from storage import delete_user_storage
        delete_user_storage(user_id)
    except Exception as exc:
        logger.warning("Storage purge on account deletion failed: %s", type(exc).__name__)
    db = get_db()
    db.table("rate_limits").delete().eq("user_id", user_id).execute()
    db.table("users").delete().eq("id", user_id).execute()
    logger.info("Deleted all stored data for one user account")


def _sanitize_export_row(table: str, row: Dict[str, Any]) -> Dict[str, Any]:
    """Strip debug/raw payloads from export unless explicitly enabled in production."""
    from app_config import STORE_RAW_CANVAS_JSON

    cleaned = dict(row)
    if not STORE_RAW_CANVAS_JSON:
        cleaned.pop("raw_canvas_json", None)
        cleaned.pop("raw_json", None)
    return cleaned


def export_all_user_data(user_id: str) -> Dict[str, Any]:
    """
    Assemble a portable export of everything we store about a user (data
    portability / right of access). Excludes encrypted Canvas token material —
    secrets are never exported. See docs/OIT_READINESS_AUDIT.md (R7).
    """
    db = get_db()

    user = get_user(user_id) or {}
    # Safe profile subset (no token ciphertext, no internal encryption columns).
    profile = {
        "id": user.get("id"),
        "email": user.get("email"),
        "name": user.get("name"),
        "canvas_user_id": user.get("canvasUserId"),
        "canvas_api_url": user.get("canvasApiUrl"),
        "legal_consent_at": user.get("legalConsentAt"),
        "legal_consent_version": user.get("legalConsentVersion"),
        "created_at": user.get("createdAt"),
    }

    export: Dict[str, Any] = {
        "exported_at": now_iso(),
        "schema": "canvassync.user_export.v1",
        "profile": profile,
        "preferences": get_user_preferences(user_id),
    }

    for table in ("courses", "assignments", "announcements",
                  "course_file_texts", "syllabus_rules"):
        try:
            rows = db.table(table).select("*").eq("user_id", user_id).execute().data or []
        except Exception as exc:
            logger.warning("User export failed to read %s: %s", table, type(exc).__name__)
            rows = []
        export[table] = [_sanitize_export_row(table, row) for row in rows]

    return export


def init_db():
    """
    Initialize Supabase client + validate token encryption config.
    Safe to call multiple times.
    """
    global _supabase_client, _initialized
    if _initialized:
        return

    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not url or not key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required."
        )

    _supabase_client = create_client(url, key)
    ensure_token_encryption_configured()
    _initialized = True
    logger.info("Supabase database ready")


# =============================================================================
# RATE LIMITING
# =============================================================================

def consume_hourly_rate_limit(user_id: str, limit_key: str, limit_per_hour: int) -> Dict[str, Any]:
    """
    Atomically consume one unit from a user's hourly rate limit bucket.
    Uses upsert with ON CONFLICT to achieve atomicity.
    """
    if limit_per_hour <= 0:
        raise ValueError("limit_per_hour must be greater than 0.")

    db = get_db()
    now = datetime.now(timezone.utc)
    window_start = now.replace(minute=0, second=0, microsecond=0)
    window_end = window_start + timedelta(hours=1)
    bucket_id = window_start.strftime("%Y%m%d%H")
    window_iso = window_start.strftime("%Y-%m-%dT%H:%M:%SZ")

    max_retries = 5
    next_count = 1
    increment_succeeded = False
    for _ in range(max_retries):
        existing = (
            db.table("rate_limits")
            .select("id, count")
            .eq("user_id", user_id)
            .eq("limit_key", limit_key)
            .eq("time_window", window_iso)
            .eq("bucket_id", bucket_id)
            .limit(1)
            .execute()
        )

        current_count = 0
        row_exists = False
        row_id = None
        if existing.data:
            row_exists = True
            current_count = int(existing.data[0].get("count") or 0)
            row_id = existing.data[0]["id"]

        if current_count >= limit_per_hour:
            retry_after_seconds = max(1, int((window_end - now).total_seconds()))
            return {
                "allowed": False,
                "count": current_count,
                "limit": limit_per_hour,
                "retry_after_seconds": retry_after_seconds,
                "window_start": window_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "window_end": window_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }

        next_count = current_count + 1
        now_ts = now_iso()

        if row_exists:
            # Optimistic CAS update avoids lost updates under concurrency.
            update_resp = (
                db.table("rate_limits")
                .update({"count": next_count, "updated_at": now_ts})
                .eq("id", row_id)
                .eq("count", current_count)
                .execute()
            )
            if update_resp.data:
                increment_succeeded = True
                break
        else:
            try:
                insert_resp = db.table("rate_limits").insert({
                    "user_id": user_id,
                    "limit_key": limit_key,
                    "time_window": window_iso,
                    "bucket_id": bucket_id,
                    "count": next_count,
                    "limit_value": limit_per_hour,
                    "created_at": now_ts,
                    "updated_at": now_ts,
                }).execute()
                if insert_resp.data:
                    increment_succeeded = True
                    break
            except Exception:
                # Another request likely inserted this bucket first; retry read/update.
                continue

    if not increment_succeeded:
        retry_after_seconds = max(1, int((window_end - now).total_seconds()))
        return {
            "allowed": False,
            "count": limit_per_hour,
            "limit": limit_per_hour,
            "retry_after_seconds": retry_after_seconds,
            "window_start": window_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "window_end": window_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }

    retry_after_seconds = max(1, int((window_end - now).total_seconds()))
    return {
        "allowed": True,
        "count": next_count,
        "limit": limit_per_hour,
        "retry_after_seconds": retry_after_seconds,
        "window_start": window_start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window_end": window_end.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


def consume_sync_spacing(user_id: str, min_seconds: int) -> Dict[str, Any]:
    """
    Distributed minimum spacing between course syncs. Allows at most one sync per
    `min_seconds` window, recorded in the shared rate_limits table so the limit
    holds across autoscaled instances (replacing the old per-process dict). R9.
    """
    if not min_seconds or min_seconds <= 0:
        return {"allowed": True, "retry_after_seconds": 0}

    db = get_db()
    now = datetime.now(timezone.utc)
    epoch = int(now.timestamp())
    bucket = epoch - (epoch % int(min_seconds))
    retry_after = max(1, (bucket + int(min_seconds)) - epoch)
    window_iso = datetime.fromtimestamp(bucket, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    bucket_id = f"spacing-{bucket}"
    limit_key = "course_sync_spacing"
    now_ts = now_iso()

    existing = (
        db.table("rate_limits")
        .select("id")
        .eq("user_id", user_id)
        .eq("limit_key", limit_key)
        .eq("bucket_id", bucket_id)
        .limit(1)
        .execute()
    )
    if existing.data:
        return {"allowed": False, "retry_after_seconds": retry_after}

    try:
        resp = db.table("rate_limits").insert({
            "user_id": user_id,
            "limit_key": limit_key,
            "time_window": window_iso,
            "bucket_id": bucket_id,
            "count": 1,
            "limit_value": 1,
            "created_at": now_ts,
            "updated_at": now_ts,
        }).execute()
        if resp.data:
            return {"allowed": True, "retry_after_seconds": 0}
    except Exception:
        # Unique-constraint collision: another instance won this window.
        return {"allowed": False, "retry_after_seconds": retry_after}

    return {"allowed": False, "retry_after_seconds": retry_after}


# =============================================================================
# USER OPERATIONS
# =============================================================================

def create_user(user_id: str, email: str, display_name: str = None) -> str:
    """Create new user row. Returns user UUID as string."""
    db = get_db()
    now_ts = now_iso()
    row_id = str(uuid.uuid4())

    db.table("users").insert({
        "id": row_id,
        "canvas_user_id": user_id,
        "email": email,
        "display_name": display_name,
        "course_colors": {},
        "starred_courses": {},
        "sync_enabled_courses": {},
        "completed_items": {},
        "created_at": now_ts,
        "last_login": now_ts,
    }).execute()

    logger.info("Created one user account")
    return row_id


def get_user(user_id: str) -> Optional[Dict]:
    """Get user by primary id or canvas_user_id."""
    db = get_db()
    resp = db.table("users").select("*").eq("id", user_id).limit(1).execute()
    if resp.data:
        row = resp.data[0]
        return _user_row_to_dict(row)
    resp = db.table("users").select("*").eq("canvas_user_id", user_id).limit(1).execute()
    if resp.data:
        row = resp.data[0]
        return _user_row_to_dict(row)
    return None


def upsert_user_with_id(user_id: str, email: str, display_name: str = None) -> str:
    """Upsert a user row using a fixed UUID primary key (demo accounts)."""
    db = get_db()
    now_ts = now_iso()
    existing = get_user(user_id)
    if existing:
        db.table("users").update(
            {
                "email": email,
                "display_name": display_name,
                "last_login": now_ts,
                "updated_at": now_ts,
            }
        ).eq("id", str(existing["id"])).execute()
        return str(existing["id"])

    db.table("users").insert(
        {
            "id": user_id,
            "canvas_user_id": user_id,
            "email": email,
            "display_name": display_name,
            "course_colors": {},
            "starred_courses": {},
            "sync_enabled_courses": {},
            "completed_items": {},
            "created_at": now_ts,
            "last_login": now_ts,
            "updated_at": now_ts,
        }
    ).execute()
    return user_id


def _user_row_to_dict(row: Dict) -> Dict:
    """Map Postgres snake_case user row to the dict shape app.py expects."""
    return {
        "id": str(row["id"]),
        "canvasUserId": row.get("canvas_user_id"),
        "canvasInstanceUrl": row.get("canvas_instance_url"),
        "email": row.get("email"),
        "displayName": row.get("display_name"),
        "avatarUrl": row.get("avatar_url"),
        "canvasApiUrl": row.get("canvas_api_url"),
        "canvasApiTokenEncrypted": row.get("canvas_api_token_encrypted"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
        "canvasAccessTokenEncrypted": row.get("canvas_access_token_encrypted"),
        "canvasRefreshTokenEncrypted": row.get("canvas_refresh_token_encrypted"),
        "canvasTokenExpiresAt": row.get("canvas_token_expires_at"),
        "courseColors": row.get("course_colors") or {},
        "starredCourses": row.get("starred_courses") or {},
        "syncEnabledCourses": row.get("sync_enabled_courses") or {},
        "completedItems": row.get("completed_items") or {},
        "legalConsentAt": row.get("legal_consent_at"),
        "legalConsentVersion": row.get("legal_consent_version"),
        "sessionVersion": row.get("session_version", 0),
        "createdAt": row.get("created_at"),
        "lastLogin": row.get("last_login"),
        "updatedAt": row.get("updated_at"),
    }


LEGAL_CONSENT_VERSION = os.getenv("LEGAL_CONSENT_VERSION", "2026-06-19")


def user_has_legal_consent(user_id: str) -> bool:
    dev_record = _DEV_LEGAL_CONSENTS.get(str(user_id))
    if dev_record:
        recorded = (dev_record.get("legal_consent_version") or "").strip()
        if dev_record.get("legal_consent_at") and recorded == LEGAL_CONSENT_VERSION:
            return True

    user = get_user(user_id)
    if not user:
        return False
    if not user.get("legalConsentAt"):
        return False
    recorded = (user.get("legalConsentVersion") or "").strip()
    return recorded == LEGAL_CONSENT_VERSION


def get_user_session_version(user_id: str) -> int:
    user = get_user(user_id)
    if not user:
        # A deleted or unknown user must never validate an old sv=0 JWT.
        return -1
    try:
        return int(user.get("sessionVersion") or 0)
    except (TypeError, ValueError):
        return 0


def increment_user_session_version(user_id: str) -> int:
    """Bump session version to invalidate all outstanding session JWTs."""
    db = get_db()
    current = get_user_session_version(user_id)
    new_version = current + 1
    db.table("users").update({
        "session_version": new_version,
        "updated_at": now_iso(),
    }).eq("id", user_id).execute()
    return new_version


def record_user_legal_consent(user_id: str, version: str = None) -> Dict[str, Any]:
    db = get_db()
    now_ts = now_iso()
    consent_version = (version or LEGAL_CONSENT_VERSION).strip()
    record = {
        "legal_consent_at": now_ts,
        "legal_consent_version": consent_version,
    }
    try:
        db.table("users").update({
            "legal_consent_at": now_ts,
            "legal_consent_version": consent_version,
            "updated_at": now_ts,
        }).eq("id", user_id).execute()
    except Exception as exc:
        if not IS_PRODUCTION and _is_legal_consent_schema_error(exc):
            logger.warning(
                "Supabase users table is missing legal consent columns; using an in-memory "
                "development fallback. Apply backend/migrations/004_user_legal_consent.sql "
                "before production."
            )
            _DEV_LEGAL_CONSENTS[str(user_id)] = record
            return record
        raise

    _DEV_LEGAL_CONSENTS[str(user_id)] = record
    return record


def update_user_last_login(user_id: str):
    """Update user's last login timestamp."""
    db = get_db()
    db.table("users").update({"last_login": now_iso()}).eq("id", user_id).execute()


def get_user_preferences(user_id: str) -> Dict[str, Any]:
    """Return user UI preferences."""
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
    """Update user UI preferences. Replaces the full JSONB field when provided."""
    db = get_db()
    payload: Dict[str, Any] = {"updated_at": now_iso()}

    if course_colors is not None:
        payload["course_colors"] = course_colors or {}
    if starred_courses is not None:
        payload["starred_courses"] = {k: True for k, v in (starred_courses or {}).items() if v}
    if sync_enabled_courses is not None:
        payload["sync_enabled_courses"] = {k: True for k, v in (sync_enabled_courses or {}).items() if v}
    if completed_items is not None:
        payload["completed_items"] = {k: True for k, v in (completed_items or {}).items() if v}

    db.table("users").update(payload).eq("id", user_id).execute()
    return get_user_preferences(user_id)


def update_user_canvas_credentials(user_id: str, api_url: str, token: str) -> str:
    """Store Canvas API credentials for a user (legacy PAT path — dev only)."""
    db = get_db()
    user = get_user(user_id) or {}
    credential_key = user.get("canvasCredentialKey") or build_canvas_account_key(
        api_url, user.get("canvasUserId") or user_id
    )
    stored_token = encrypt_canvas_token(token)

    db.table("users").update({
        "canvas_api_url": api_url,
        "canvas_api_token_encrypted": stored_token,
        "canvas_credential_key": credential_key,
        "updated_at": now_iso(),
    }).eq("id", user_id).execute()

    return credential_key


def update_user_canvas_oauth_credentials(
    user_id: str,
    api_url: str,
    access_token: str,
    refresh_token: str = None,
    expires_at: str = None,
) -> str:
    """
    Persist Canvas OAuth credentials so OAuth login alone can sync data.
    """
    db = get_db()
    # Stable account-scoped key: derive from the Canvas account identity, not
    # the rotating access token. Reuse the existing key if already set so it
    # never changes across token refreshes.
    existing = get_user(user_id) or {}
    credential_key = existing.get("canvasCredentialKey") or build_canvas_account_key(
        api_url, existing.get("canvasUserId") or user_id
    )
    stored_access_token = encrypt_canvas_token(access_token)
    stored_refresh_token = encrypt_canvas_token(refresh_token) if refresh_token else None

    payload = {
        "canvas_api_url": api_url,
        "canvas_api_token_encrypted": stored_access_token,
        "canvas_credential_key": credential_key,
        "canvas_access_token_encrypted": stored_access_token,
        "updated_at": now_iso(),
    }
    if stored_refresh_token:
        payload["canvas_refresh_token_encrypted"] = stored_refresh_token
    if expires_at:
        payload["canvas_token_expires_at"] = expires_at

    db.table("users").update(payload).eq("id", user_id).execute()
    return credential_key


def get_user_canvas_credentials(user_id: str) -> Optional[Dict]:
    """Get user's Canvas API credentials."""
    db = get_db()
    user = get_user(user_id)
    if not user:
        return None

    stored_token = user.get("canvasApiTokenEncrypted")
    decrypted_token = decrypt_canvas_token(stored_token)

    # Opportunistic migration: legacy plaintext -> encrypted when key is configured.
    if stored_token and decrypted_token and not str(stored_token).startswith(TOKEN_ENCRYPTION_PREFIX):
        cipher = _get_token_cipher()
        if cipher:
            db.table("users").update({
                "canvas_api_token_encrypted": encrypt_canvas_token(decrypted_token),
                "updated_at": now_iso(),
            }).eq("id", user_id).execute()

    return {
        "api_url": user.get("canvasApiUrl"),
        "token": decrypted_token,
        "encrypted_token": decrypted_token,
        "canvas_credential_key": user.get("canvasCredentialKey"),
    }


# =============================================================================
# COURSE OPERATIONS
# =============================================================================

def save_course(user_id: str, course_data: Dict, canvas_credential_key: str = None) -> str:
    """Save/upsert a course row. Returns the row id."""
    db = get_db()
    canvas_course_id = str(course_data.get("canvasCourseId") or course_data.get("id") or "").strip()
    if not canvas_course_id:
        raise ValueError("course_data must include id or canvasCourseId")

    payload = {
        "user_id": user_id,
        "canvas_course_id": canvas_course_id,
        "canvas_course_id_str": canvas_course_id,
        "course_name": course_data.get("name"),
        "course_code": course_data.get("course_code"),
        "canvas_credential_key": canvas_credential_key,
        "metadata": course_data.get("metadata", {}),
        "synced_at": now_iso(),
    }

    # Upsert on unique constraint (user_id, canvas_credential_key, canvas_course_id)
    resp = (
        db.table("courses")
        .upsert(payload, on_conflict="user_id,canvas_credential_key,canvas_course_id")
        .execute()
    )

    if resp.data:
        return str(resp.data[0]["id"])
    return ""


def save_courses_batch(user_id: str, courses: List[Dict], canvas_credential_key: str = None) -> int:
    """Batch-save many courses in one upsert call."""
    if not courses:
        return 0

    db = get_db()
    now_ts = now_iso()
    rows = []

    for course_data in courses:
        canvas_course_id = str(course_data.get("canvasCourseId") or course_data.get("id") or "").strip()
        if not canvas_course_id:
            continue
        canvas_course_id_int = int(canvas_course_id) if canvas_course_id.isdigit() else None

        rows.append({
            "user_id": user_id,
            "canvas_course_id": canvas_course_id_int,
            "canvas_course_id_str": canvas_course_id,
            "course_name": course_data.get("name"),
            "course_code": course_data.get("course_code"),
            "canvas_credential_key": canvas_credential_key,
            "metadata": course_data.get("metadata", {}),
            "synced_at": now_ts,
        })

    if not rows:
        return 0

    db.table("courses").upsert(
        rows, on_conflict="user_id,canvas_credential_key,canvas_course_id"
    ).execute()

    return len(rows)


def get_user_courses(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get all courses for a user."""
    db = get_db()
    query = db.table("courses").select("*").eq("user_id", user_id)
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return [_course_row_to_dict(r) for r in (resp.data or [])]


def get_course(user_id: str, course_id: str, canvas_credential_key: str = None) -> Optional[Dict]:
    """Get single course by canvas_course_id_str."""
    db = get_db()
    query = (
        db.table("courses")
        .select("*")
        .eq("user_id", user_id)
        .eq("canvas_course_id_str", str(course_id))
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.limit(1).execute()
    if resp.data:
        return _course_row_to_dict(resp.data[0])
    return None


def update_course_metadata(user_id: str, course_id: str, course_code: str, canvas_credential_key: str = None):
    """Update course metadata (e.g. AI-extracted course code)."""
    db = get_db()
    query = (
        db.table("courses")
        .update({"course_code": course_code, "updated_at": now_iso()})
        .eq("user_id", user_id)
        .eq("canvas_course_id_str", str(course_id))
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    query.execute()


def _course_row_to_dict(row: Dict) -> Dict:
    """Map Postgres course row to camelCase dict."""
    return {
        "id": str(row["id"]),
        "courseName": row.get("course_name"),
        "courseCode": row.get("course_code"),
        "canvasCourseId": row.get("canvas_course_id"),
        "canvasCourseIdStr": row.get("canvas_course_id_str"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
        "metadata": row.get("metadata") or {},
        "syncVersion": row.get("sync_version") or 0,
        "lastSyncAt": row.get("last_sync_at"),
        "syncedAt": row.get("synced_at"),
        "updatedAt": row.get("updated_at"),
    }


# =============================================================================
# ASSIGNMENT OPERATIONS
# =============================================================================

def save_assignment(user_id: str, course_id: str, assignment_data: Dict, canvas_credential_key: str = None) -> str:
    """Save/upsert an assignment. Returns the row id."""
    db = get_db()

    canvas_id = assignment_data.get("canvas_assignment_id") or assignment_data.get("canvasAssignmentId")
    discovered_key = str(
        assignment_data.get("discovered_key") or assignment_data.get("discoveredKey") or ""
    ).strip().lower() or None

    # Check for existing row to decide insert vs update
    existing_doc_id = str(
        assignment_data.get("existing_doc_id") or assignment_data.get("existingDocId") or ""
    ).strip()

    existing_row = None
    if existing_doc_id:
        resp = db.table("assignments").select("id").eq("id", existing_doc_id).limit(1).execute()
        if resp.data:
            existing_row = resp.data[0]
    elif canvas_id:
        q = (
            db.table("assignments")
            .select("id")
            .eq("user_id", user_id)
            .eq("course_id", str(course_id))
            .eq("canvas_assignment_id", canvas_id)
        )
        if canvas_credential_key:
            q = q.eq("canvas_credential_key", canvas_credential_key)
        resp = q.limit(1).execute()
        if resp.data:
            existing_row = resp.data[0]
    elif discovered_key:
        q = (
            db.table("assignments")
            .select("id")
            .eq("user_id", user_id)
            .eq("course_id", str(course_id))
            .eq("discovered_key", discovered_key)
            .is_("canvas_assignment_id", "null")
        )
        if canvas_credential_key:
            q = q.eq("canvas_credential_key", canvas_credential_key)
        resp = q.limit(1).execute()
        if resp.data:
            existing_row = resp.data[0]

    now_ts = now_iso()
    payload = {
        "user_id": user_id,
        "course_id": str(course_id),
        "name": assignment_data.get("name"),
        "description": assignment_data.get("description"),
        "original_due_at": assignment_data.get("original_due_at"),
        "normalized_due_at": assignment_data.get("normalized_due_at"),
        "canvas_assignment_id": canvas_id,
        "source_of_truth": assignment_data.get("source_of_truth", "Canvas"),
        "confidence": assignment_data.get("confidence"),
        "status": assignment_data.get("status", "OK"),
        "category": assignment_data.get("category", "ASSIGNMENT"),
        "deliverable": assignment_data.get("deliverable", 1),
        "raw_canvas_json": assignment_data.get("raw_canvas_json"),
        "discovered_key": discovered_key,
        "course_name": assignment_data.get("course_name"),
        "course_code": assignment_data.get("course_code"),
        "canvas_credential_key": canvas_credential_key,
        "synced_at": now_ts,
        "updated_at": now_ts,
    }

    if existing_row:
        row_id = str(existing_row["id"])
        db.table("assignments").update(payload).eq("id", row_id).execute()
        return row_id
    else:
        payload["created_at"] = now_ts
        resp = db.table("assignments").insert(payload).execute()
        if resp.data:
            return str(resp.data[0]["id"])
        return ""


def get_course_assignments(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get all assignments for a course."""
    db = get_db()
    query = (
        db.table("assignments")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return [_assignment_row_to_dict(r) for r in (resp.data or [])]


def get_user_assignments(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get all assignments for a user."""
    db = get_db()
    query = db.table("assignments").select("*").eq("user_id", user_id)
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return [_assignment_row_to_dict(r) for r in (resp.data or [])]


def get_user_assignments_lite(user_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get minimal assignment payload for fast startup (excludes heavy fields)."""
    db = get_db()
    lite_columns = (
        "id,user_id,course_id,name,original_due_at,normalized_due_at,"
        "canvas_assignment_id,source_of_truth,confidence,status,category,"
        "deliverable,discovered_key,course_name,course_code,"
        "canvas_credential_key,synced_at,updated_at,created_at"
    )
    query = db.table("assignments").select(lite_columns).eq("user_id", user_id)
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return [_assignment_row_to_dict(r) for r in (resp.data or [])]


def get_assignment_by_canvas_id(
    user_id: str,
    course_id: str,
    canvas_assignment_id,
    canvas_credential_key: str = None,
) -> Optional[Dict]:
    """Get assignment by Canvas assignment ID."""
    db = get_db()
    query = (
        db.table("assignments")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("canvas_assignment_id", canvas_assignment_id)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.limit(1).execute()
    if resp.data:
        return _assignment_row_to_dict(resp.data[0])
    return None


_ASSIGNMENT_UPDATE_FIELD_MAP = {
    "normalizedDueAt": "normalized_due_at",
    "originalDueAt": "original_due_at",
    "canvasAssignmentId": "canvas_assignment_id",
    "sourceOfTruth": "source_of_truth",
    "discoveredKey": "discovered_key",
    "courseName": "course_name",
    "courseCode": "course_code",
    "rawCanvasJson": "raw_canvas_json",
}


def _normalize_assignment_updates(updates: Dict) -> Dict:
    """Map legacy camelCase update keys to Postgres column names."""
    normalized = {}
    for key, value in (updates or {}).items():
        db_key = _ASSIGNMENT_UPDATE_FIELD_MAP.get(key, key)
        normalized[db_key] = value
    return normalized


def update_assignment(
    user_id: str,
    course_id: str,
    canvas_assignment_id,
    updates: Dict,
    canvas_credential_key: str = None,
):
    """Update an existing assignment."""
    db = get_db()
    updates = _normalize_assignment_updates(updates)
    updates["updated_at"] = now_iso()
    query = (
        db.table("assignments")
        .update(updates)
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("canvas_assignment_id", canvas_assignment_id)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    query.execute()


def delete_discovered_assignments(user_id: str, course_id: str, canvas_credential_key: str = None):
    """Delete all discovered (non-Canvas) assignments for a course."""
    db = get_db()
    query = (
        db.table("assignments")
        .delete()
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .is_("canvas_assignment_id", "null")
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    query.execute()


def delete_assignments_by_doc_ids(
    user_id: str,
    doc_ids: List[str],
    canvas_credential_key: str = None,
) -> int:
    """Delete specific assignments by id. Returns number of deleted rows."""
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
    query = (
        db.table("assignments")
        .delete()
        .eq("user_id", user_id)
        .in_("id", unique_ids)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return len(resp.data) if resp.data else 0


def _assignment_row_to_dict(row: Dict) -> Dict:
    """Map Postgres assignment row to camelCase dict."""
    return {
        "id": str(row["id"]),
        "courseId": row.get("course_id"),
        "name": row.get("name"),
        "description": row.get("description"),
        "originalDueAt": row.get("original_due_at"),
        "normalizedDueAt": row.get("normalized_due_at"),
        "canvasAssignmentId": row.get("canvas_assignment_id"),
        "sourceOfTruth": row.get("source_of_truth"),
        "confidence": row.get("confidence"),
        "status": row.get("status"),
        "category": row.get("category"),
        "deliverable": row.get("deliverable"),
        "rawCanvasJson": row.get("raw_canvas_json"),
        "discoveredKey": row.get("discovered_key"),
        "courseName": row.get("course_name"),
        "courseCode": row.get("course_code"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
        "syncedAt": row.get("synced_at"),
        "updatedAt": row.get("updated_at"),
        "createdAt": row.get("created_at"),
    }


# =============================================================================
# COURSE FILE TEXT OPERATIONS
# =============================================================================

def save_course_file_text(user_id: str, course_id: str, file_data: Dict, canvas_credential_key: str = None) -> str:
    """Save extracted text from course files."""
    db = get_db()
    canvas_file_id = file_data.get("canvas_file_id") or file_data.get("file_id")
    now_ts = now_iso()

    # Check for existing row by user + course + canvas_file_id
    existing = None
    if canvas_file_id:
        q = (
            db.table("course_file_texts")
            .select("id")
            .eq("user_id", user_id)
            .eq("course_id", str(course_id))
            .eq("canvas_file_id", str(canvas_file_id))
        )
        if canvas_credential_key:
            q = q.eq("canvas_credential_key", canvas_credential_key)
        resp = q.limit(1).execute()
        if resp.data:
            existing = resp.data[0]

    payload = {
        "user_id": user_id,
        "course_id": str(course_id),
        "canvas_file_id": str(canvas_file_id) if canvas_file_id else None,
        "file_type": file_data.get("file_type", "schedule"),
        "file_name": file_data.get("file_name"),
        "storage_path": file_data.get("storage_path"),
        "extracted_text": file_data.get("extracted_text"),
        "canvas_credential_key": canvas_credential_key,
    }

    if existing:
        row_id = str(existing["id"])
        db.table("course_file_texts").update(payload).eq("id", row_id).execute()
        return row_id
    else:
        payload["created_at"] = now_ts
        resp = db.table("course_file_texts").insert(payload).execute()
        if resp.data:
            return str(resp.data[0]["id"])
        return ""


def get_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = "schedule",
    canvas_credential_key: str = None,
) -> List[Dict]:
    """Get extracted texts for a course by file type."""
    db = get_db()
    query = (
        db.table("course_file_texts")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("file_type", file_type)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    # Exclude archived (previous) by default
    query = query.neq("is_previous", True)
    resp = query.execute()
    return [_file_text_row_to_dict(r) for r in (resp.data or [])]


def delete_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = "schedule",
    canvas_credential_key: str = None,
):
    """Delete course file texts by type (for re-sync)."""
    db = get_db()
    query = (
        db.table("course_file_texts")
        .delete()
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("file_type", file_type)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    query.execute()


def archive_course_file_texts(
    user_id: str,
    course_id: str,
    file_type: str = "schedule",
    canvas_credential_key: str = None,
) -> List[Dict]:
    """Archive (mark as previous) course file texts. Returns archived files."""
    db = get_db()
    now_ts = now_iso()

    # First fetch the rows to return
    query = (
        db.table("course_file_texts")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("file_type", file_type)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    query = query.neq("is_previous", True)
    resp = query.execute()

    archived = []
    ids_to_archive = []
    for row in (resp.data or []):
        ids_to_archive.append(row["id"])
        archived.append({
            "id": str(row["id"]),
            "fileType": row.get("file_type"),
            "fileName": row.get("file_name"),
            "storagePath": row.get("storage_path"),
            "extractedText": row.get("extracted_text"),
            "createdAt": row.get("created_at"),
            "syncVersion": row.get("sync_version") or 1,
        })

    if ids_to_archive:
        db.table("course_file_texts").update({
            "is_previous": True,
            "archived_at": now_ts,
        }).in_("id", ids_to_archive).execute()

    return archived


def save_course_file_text_versioned(
    user_id: str,
    course_id: str,
    file_data: Dict,
    sync_version: int,
    canvas_credential_key: str = None,
) -> str:
    """Save extracted text with version tracking."""
    db = get_db()
    canvas_file_id = file_data.get("canvas_file_id") or file_data.get("file_id")
    now_ts = now_iso()

    payload = {
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
        "created_at": now_ts,
    }

    resp = db.table("course_file_texts").insert(payload).execute()
    if resp.data:
        return str(resp.data[0]["id"])
    return ""


def get_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    """Get the current sync version for a course."""
    course = get_course(user_id, course_id, canvas_credential_key)
    if course:
        return course.get("syncVersion", 0) or 0
    return 0


def increment_course_sync_version(user_id: str, course_id: str, canvas_credential_key: str = None) -> int:
    """Increment and return the new sync version for a course."""
    db = get_db()
    current_version = get_course_sync_version(user_id, course_id, canvas_credential_key)
    new_version = current_version + 1
    now_ts = now_iso()

    query = (
        db.table("courses")
        .select("id")
        .eq("user_id", user_id)
        .eq("canvas_course_id_str", str(course_id))
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.limit(1).execute()

    if resp.data:
        db.table("courses").update({
            "sync_version": new_version,
            "last_sync_at": now_ts,
        }).eq("id", resp.data[0]["id"]).execute()
    else:
        canvas_course_id_int = int(course_id) if str(course_id).isdigit() else None
        db.table("courses").insert({
            "user_id": user_id,
            "canvas_course_id": canvas_course_id_int,
            "canvas_course_id_str": str(course_id),
            "canvas_credential_key": canvas_credential_key,
            "sync_version": new_version,
            "last_sync_at": now_ts,
        }).execute()

    return new_version


def cleanup_old_file_versions(
    user_id: str,
    course_id: str,
    keep_versions: int = 2,
    canvas_credential_key: str = None,
):
    """Clean up old file versions, keeping only the most recent N versions."""
    db = get_db()
    if keep_versions < 1:
        keep_versions = 1

    course = get_course(user_id, course_id, canvas_credential_key)
    current_version = int(course.get("syncVersion", 0) or 0) if course else 0
    min_prev_version = max(1, current_version - (keep_versions - 1))

    query = (
        db.table("course_file_texts")
        .select("id, sync_version")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("is_previous", True)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()

    ids_to_delete = []
    for row in (resp.data or []):
        sv = int(row.get("sync_version") or 0)
        if sv and sv < min_prev_version:
            ids_to_delete.append(row["id"])

    if ids_to_delete:
        db.table("course_file_texts").delete().in_("id", ids_to_delete).execute()


def _file_text_row_to_dict(row: Dict) -> Dict:
    """Map Postgres course_file_texts row to camelCase dict."""
    return {
        "id": str(row["id"]),
        "courseId": row.get("course_id"),
        "canvasFileId": row.get("canvas_file_id"),
        "fileType": row.get("file_type"),
        "fileName": row.get("file_name"),
        "storagePath": row.get("storage_path"),
        "extractedText": row.get("extracted_text"),
        "syncVersion": row.get("sync_version"),
        "isPrevious": row.get("is_previous"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
        "createdAt": row.get("created_at"),
    }


# =============================================================================
# ANNOUNCEMENT OPERATIONS
# =============================================================================

def save_announcement(user_id: str, announcement_data: Dict, canvas_credential_key: str = None) -> str:
    """Save Canvas announcement (upsert on unique constraint)."""
    db = get_db()
    canvas_id = announcement_data.get("canvas_announcement_id")
    course_id = announcement_data.get("course_id")

    payload = {
        "user_id": user_id,
        "course_id": str(course_id),
        "canvas_announcement_id": canvas_id,
        "title": announcement_data.get("title"),
        "message": announcement_data.get("message"),
        "posted_at": announcement_data.get("posted_at"),
        "raw_json": announcement_data.get("raw_json"),
        "canvas_credential_key": canvas_credential_key,
    }

    resp = (
        db.table("announcements")
        .upsert(payload, on_conflict="user_id,course_id,canvas_announcement_id,canvas_credential_key")
        .execute()
    )

    if resp.data:
        return str(resp.data[0]["id"])
    return ""


def get_course_announcements(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get announcements for a course ordered by posted_at."""
    db = get_db()
    query = (
        db.table("announcements")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .order("posted_at", desc=False)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()
    return [_announcement_row_to_dict(r) for r in (resp.data or [])]


def _announcement_row_to_dict(row: Dict) -> Dict:
    """Map Postgres announcement row to camelCase dict."""
    return {
        "id": str(row["id"]),
        "courseId": row.get("course_id"),
        "canvasAnnouncementId": row.get("canvas_announcement_id"),
        "title": row.get("title"),
        "message": row.get("message"),
        "postedAt": row.get("posted_at"),
        "rawJson": row.get("raw_json"),
        "canvasCredentialKey": row.get("canvas_credential_key"),
    }


# =============================================================================
# SYLLABUS RULES OPERATIONS
# =============================================================================

def save_syllabus_rules(
    user_id: str,
    course_id: str,
    course_name: str,
    rules_json: str,
    canvas_credential_key: str = None,
) -> str:
    """Save AI-extracted syllabus rules (upsert on unique constraint)."""
    db = get_db()
    now_ts = now_iso()

    payload = {
        "user_id": user_id,
        "course_id": str(course_id),
        "course_name": course_name,
        "rules_json": rules_json,
        "canvas_credential_key": canvas_credential_key,
        "extracted_at": now_ts,
    }

    resp = (
        db.table("syllabus_rules")
        .upsert(payload, on_conflict="user_id,course_id,canvas_credential_key")
        .execute()
    )

    if resp.data:
        return str(resp.data[0]["id"])
    return ""


def get_syllabus_rules(user_id: str, course_id: str, canvas_credential_key: str = None) -> Optional[Dict]:
    """Get syllabus rules for a course."""
    db = get_db()
    query = (
        db.table("syllabus_rules")
        .select("*")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.limit(1).execute()
    if resp.data:
        row = resp.data[0]
        return {
            "id": str(row["id"]),
            "courseId": row.get("course_id"),
            "courseName": row.get("course_name"),
            "rulesJson": row.get("rules_json"),
            "canvasCredentialKey": row.get("canvas_credential_key"),
            "extractedAt": row.get("extracted_at"),
        }
    return None


# =============================================================================
# READING ITEMS OPERATIONS
# =============================================================================

def get_reading_items(user_id: str, course_id: str, canvas_credential_key: str = None) -> List[Dict]:
    """Get reading/lecture items for a course (non-deliverable assignments)."""
    db = get_db()
    query = (
        db.table("assignments")
        .select("name, description, normalized_due_at, category, canvas_credential_key")
        .eq("user_id", user_id)
        .eq("course_id", str(course_id))
        .eq("deliverable", 0)
    )
    if canvas_credential_key:
        query = query.eq("canvas_credential_key", canvas_credential_key)
    resp = query.execute()

    items = []
    for row in (resp.data or []):
        category = row.get("category") or ""
        if category in ("LECTURE", "READING", "ATTENDANCE") and category != "PLACEHOLDER":
            items.append({
                "name": row.get("name"),
                "details": row.get("description"),
                "dueAt": row.get("normalized_due_at"),
            })

    items.sort(key=lambda x: x.get("dueAt") or "")
    return items


# =============================================================================
# RETENTION / PURGE (docs/OIT_READINESS_AUDIT.md, R4)
# =============================================================================

def _cutoff_iso(days: int) -> Optional[str]:
    """ISO timestamp `days` in the past, or None when retention is disabled (<=0)."""
    if not days or days <= 0:
        return None
    cutoff = datetime.now(timezone.utc) - timedelta(days=int(days))
    return cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")


def _delete_older_than(table: str, column: str, cutoff_iso: str) -> int:
    """Delete rows where `column` < cutoff_iso. Returns number deleted."""
    db = get_db()
    resp = db.table(table).delete().lt(column, cutoff_iso).execute()
    return len(resp.data) if resp.data else 0


def purge_course_file_texts_older_than(days: int) -> int:
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return 0
    db = get_db()
    try:
        rows = (
            db.table("course_file_texts")
            .select("id,storage_path")
            .lt("created_at", cutoff)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        logger.warning("purge course_file_texts list failed: %s", exc)
        rows = []
    storage_paths = [r["storage_path"] for r in rows if r.get("storage_path")]
    if storage_paths:
        try:
            from storage import delete_storage_paths
            delete_storage_paths(storage_paths)
        except Exception as exc:
            logger.warning("purge course_file_texts storage delete failed: %s", exc)
    return _delete_older_than("course_file_texts", "created_at", cutoff)


def purge_assignments_older_than(days: int) -> int:
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return 0
    return _delete_older_than("assignments", "synced_at", cutoff)


def purge_courses_older_than(days: int) -> int:
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return 0
    return _delete_older_than("courses", "synced_at", cutoff)


def purge_syllabus_rules_older_than(days: int) -> int:
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return 0
    return _delete_older_than("syllabus_rules", "extracted_at", cutoff)


def purge_inactive_user_content(days: int) -> dict:
    """
    Purge synced content for users whose last_login is older than `days`.
    Does not delete user accounts or OAuth credentials.
    """
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return {"users": 0, "tables": {}}

    db = get_db()
    try:
        stale_users = (
            db.table("users")
            .select("id")
            .lt("last_login", cutoff)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        logger.warning("inactive user list failed: %s", exc)
        return {"users": 0, "tables": {}, "error": str(exc)}

    user_ids = [str(u["id"]) for u in stale_users if u.get("id")]
    if not user_ids:
        return {"users": 0, "tables": {}}

    tables = (
        "assignments",
        "announcements",
        "course_file_texts",
        "syllabus_rules",
        "courses",
    )
    counts: Dict[str, int] = {}
    for table in tables:
        deleted = 0
        for uid in user_ids:
            try:
                resp = db.table(table).delete().eq("user_id", uid).execute()
                deleted += len(resp.data) if resp.data else 0
            except Exception as exc:
                logger.warning("Inactive-content purge failed for %s: %s", table, type(exc).__name__)
        counts[table] = deleted

    for uid in user_ids:
        try:
            from storage import delete_user_storage
            delete_user_storage(uid)
        except Exception as exc:
            logger.warning("Inactive-content storage purge failed: %s", type(exc).__name__)

    return {"users": len(user_ids), "tables": counts}


def purge_announcements_older_than(days: int) -> int:
    cutoff = _cutoff_iso(days)
    if not cutoff:
        return 0
    # announcements have no created_at; posted_at (ISO text) is the post date.
    return _delete_older_than("announcements", "posted_at", cutoff)


# =============================================================================
# INITIALIZATION
# =============================================================================

if __name__ == "__main__":
    init_db()
    logger.info("Supabase connection test successful!")
