# CanvasSync Security Audit

**Date:** 2026-05-20  
**Scope:** `backend/`, `frontend/src/`, `scripts/`, Supabase schema, deploy config  
**Status:** Findings documented; remediation tracked in [SECURITY_ROADMAP.md](SECURITY_ROADMAP.md)

---

## Executive summary

CanvasSync has meaningful baseline controls (Canvas URL allowlisting, Fernet token encryption, CORS allowlists, security headers on API responses). Before broad GT student traffic, address **unauthenticated demo JWT minting**, **weak session secret handling**, **permissive Supabase RLS**, **JWT exposure via URL/localStorage**, and **missing Canvas token lifecycle** (refresh/revoke).

---

## Critical

### S1 — Unauthenticated demo JWT minting

| Field | Detail |
|-------|--------|
| **Severity** | Critical (production) |
| **Location** | `backend/app.py` — `POST /api/demo/session` |
| **Evidence** | No `@require_auth`; returns signed JWT for fixed demo user |
| **Exploit** | Anonymous caller obtains JWT → calls sync, AI resolve, assignment APIs as demo user |
| **Fix** | Gate with `ENABLE_DEMO_SESSION=false` when `K_SERVICE` is set (implemented) |

### S2 — Session secret not enforced at boot

| Field | Detail |
|-------|--------|
| **Severity** | Critical |
| **Location** | `backend/auth.py` — `SESSION_SECRET_KEY` defaults to `""` |
| **Exploit** | Misconfigured deploy → forgeable HS256 session JWTs |
| **Fix** | `validate_production_secrets()` at startup; refuse boot if secret &lt; 32 bytes (implemented) |

### S3 — Supabase RLS policies allow all rows

| Field | Detail |
|-------|--------|
| **Severity** | Critical (if anon/authenticated key leaks) |
| **Location** | `backend/supabase_schema.sql` — `USING (true)` on SELECT |
| **Exploit** | Any direct Supabase client with non-service key reads all tenants |
| **Fix** | Deny `anon`/`authenticated` SELECT; service_role only (migration + schema updated) |

---

## High

### S4 — JWT in URL fragment + localStorage

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Location** | `backend/auth.py` redirect; `frontend/src/auth.js` storage |
| **Exploit** | History/extensions leak; XSS steals `canvassync_session_token` |
| **Fix** | HttpOnly cookie on API domain + `credentials: 'include'`; no token in URL (implemented) |

### S5 — Canvas OAuth tokens without lifecycle

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Location** | `backend/db_supabase.py`, `backend/app.py` `resolve_canvas_credentials` |
| **Impact** | Canvas access tokens expire ~1h; sync fails; refresh tokens unused |
| **Fix** | `get_valid_canvas_credentials()` refreshes before API calls; revoke on logout (implemented) |

### S6 — In-memory Flask rate limits

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Location** | `backend/app.py` — `storage_uri="memory://"` |
| **Exploit** | Per-instance limits; scale-out bypasses caps |
| **Fix** | `RATELIMIT_STORAGE_URI` → Redis when set (implemented) |

### S7 — OAuth CSRF state in process memory

| Field | Detail |
|-------|--------|
| **Severity** | High |
| **Location** | `backend/auth.py` — `_OAUTH_STATE_CACHE` |
| **Exploit** | Multi-instance Cloud Run → invalid state / race |
| **Fix** | HMAC-signed state cookie + PKCE verifier (implemented) |

---

## Medium

| ID | Finding | Location | Remediation |
|----|---------|----------|-------------|
| S8 | Pagination `next` URL not re-validated | `app.py` `canvas_get_paginated_list` | Hostname allowlist check on `next_url` (implemented) |
| S9 | DNS TOCTOU on SSRF check | `normalize_canvas_base_url` | Document risk; pin IP in future |
| S10 | PAT fallback in cloud mode | `resolve_canvas_credentials` | Reject body token when `CLOUD_MODE` (implemented) |
| S11 | AI logs dashboard default on | `ENABLE_AI_USAGE_LOGS_DASHBOARD` | Default `false`; allowlist required (implemented) |
| S12 | Broad CORS `*.vercel.app` | `app.py` | Restrict in production via env |
| S13 | Cloud Run `--allow-unauthenticated` | `scripts/deploy.ps1` | App-layer JWT/cookie auth only — document threat model |
| S14 | No CSP on SPA | `frontend/vercel.json` | Security headers added (implemented) |
| S15 | OAuth errors log response body | `auth.py` | Log status only (implemented) |

---

## Low

- Legacy PAT in `frontend/src/LastWorkingApp.js`, `LEGACY_CODE_App.js` (removed in Phase 3)
- Plaintext legacy Canvas tokens in DB (reject in production read path)
- Client JWT decode without verify (`auth.js`) — mitigated by server `/api/auth/me`
- `console.log` course dumps in `App.js` connect flow

---

## Positive controls

- Production sets `APP_ENV=production` + `CLOUD_MODE=true` (auth enabled)
- Canvas base URL SSRF checks (`normalize_canvas_base_url`)
- Fernet encryption for stored tokens
- API security headers (HSTS, CSP, X-Frame-Options)
- CORS credentials + allowlist (no `*` in production)
- AI dashboard email allowlist on production

---

## Acceptance tests

- [ ] `ENABLE_DEMO_SESSION=false` on Cloud Run → `POST /api/demo/session` returns 404
- [ ] Missing `SESSION_SECRET_KEY` → process exits on startup
- [ ] OAuth callback → no `token` in URL; `Set-Cookie` on API domain
- [ ] `GET /api/auth/me` with cookie returns user without `Authorization` header
- [ ] Expired Canvas token auto-refreshes before sync
- [ ] Logout clears cookie and revokes Canvas token in DB
