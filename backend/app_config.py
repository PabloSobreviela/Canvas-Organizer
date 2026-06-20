"""
Central application configuration and environment detection.

This module is the single source of truth for two questions the rest of the
backend repeatedly asks:

  1. Are we running in production?            -> IS_PRODUCTION
  2. Are we in cloud mode (Supabase + Canvas   -> CLOUD_MODE
     OAuth + enforced auth) vs local no-auth
     SQLite mode?

Design goals (see docs/OIT_READINESS_AUDIT.md, tracks R1/R3/R11):

- Production is declared EXPLICITLY via APP_ENV, not inferred from a single
  platform-specific variable (the old code keyed everything off K_SERVICE).
- The configuration FAILS CLOSED: a production deployment can never silently
  fall back to the unauthenticated local SQLite mode.
- Backward compatibility: the legacy `USE_FIRESTORE` env var is still honored
  as a deprecated alias for `CLOUD_MODE` so existing deploys keep working.
"""

from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _truthy(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


# Cloud Run injects K_SERVICE. We still detect it, but only as a *hint* that
# defaults to production when APP_ENV was not set explicitly.
_ON_CLOUD_RUN = bool(os.getenv("K_SERVICE"))

# Explicit environment declaration. Allowed: "production" | "development".
APP_ENV = (os.getenv("APP_ENV") or "").strip().lower()
if APP_ENV not in {"production", "development"}:
    # No explicit declaration: be safe and treat a Cloud Run revision as prod.
    APP_ENV = "production" if _ON_CLOUD_RUN else "development"

IS_PRODUCTION = APP_ENV == "production"

# Cloud mode = Supabase + Canvas OAuth + auth enforced.
#   - Always on in production.
#   - In development it must be opted into via CLOUD_MODE/USE_FIRESTORE=true.
_cloud_requested = _truthy(os.getenv("CLOUD_MODE")) or _truthy(os.getenv("USE_FIRESTORE"))
CLOUD_MODE = IS_PRODUCTION or _cloud_requested or _ON_CLOUD_RUN

# Fail closed: production MUST run in cloud mode (authenticated). Refusing to
# boot is far safer than serving an unauthenticated API to the internet.
if IS_PRODUCTION and not CLOUD_MODE:
    raise RuntimeError(
        "APP_ENV=production requires CLOUD_MODE (Supabase + Canvas OAuth). "
        "The unauthenticated local SQLite mode must never run in production."
    )


# ---------------------------------------------------------------------------
# Data minimization & retention (docs/OIT_READINESS_AUDIT.md, R4)
# ---------------------------------------------------------------------------

# Whether to persist the full raw Canvas API payloads (assignment/announcement
# JSON). These dumps are debug-only and a data-minimization liability, so they
# are OFF in production by default. Set STORE_RAW_CANVAS_JSON=true to opt in.
STORE_RAW_CANVAS_JSON = _truthy(os.getenv("STORE_RAW_CANVAS_JSON")) if IS_PRODUCTION \
    else _truthy(os.getenv("STORE_RAW_CANVAS_JSON", "true"))

# AI inference can be explicitly disabled while credentials or institutional
# approval are pending. When enabled, startup validation requires a direct
# DeepInfra credential.
ENABLE_AI_RESOLVE = _truthy(os.getenv("ENABLE_AI_RESOLVE", "true"))


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# Retention windows (days). 0 disables purge for that category.
COURSE_FILE_TEXT_RETENTION_DAYS = _int_env("COURSE_FILE_TEXT_RETENTION_DAYS", 180)
ANNOUNCEMENT_RETENTION_DAYS = _int_env("ANNOUNCEMENT_RETENTION_DAYS", 180)
ASSIGNMENT_RETENTION_DAYS = _int_env("ASSIGNMENT_RETENTION_DAYS", 180)
COURSE_RETENTION_DAYS = _int_env("COURSE_RETENTION_DAYS", 180)
SYLLABUS_RULES_RETENTION_DAYS = _int_env("SYLLABUS_RULES_RETENTION_DAYS", 180)
# Purge stored content for users with no login + no sync for this long.
INACTIVE_USER_CONTENT_PURGE_DAYS = _int_env("INACTIVE_USER_CONTENT_PURGE_DAYS", 180)

def describe() -> str:
    """Human-readable one-liner for boot logs."""
    return (
        f"APP_ENV={APP_ENV} IS_PRODUCTION={IS_PRODUCTION} CLOUD_MODE={CLOUD_MODE} "
        f"STORE_RAW_CANVAS_JSON={STORE_RAW_CANVAS_JSON} ENABLE_AI_RESOLVE={ENABLE_AI_RESOLVE}"
    )
