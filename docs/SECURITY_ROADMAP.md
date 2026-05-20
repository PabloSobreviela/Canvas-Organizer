# CanvasSync Security Roadmap

Phased remediation checklist with owners, environment variables, and acceptance criteria.

---

## Phase 1 — Blockers (complete in codebase)

| # | Task | Files | Env / config |
|---|------|-------|----------------|
| 1 | Disable demo JWT in production | `backend/app.py` | `ENABLE_DEMO_SESSION=false` |
| 2 | Enforce secrets at boot | `backend/auth.py`, `backend/db_supabase.py` | `SESSION_SECRET_KEY`, `CANVAS_TOKEN_ENCRYPTION_KEY`, `SUPABASE_*` |
| 3 | Fix Supabase RLS | `backend/supabase_schema.sql`, `backend/migrations/002_fix_rls.sql` | Run migration in Supabase SQL editor |
| 4 | Canvas token refresh | `backend/canvas_token_service.py`, `app.py` | — |
| 5 | Cookie sessions | `backend/auth.py`, `frontend/src/auth.js` | `FRONTEND_URL`, HTTPS |
| 6 | Remove PAT in cloud | `backend/app.py` | No `REACT_APP_ENABLE_MANUAL_TOKEN_CONNECT` in prod |

**Acceptance:** OAuth login → sync works without manual token; no token in browser URL.

---

## Phase 2 — Abuse resistance (complete in codebase)

| # | Task | Files | Env |
|---|------|-------|-----|
| 7 | Redis rate limits | `backend/app.py` | `RATELIMIT_STORAGE_URI=redis://...` |
| 8 | Signed OAuth state + PKCE | `backend/auth.py` | — |
| 9 | Canvas revoke on logout | `backend/auth.py`, `canvas_token_service.py` | — |
| 10 | AI dashboard locked down | `backend/app.py` | `ENABLE_AI_USAGE_LOGS_DASHBOARD=false`, `AI_USAGE_LOGS_ALLOWED_EMAILS` |
| 11 | SPA security headers | `frontend/vercel.json` | — |
| 12 | Pagination URL validation | `backend/app.py` | `CANVAS_PAGINATION_MAX_PAGES` |

---

## Phase 3 — Governance (complete in codebase)

| # | Task | Files |
|---|------|-------|
| 13 | Data retention cleanup | `backend/app.py` `POST /api/user/delete-data` |
| 14 | Sync throttle helper | `backend/sync_throttle.py` |
| 15 | Delete legacy code | Removed `LEGACY_CODE_*`, `LastWorkingApp.js`, etc. |
| 16 | CI security scripts | `scripts/security_check.py`, `.github/workflows/security.yml` |
| 17 | Institutional compliance doc | `docs/INSTITUTIONAL_COMPLIANCE.md` |

---

## Production environment checklist

```bash
SESSION_SECRET_KEY=<32+ random bytes>
CANVAS_TOKEN_ENCRYPTION_KEY=<Fernet key>
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
CANVAS_OAUTH_CLIENT_ID=...
CANVAS_OAUTH_CLIENT_SECRET=...
CANVAS_OAUTH_REDIRECT_URI=https://<api>/api/auth/canvas/callback
FRONTEND_URL=https://canvassync.app
ENABLE_DEMO_SESSION=false
ENABLE_AI_USAGE_LOGS_DASHBOARD=false
AI_USAGE_LOGS_ALLOWED_EMAILS=admin@example.com
REACT_APP_API_URL=https://<api>
# Optional:
RATELIMIT_STORAGE_URI=redis://...
COURSE_FILE_TEXT_RETENTION_DAYS=180
```

---

## Out of scope (deferred)

- Full `App.js` decomposition
- Grouped-course calendar dedupe
- CRA → Vite migration
- DNS-rebind pinning for Canvas SSRF
