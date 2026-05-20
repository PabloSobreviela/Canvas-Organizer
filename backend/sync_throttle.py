"""
Lightweight sync spacing to reduce Canvas API abuse risk.
"""

from __future__ import annotations

import os
import time
import threading

try:
    MIN_SECONDS_BETWEEN_COURSE_SYNCS = int(os.getenv("MIN_SECONDS_BETWEEN_COURSE_SYNCS", "30"))
except (TypeError, ValueError):
    MIN_SECONDS_BETWEEN_COURSE_SYNCS = 30

_LOCK = threading.Lock()
_LAST_SYNC_BY_USER: dict[str, float] = {}


def check_sync_allowed(user_id: str) -> tuple[bool, int]:
    """
    Returns (allowed, retry_after_seconds).
    """
    if MIN_SECONDS_BETWEEN_COURSE_SYNCS <= 0:
        return True, 0

    now = time.time()
    with _LOCK:
        last = _LAST_SYNC_BY_USER.get(user_id, 0)
        elapsed = now - last
        if elapsed < MIN_SECONDS_BETWEEN_COURSE_SYNCS:
            return False, max(1, int(MIN_SECONDS_BETWEEN_COURSE_SYNCS - elapsed))
        _LAST_SYNC_BY_USER[user_id] = now
    return True, 0
