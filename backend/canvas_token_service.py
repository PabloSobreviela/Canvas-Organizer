"""
Canvas OAuth token lifecycle: refresh before expiry, revoke on logout.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

import requests

from db_supabase import (
    decrypt_canvas_token,
    encrypt_canvas_token,
    get_user,
    update_user_canvas_oauth_credentials,
    now_iso,
    build_canvas_credential_key,
)

logger = logging.getLogger(__name__)

CANVAS_OAUTH_CLIENT_ID = os.getenv("CANVAS_OAUTH_CLIENT_ID", "")
CANVAS_OAUTH_CLIENT_SECRET = os.getenv("CANVAS_OAUTH_CLIENT_SECRET", "")
CANVAS_INSTANCE_URL = os.getenv("CANVAS_INSTANCE_URL", "https://gatech.instructure.com").rstrip("/")

try:
    TOKEN_REFRESH_BUFFER_SECONDS = int(os.getenv("CANVAS_TOKEN_REFRESH_BUFFER_SECONDS", "300"))
except (TypeError, ValueError):
    TOKEN_REFRESH_BUFFER_SECONDS = 300


def _parse_expires_at(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        text = str(value).replace("Z", "+00:00")
        return datetime.fromisoformat(text)
    except (TypeError, ValueError):
        return None


def _needs_refresh(expires_at: str | None) -> bool:
    exp = _parse_expires_at(expires_at)
    if not exp:
        return False
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) >= (exp - timedelta(seconds=TOKEN_REFRESH_BUFFER_SECONDS))


def refresh_canvas_access_token(
    user_id: str,
    api_url: str,
    refresh_token: str,
) -> dict | None:
    """Exchange refresh token for new access token. Returns token payload or None."""
    if not refresh_token or not CANVAS_OAUTH_CLIENT_ID:
        return None

    instance = (api_url or CANVAS_INSTANCE_URL).rstrip("/")
    try:
        resp = requests.post(
            f"{instance}/login/oauth2/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": CANVAS_OAUTH_CLIENT_ID,
                "client_secret": CANVAS_OAUTH_CLIENT_SECRET,
            },
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.warning("Canvas token refresh request failed for user %s: %s", user_id, exc)
        return None

    if resp.status_code != 200:
        logger.warning(
            "Canvas token refresh failed for user %s: HTTP %s",
            user_id,
            resp.status_code,
        )
        return None

    return resp.json()


def revoke_canvas_tokens(user_id: str) -> bool:
    """
    Revoke Canvas OAuth token at provider and clear stored credentials.
    """
    user = get_user(user_id)
    if not user:
        return True

    api_url = (user.get("canvasApiUrl") or CANVAS_INSTANCE_URL).rstrip("/")
    access_enc = user.get("canvasAccessTokenEncrypted") or user.get("canvasApiTokenEncrypted")
    access_token = decrypt_canvas_token(access_enc)

    if access_token:
        try:
            requests.delete(
                f"{api_url}/login/oauth2/token",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
        except requests.RequestException as exc:
            logger.warning("Canvas token revoke failed for user %s: %s", user_id, exc)

    from db_supabase import get_db

    db = get_db()
    db.table("users").update({
        "canvas_api_url": None,
        "canvas_api_token_encrypted": None,
        "canvas_access_token_encrypted": None,
        "canvas_refresh_token_encrypted": None,
        "canvas_token_expires_at": None,
        "canvas_credential_key": None,
        "updated_at": now_iso(),
    }).eq("id", user_id).execute()
    return True


def get_valid_canvas_credentials(user_id: str) -> dict | None:
    """
    Return {api_url, token, canvas_credential_key} with refreshed access token if needed.
    """
    user = get_user(user_id)
    if not user:
        return None

    api_url = (user.get("canvasApiUrl") or CANVAS_INSTANCE_URL).strip()
    access_enc = user.get("canvasAccessTokenEncrypted") or user.get("canvasApiTokenEncrypted")
    refresh_enc = user.get("canvasRefreshTokenEncrypted")
    expires_at = user.get("canvasTokenExpiresAt")

    access_token = decrypt_canvas_token(access_enc)
    refresh_token = decrypt_canvas_token(refresh_enc)

    if not access_token:
        return None

    if _needs_refresh(expires_at) and refresh_token:
        token_data = refresh_canvas_access_token(user_id, api_url, refresh_token)
        if token_data and token_data.get("access_token"):
            access_token = token_data["access_token"]
            refresh_token = token_data.get("refresh_token") or refresh_token
            expires_in = token_data.get("expires_in")
            new_expires = None
            try:
                if expires_in is not None:
                    new_expires = (
                        datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
                    ).strftime("%Y-%m-%dT%H:%M:%SZ")
            except (TypeError, ValueError):
                pass
            update_user_canvas_oauth_credentials(
                user_id,
                api_url,
                access_token,
                refresh_token=refresh_token,
                expires_at=new_expires,
            )
            expires_at = new_expires

    credential_key = user.get("canvasCredentialKey") or build_canvas_credential_key(api_url, access_token)
    return {
        "api_url": api_url,
        "token": access_token,
        "encrypted_token": access_token,
        "canvas_credential_key": credential_key,
        "canvas_token_expires_at": expires_at,
    }
