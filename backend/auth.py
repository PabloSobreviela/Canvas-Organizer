# Canvas OAuth2 + JWT Session Authentication Module
# Provides Canvas LMS OAuth2 login flow and JWT-based session management for Flask routes

from functools import wraps
import logging
import os
import secrets
import threading
import time
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode

import jwt
import requests
from flask import request, jsonify, redirect

from db_supabase import init_db, create_user, get_user, update_user_last_login

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration from environment
# ---------------------------------------------------------------------------

CANVAS_OAUTH_CLIENT_ID = os.getenv("CANVAS_OAUTH_CLIENT_ID", "")
CANVAS_OAUTH_CLIENT_SECRET = os.getenv("CANVAS_OAUTH_CLIENT_SECRET", "")
CANVAS_INSTANCE_URL = os.getenv("CANVAS_INSTANCE_URL", "https://gatech.instructure.com").rstrip("/")
CANVAS_OAUTH_REDIRECT_URI = os.getenv("CANVAS_OAUTH_REDIRECT_URI", "")
SESSION_SECRET_KEY = os.getenv("SESSION_SECRET_KEY", "")

SESSION_TOKEN_EXPIRY_HOURS = int(os.getenv("SESSION_TOKEN_EXPIRY_HOURS", "24"))

try:
    AUTH_TOKEN_CACHE_SECONDS = int(os.getenv("AUTH_TOKEN_CACHE_SECONDS", "300"))
except (TypeError, ValueError):
    AUTH_TOKEN_CACHE_SECONDS = 300
if AUTH_TOKEN_CACHE_SECONDS < 0:
    AUTH_TOKEN_CACHE_SECONDS = 0

try:
    AUTH_USER_SYNC_CACHE_SECONDS = int(os.getenv("AUTH_USER_SYNC_CACHE_SECONDS", "1800"))
except (TypeError, ValueError):
    AUTH_USER_SYNC_CACHE_SECONDS = 1800
if AUTH_USER_SYNC_CACHE_SECONDS < 0:
    AUTH_USER_SYNC_CACHE_SECONDS = 0

try:
    AUTH_LAST_LOGIN_UPDATE_SECONDS = int(os.getenv("AUTH_LAST_LOGIN_UPDATE_SECONDS", "43200"))
except (TypeError, ValueError):
    AUTH_LAST_LOGIN_UPDATE_SECONDS = 43200
if AUTH_LAST_LOGIN_UPDATE_SECONDS < 0:
    AUTH_LAST_LOGIN_UPDATE_SECONDS = 0

AUTH_DEBUG = os.getenv("AUTH_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"}

# ---------------------------------------------------------------------------
# Thread-safe caches
# ---------------------------------------------------------------------------

_AUTH_CACHE_LOCK = threading.Lock()
_TOKEN_INFO_CACHE: dict[str, dict] = {}
_USER_SYNC_CACHE: dict[str, dict] = {}
_OAUTH_STATE_CACHE: dict[str, float] = {}


def _prune_auth_caches(now_ts: float):
    if _TOKEN_INFO_CACHE:
        expired_tokens = [
            token
            for token, payload in _TOKEN_INFO_CACHE.items()
            if float(payload.get("expires_at", 0)) <= now_ts
        ]
        for token in expired_tokens:
            _TOKEN_INFO_CACHE.pop(token, None)
        if len(_TOKEN_INFO_CACHE) > 4096:
            _TOKEN_INFO_CACHE.clear()

    if _USER_SYNC_CACHE:
        expired_users = [
            uid
            for uid, payload in _USER_SYNC_CACHE.items()
            if (now_ts - float(payload.get("checked_at", 0))) > max(AUTH_USER_SYNC_CACHE_SECONDS * 4, 3600)
        ]
        for uid in expired_users:
            _USER_SYNC_CACHE.pop(uid, None)

    if _OAUTH_STATE_CACHE:
        expired_states = [
            state for state, ts in _OAUTH_STATE_CACHE.items()
            if (now_ts - ts) > 600
        ]
        for state in expired_states:
            _OAUTH_STATE_CACHE.pop(state, None)


