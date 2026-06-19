"""
Minimum spacing between course syncs to reduce Canvas API abuse risk.

In cloud mode this is backed by the shared rate_limits table so the limit holds
across autoscaled instances. In local (single-process) dev mode it uses an
in-memory map. See docs/OIT_READINESS_AUDIT.md (R9).
"""

from __future__ import annotations

import os
import time
import threading

from app_config import CLOUD_MODE

try:
    MIN_SECONDS_BETWEEN_COURSE_SYNCS = int(os.getenv("MIN_SECONDS_BETWEEN_COURSE_SYNCS", "30"))
except (TypeError, ValueError):
    MIN_SECONDS_BETWEEN_COURSE_SYNCS = 30

_LOCK = threading.Lock()
_LAST_SYNC_BY_USER: dict[str, float] = {}


def _check_in_memory(user_id: str) -> tuple[bool, int]:
    now = time.time()
    with _LOCK:
        last = _LAST_SYNC_BY_USER.get(user_id, 0)
        elapsed = now - last
        if elapsed < MIN_SECONDS_BETWEEN_COURSE_SYNCS:
            return False, max(1, int(MIN_SECONDS_BETWEEN_COURSE_SYNCS - elapsed))
        _LAST_SYNC_BY_USER[user_id] = now
    return True, 0


def check_sync_allowed(user_id: str) -> tuple[bool, int]:
    """Returns (allowed, retry_after_seconds)."""
    if MIN_SECONDS_BETWEEN_COURSE_SYNCS <= 0:
        return True, 0

    if CLOUD_MODE:
        try:
            from db_supabase import consume_sync_spacing
            result = consume_sync_spacing(user_id, MIN_SECONDS_BETWEEN_COURSE_SYNCS)
            return bool(result.get("allowed")), int(result.get("retry_after_seconds") or 0)
        except Exception:
            # Fail open to the in-memory check rather than blocking all syncs if
            # the store is briefly unavailable (the hourly DB limit still applies).
            return _check_in_memory(user_id)

    return _check_in_memory(user_id)
