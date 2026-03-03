# Firebase Authentication Module
# Provides JWT token verification and authentication middleware for Flask routes
# Uses Firebase Admin SDK to verify Firebase ID tokens

from functools import wraps
import logging
import os

logger = logging.getLogger(__name__)
import threading
import time
from flask import request, jsonify
import firebase_admin
from firebase_admin import auth

# Import our Firestore module to ensure Firebase is initialized
from db_firestore import init_firebase, create_user, get_user, update_user_last_login


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

AUTH_DEBUG = (os.getenv("AUTH_DEBUG", "").strip().lower() in {"1", "true", "yes", "on"})

_AUTH_CACHE_LOCK = threading.Lock()
_TOKEN_INFO_CACHE: dict[str, dict] = {}
_USER_SYNC_CACHE: dict[str, dict] = {}


def _prune_auth_caches(now_ts: float):
    if _TOKEN_INFO_CACHE:
        expired_tokens = [
            token
            for token, payload in _TOKEN_INFO_CACHE.items()
            if float(payload.get("expires_at", 0)) <= now_ts
        ]
        for token in expired_tokens:
            _TOKEN_INFO_CACHE.pop(token, None)
        # Safety cap to avoid unbounded growth in pathological scenarios.
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


def _get_cached_user_info(id_token: str):
    if AUTH_TOKEN_CACHE_SECONDS <= 0:
        return None
    now_ts = time.time()
    with _AUTH_CACHE_LOCK:
        _prune_auth_caches(now_ts)
        cached = _TOKEN_INFO_CACHE.get(id_token)
        if not cached:
            return None
        if float(cached.get("expires_at", 0)) <= now_ts:
            _TOKEN_INFO_CACHE.pop(id_token, None)
            return None
        return dict(cached.get("user_info") or {})


def _set_cached_user_info(id_token: str, user_info: dict, decoded_token: dict = None):
    if AUTH_TOKEN_CACHE_SECONDS <= 0:
        return
    now_ts = time.time()
    exp_ts = now_ts + AUTH_TOKEN_CACHE_SECONDS
    if decoded_token and decoded_token.get("exp"):
        try:
            exp_ts = min(float(decoded_token.get("exp")), exp_ts)
        except (TypeError, ValueError):
            pass
    with _AUTH_CACHE_LOCK:
        _prune_auth_caches(now_ts)
        _TOKEN_INFO_CACHE[id_token] = {
            "expires_at": exp_ts,
            "user_info": dict(user_info or {}),
        }


def verify_token(id_token: str) -> str | None:
    """
    Verify a Firebase ID token and return the user ID.
    
    Args:
        id_token: The Firebase ID token from the client
        
    Returns:
        The Firebase user ID (UID) if valid, None otherwise
    """
    try:
        init_firebase()  # Ensure Firebase is initialized
        decoded_token = auth.verify_id_token(id_token)
        return decoded_token['uid']
    except auth.ExpiredIdTokenError:
        logger.debug("Token expired")
        return None
    except auth.RevokedIdTokenError:
        logger.debug("Token revoked")
        return None
    except auth.InvalidIdTokenError as e:
        logger.debug("Invalid token: %s", e)
        return None
    except Exception as e:
        logger.warning("Token verification failed: %s", e)
        return None


def get_user_from_token(id_token: str) -> dict | None:
    """
    Verify token and return user info from Firebase Auth.
    
    Returns:
        Dictionary with user info (uid, email, name) or None if invalid
    """
    try:
        cached = _get_cached_user_info(id_token)
        if cached and cached.get("uid"):
            return cached

        init_firebase()
        decoded_token = auth.verify_id_token(id_token)
        user_info = {
            'uid': decoded_token['uid'],
            'email': decoded_token.get('email'),
            'name': decoded_token.get('name'),
            'picture': decoded_token.get('picture')
        }
        _set_cached_user_info(id_token, user_info, decoded_token)
        return user_info
    except Exception as e:
        if AUTH_DEBUG:
            logger.debug("Failed to get user from token: %s", e)
        return None


def ensure_user_exists(user_id: str, email: str, display_name: str = None):
    """
    Ensure user document exists in Firestore, create if not.
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


def require_auth(f):
    """
    Flask decorator to require Firebase authentication on routes.
    
    Usage:
        @app.route('/api/protected')
        @require_auth
        def protected_route():
            user_id = request.user_id  # Available after authentication
            ...
    
    The decorator:
    1. Checks for Authorization header with Bearer token
    2. Verifies the Firebase ID token
    3. Ensures user exists in Firestore
    4. Injects user_id into request context
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        # Get Authorization header
        auth_header = request.headers.get('Authorization')
        
        if not auth_header:
            return jsonify({
                'error': 'Missing Authorization header',
                'code': 'AUTH_MISSING'
            }), 401
        
        if not auth_header.startswith('Bearer '):
            return jsonify({
                'error': 'Invalid Authorization header format. Expected: Bearer <token>',
                'code': 'AUTH_FORMAT'
            }), 401
        
        # Extract token
        token = auth_header.split('Bearer ')[1].strip()
        
        if not token:
            return jsonify({
                'error': 'Empty token',
                'code': 'AUTH_EMPTY'
            }), 401
        
        # Verify token and get user info
        user_info = get_user_from_token(token)
        
        if not user_info:
            return jsonify({
                'error': 'Invalid or expired token',
                'code': 'AUTH_INVALID'
            }), 401
        
        # Ensure user exists in Firestore
        user_id = ensure_user_exists(
            user_info['uid'],
            user_info.get('email'),
            user_info.get('name')
        )
        
        # Inject user info into request context
        request.user_id = user_id
        request.user_email = user_info.get('email')
        request.user_name = user_info.get('name')
        
        return f(*args, **kwargs)
    
    return decorated_function


def optional_auth(f):
    """
    Flask decorator for optional authentication.
    If token is provided and valid, user_id is set.
    If not provided or invalid, user_id is None (but request proceeds).
    
    Useful for endpoints that work differently for authenticated vs anonymous users.
    """
    @wraps(f)
    def decorated_function(*args, **kwargs):
        request.user_id = None
        request.user_email = None
        request.user_name = None
        
        auth_header = request.headers.get('Authorization')
        
        if auth_header and auth_header.startswith('Bearer '):
            token = auth_header.split('Bearer ')[1].strip()
            if token:
                user_info = get_user_from_token(token)
                if user_info:
                    request.user_id = ensure_user_exists(
                        user_info['uid'],
                        user_info.get('email'),
                        user_info.get('name')
                    )
                    request.user_email = user_info.get('email')
                    request.user_name = user_info.get('name')
        
        return f(*args, **kwargs)
    
    return decorated_function


# =============================================================================
# DEVELOPMENT HELPERS
# =============================================================================

def create_dev_token(user_id: str = "dev-user-001", email: str = "dev@localhost") -> str:
    """
    FOR DEVELOPMENT ONLY: Create a custom token for testing.
    This requires Firebase Admin SDK and will only work in development.
    
    Returns a token that can be exchanged for an ID token using Firebase client SDK.
    """
    try:
        init_firebase()
        custom_token = auth.create_custom_token(user_id, {
            'email': email,
            'dev': True
        })
        return custom_token.decode('utf-8') if isinstance(custom_token, bytes) else custom_token
    except Exception as e:
        if AUTH_DEBUG:
            logger.debug("Failed to create dev token: %s", e)
        return None


if __name__ == "__main__":
    # Test initialization
    init_firebase()
    logger.info("Auth module initialized successfully")