def _get_cached_user_info(token: str):
    if AUTH_TOKEN_CACHE_SECONDS <= 0:
        return None
    now_ts = time.time()
    with _AUTH_CACHE_LOCK:
        _prune_auth_caches(now_ts)
        cached = _TOKEN_INFO_CACHE.get(token)
        if not cached:
            return None
        if float(cached.get("expires_at", 0)) <= now_ts:
            _TOKEN_INFO_CACHE.pop(token, None)
            return None
        return dict(cached.get("user_info") or {})


def _set_cached_user_info(token: str, user_info: dict, exp_timestamp: float = None):
    if AUTH_TOKEN_CACHE_SECONDS <= 0:
        return
    now_ts = time.time()
    exp_ts = now_ts + AUTH_TOKEN_CACHE_SECONDS
    if exp_timestamp:
        exp_ts = min(exp_timestamp, exp_ts)
    with _AUTH_CACHE_LOCK:
        _prune_auth_caches(now_ts)
        _TOKEN_INFO_CACHE[token] = {
            "expires_at": exp_ts,
            "user_info": dict(user_info or {}),
        }


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

def _issue_session_jwt(user_id: str, email: str = None, name: str = None) -> str:
    """Issue a signed JWT session token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "email": email,
        "name": name,
        "canvas_instance_url": CANVAS_INSTANCE_URL,
        "iat": now,
        "exp": now + timedelta(hours=SESSION_TOKEN_EXPIRY_HOURS),
    }
    return jwt.encode(payload, SESSION_SECRET_KEY, algorithm="HS256")


def _decode_session_jwt(token: str) -> dict | None:
    """Decode and verify a session JWT. Returns the payload dict or None."""
    try:
        payload = jwt.decode(token, SESSION_SECRET_KEY, algorithms=["HS256"])
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("Session JWT expired")
        return None
    except jwt.InvalidTokenError as e:
        if AUTH_DEBUG:
            logger.debug("Invalid session JWT: %s", e)
        return None


# ---------------------------------------------------------------------------
# Public token verification functions (preserve interface)
# ---------------------------------------------------------------------------

def verify_token(id_token: str) -> str | None:
    """
    Verify a session JWT and return the user ID.

    Args:
        id_token: The JWT session token

    Returns:
        The user ID (sub claim) if valid, None otherwise
    """
    payload = _decode_session_jwt(id_token)
    if payload and payload.get("sub"):
        return payload["sub"]
    return None


def get_user_from_token(id_token: str) -> dict | None:
    """
    Verify session JWT and return user info.

    Returns:
        Dictionary with user info (uid, email, name) or None if invalid
    """
    cached = _get_cached_user_info(id_token)
    if cached and cached.get("uid"):
        return cached

    payload = _decode_session_jwt(id_token)
    if not payload or not payload.get("sub"):
        return None

    user_info = {
        "uid": payload["sub"],
        "email": payload.get("email"),
        "name": payload.get("name"),
    }
    exp_ts = payload.get("exp")
    if isinstance(exp_ts, (int, float)):
        _set_cached_user_info(id_token, user_info, float(exp_ts))
    else:
        _set_cached_user_info(id_token, user_info)
    return user_info


# ---------------------------------------------------------------------------
# User sync
# ---------------------------------------------------------------------------

def ensure_user_exists(user_id: str, email: str, display_name: str = None):
    """
    Ensure user record exists in Supabase, create if not.
    Called after successful authentication.
    """
    now_ts = time.time()
    cache_entry = None
    if AUTH_USER_SYNC_CACHE_SECONDS > 0:
        with _AUTH_CACHE_LOCK:
            _prune_auth_caches(now_ts)
            cache_entry = _USER_SYNC_CACHE.get(user_id)
            if cache_entry:
                checked_at = float(cache_entry.get("checked_at", 0))
                exists = bool(cache_entry.get("exists"))
                last_login_updated_at = float(cache_entry.get("last_login_updated_at", 0))
                is_fresh = (now_ts - checked_at) <= AUTH_USER_SYNC_CACHE_SECONDS
                login_fresh = (now_ts - last_login_updated_at) <= AUTH_LAST_LOGIN_UPDATE_SECONDS
                if exists and is_fresh and login_fresh:
                    return user_id

    existing_user = get_user(user_id)

    if existing_user:
        should_update_last_login = True
        if cache_entry:
            last_login_updated_at = float(cache_entry.get("last_login_updated_at", 0))
            should_update_last_login = (now_ts - last_login_updated_at) > AUTH_LAST_LOGIN_UPDATE_SECONDS
        if should_update_last_login:
            update_user_last_login(user_id)
            last_login_updated_at = now_ts
        else:
            last_login_updated_at = float(cache_entry.get("last_login_updated_at", 0)) if cache_entry else now_ts

        if AUTH_USER_SYNC_CACHE_SECONDS > 0:
            with _AUTH_CACHE_LOCK:
                _USER_SYNC_CACHE[user_id] = {
                    "exists": True,
                    "checked_at": now_ts,
                    "last_login_updated_at": last_login_updated_at,
                }
    else:
        create_user(user_id, email, display_name)
        if AUTH_USER_SYNC_CACHE_SECONDS > 0:
            with _AUTH_CACHE_LOCK:
                _USER_SYNC_CACHE[user_id] = {
                    "exists": True,
                    "checked_at": now_ts,
                    "last_login_updated_at": now_ts,
                }

    return user_id


# ---------------------------------------------------------------------------
# Flask route decorators
# ---------------------------------------------------------------------------

def require_auth(f):
    """
    Flask decorator to require JWT session authentication on routes.

    Usage:
        @app.route('/api/protected')
        @require_auth
        def protected_route():
            user_id = request.user_id
            ...

    The decorator:
    1. Checks for Authorization header with Bearer token
    2. Verifies the session JWT
    3. Ensures user exists in Supabase
    4. Injects user_id, user_email, user_name into request context
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization")

        if not auth_header:
            return jsonify({
                "error": "Missing Authorization header",
                "code": "AUTH_MISSING",
            }), 401

        if not auth_header.startswith("Bearer "):
            return jsonify({
                "error": "Invalid Authorization header format. Expected: Bearer <token>",
                "code": "AUTH_FORMAT",
            }), 401

        token = auth_header.split("Bearer ")[1].strip()

        if not token:
            return jsonify({
                "error": "Empty token",
                "code": "AUTH_EMPTY",
            }), 401

        user_info = get_user_from_token(token)

        if not user_info:
            return jsonify({
                "error": "Invalid or expired token",
                "code": "AUTH_INVALID",
            }), 401

        user_id = ensure_user_exists(
            user_info["uid"],
            user_info.get("email"),
            user_info.get("name"),
        )

        request.user_id = user_id
        request.user_email = user_info.get("email")
        request.user_name = user_info.get("name")

        return f(*args, **kwargs)

    return decorated_function


def optional_auth(f):
    """
    Flask decorator for optional authentication.
    If token is provided and valid, user_id is set.
    If not provided or invalid, user_id is None (but request proceeds).
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        request.user_id = None
        request.user_email = None
        request.user_name = None

        auth_header = request.headers.get("Authorization")

        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split("Bearer ")[1].strip()
            if token:
                user_info = get_user_from_token(token)
                if user_info:
                    request.user_id = ensure_user_exists(
                        user_info["uid"],
                        user_info.get("email"),
                        user_info.get("name"),
                    )
                    request.user_email = user_info.get("email")
                    request.user_name = user_info.get("name")

        return f(*args, **kwargs)

    return decorated_function


# ---------------------------------------------------------------------------
# Canvas OAuth2 flow (route handlers - registered in app.py)
# ---------------------------------------------------------------------------

def canvas_oauth_login():
    """
    Initiate Canvas OAuth2 login. Returns a redirect response to the Canvas
    authorization endpoint.
    """
    state = secrets.token_urlsafe(32)
    with _AUTH_CACHE_LOCK:
        _OAUTH_STATE_CACHE[state] = time.time()

    params = {
        "client_id": CANVAS_OAUTH_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": CANVAS_OAUTH_REDIRECT_URI,
        "state": state,
    }
    authorize_url = f"{CANVAS_INSTANCE_URL}/login/oauth2/auth?{urlencode(params)}"
    return redirect(authorize_url)


def canvas_oauth_callback():
    """
    Handle Canvas OAuth2 callback. Exchanges the authorization code for tokens,
    fetches user info from Canvas, creates/updates the user in Supabase, and
    returns a session JWT.
    """
    code = request.args.get("code")
    state = request.args.get("state")
    error = request.args.get("error")

    if error:
        return jsonify({"error": f"Canvas OAuth error: {error}"}), 400

    if not code:
        return jsonify({"error": "Missing authorization code"}), 400

    # Validate CSRF state
    with _AUTH_CACHE_LOCK:
        if state not in _OAUTH_STATE_CACHE:
            return jsonify({"error": "Invalid or expired OAuth state"}), 400
        _OAUTH_STATE_CACHE.pop(state, None)

    # Exchange code for tokens
    token_response = requests.post(
        f"{CANVAS_INSTANCE_URL}/login/oauth2/token",
        data={
            "grant_type": "authorization_code",
            "code": code,
            "client_id": CANVAS_OAUTH_CLIENT_ID,
            "client_secret": CANVAS_OAUTH_CLIENT_SECRET,
            "redirect_uri": CANVAS_OAUTH_REDIRECT_URI,
        },
        timeout=15,
    )

    if token_response.status_code != 200:
        logger.error("Canvas token exchange failed: %s", token_response.text)
        return jsonify({"error": "Failed to exchange authorization code"}), 502

    token_data = token_response.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")

    if not access_token:
        return jsonify({"error": "No access token received from Canvas"}), 502

    # Fetch user info from Canvas API
    user_response = requests.get(
        f"{CANVAS_INSTANCE_URL}/api/v1/users/self",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )

    if user_response.status_code != 200:
        logger.error("Canvas user info fetch failed: %s", user_response.text)
        return jsonify({"error": "Failed to fetch user info from Canvas"}), 502

    canvas_user = user_response.json()
    canvas_user_id = str(canvas_user.get("id", ""))
    email = canvas_user.get("email") or canvas_user.get("login_id", "")
    display_name = canvas_user.get("name") or canvas_user.get("short_name", "")

    if not canvas_user_id:
        return jsonify({"error": "Could not determine Canvas user ID"}), 502

    # Create/update user in Supabase
    user_id = f"canvas_{canvas_user_id}"
    ensure_user_exists(user_id, email, display_name)

    # Issue session JWT
    session_jwt = _issue_session_jwt(user_id, email, display_name)

    frontend_redirect = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    return redirect(f"{frontend_redirect}/?token={session_jwt}")


def canvas_oauth_refresh():
    """
    Refresh Canvas access token using a stored refresh token.
    Expects JSON body with `refresh_token`.
    Returns new access and refresh tokens.
    """
    data = request.get_json(silent=True) or {}
    refresh_token = data.get("refresh_token")

    if not refresh_token:
        return jsonify({"error": "Missing refresh_token"}), 400

    token_response = requests.post(
        f"{CANVAS_INSTANCE_URL}/login/oauth2/token",
        data={
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
            "client_id": CANVAS_OAUTH_CLIENT_ID,
            "client_secret": CANVAS_OAUTH_CLIENT_SECRET,
        },
        timeout=15,
    )

    if token_response.status_code != 200:
        logger.error("Canvas token refresh failed: %s", token_response.text)
        return jsonify({"error": "Failed to refresh Canvas token"}), 502

    token_data = token_response.json()
    return jsonify({
        "access_token": token_data.get("access_token"),
        "refresh_token": token_data.get("refresh_token", refresh_token),
        "expires_in": token_data.get("expires_in"),
    })


def canvas_oauth_logout():
    """
    Logout handler. JWT sessions are stateless so invalidation is client-side.
    This endpoint confirms logout and can be extended for server-side revocation.
    """
    return jsonify({"message": "Logged out successfully"})


# ---------------------------------------------------------------------------
# Development helpers
# ---------------------------------------------------------------------------

def create_dev_token(user_id: str = "dev-user-001", email: str = "dev@localhost", name: str = "Dev User") -> str:
    """
    FOR DEVELOPMENT ONLY: Create a session JWT for testing without going
    through the Canvas OAuth flow.
    """
    if not SESSION_SECRET_KEY:
        logger.warning("Cannot create dev token: SESSION_SECRET_KEY not set")
        return None
    try:
        ensure_user_exists(user_id, email, name)
        return _issue_session_jwt(user_id, email, name)
    except Exception as e:
        if AUTH_DEBUG:
            logger.debug("Failed to create dev token: %s", e)
        return None


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    init_db()
    logger.info("Auth module initialized successfully")
    if SESSION_SECRET_KEY:
        token = create_dev_token()
        if token:
            logger.info("Dev token: %s", token)
    else:
        logger.warning("SESSION_SECRET_KEY not set - cannot issue tokens")
