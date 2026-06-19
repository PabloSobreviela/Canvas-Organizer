# CanvasSync Operations Runbook

Operational procedures for running CanvasSync in production (Google Cloud Run +
Supabase + OpenRouter). Companion to `docs/OIT_READINESS_AUDIT.md`.

---

## 1. Environment & configuration

Production is selected explicitly via `APP_ENV=production` (and is also implied
when running on Cloud Run via `K_SERVICE`). See `backend/app_config.py`.

The backend **fails closed**: it refuses to boot in production unless the
required configuration is present (`backend/auth.py: validate_production_secrets`).

Required production configuration:

| Variable | Purpose |
| --- | --- |
| `APP_ENV=production` | Explicit environment selection |
| `SESSION_SECRET_KEY` | JWT session signing (>=32 chars) |
| `CANVAS_TOKEN_ENCRYPTION_KEY` | Fernet key encrypting Canvas tokens at rest |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Database access |
| `CANVAS_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | Canvas OAuth (developer key) |
| `FRONTEND_URL` | Redirect target + CORS |
| `LLM_API_KEY` | OpenRouter API key (AI date extraction) |
| `RATELIMIT_STORAGE_URI` | Distributed rate-limit store (e.g. `redis://...`) |

Optional but recommended:

| Variable | Default | Purpose |
| --- | --- | --- |
| `STORE_RAW_CANVAS_JSON` | `false` (prod) | Persist raw Canvas payloads (debug only) |
| `COURSE_FILE_TEXT_RETENTION_DAYS` | `180` | Retention for extracted file text (+ Storage blobs) |
| `ANNOUNCEMENT_RETENTION_DAYS` | `180` | Retention for announcements |
| `ASSIGNMENT_RETENTION_DAYS` | `180` | Retention for assignments |
| `COURSE_RETENTION_DAYS` | `180` | Retention for course metadata rows |
| `SYLLABUS_RULES_RETENTION_DAYS` | `180` | Retention for syllabus rules |
| `AI_USAGE_LOG_RETENTION_DAYS` | `365` | Retention for AI usage logs |
| `INACTIVE_USER_CONTENT_PURGE_DAYS` | `0` (off) | Purge synced content for inactive users |
| `DISCLOSED_AI_PROVIDERS` | `openrouter,deepinfra` | Providers data may be routed to |
| `OPENROUTER_PROVIDER_ONLY` | `deepinfra` | Pin OpenRouter routing to DeepInfra |
| `OPENROUTER_ENFORCE_ZDR` | `true` | Require zero-data-retention routing |
| `OPENROUTER_DENY_DATA_COLLECTION` | `true` | Deny provider data collection |
| `OPENROUTER_ALLOW_FALLBACK` | `false` | Disable provider fallback |
| `RETENTION_CRON_SECRET` | (unset) | Enables `/api/admin/retention/run` |

---

## 2. Secret rotation

Rotate on a schedule and immediately on any suspected exposure.

### 2.1 `SESSION_SECRET_KEY`
- Effect of rotation: all existing sessions are invalidated (users re-login).
- Procedure: generate a new 32+ char random value, update the Cloud Run
  secret, deploy a new revision. No data migration required.

### 2.2 `CANVAS_TOKEN_ENCRYPTION_KEY` (most sensitive)
- Encrypts Canvas OAuth tokens at rest (Fernet). Rotating it **invalidates all
  stored ciphertext** unless you re-encrypt.
- Safe procedure:
  1. Generate the new Fernet key.
  2. Configure both keys (the app/Fernet supports a primary + fallback if using
     `MultiFernet`; otherwise treat as a hard rotation).
  3. Hard-rotation fallback (no re-encrypt tooling): clear stored tokens and
     require users to reconnect Canvas. Run:
     `UPDATE users SET canvas_access_token_encrypted=NULL,
      canvas_refresh_token_encrypted=NULL, canvas_api_token_encrypted=NULL,
      canvas_token_expires_at=NULL;`
  4. Users transparently re-run Canvas OAuth on next sync.

### 2.3 `CANVAS_OAUTH_CLIENT_SECRET`
- Rotate from the GT Canvas Developer Key admin UI, then update the Cloud Run
  secret and deploy. In-flight OAuth code exchanges during the swap may fail and
  simply require a retry.

### 2.4 `SUPABASE_SERVICE_KEY`
- Rotate in the Supabase dashboard (API settings), update the Cloud Run secret,
  deploy. The service key bypasses RLS — treat as a top-tier secret.

### 2.5 OpenRouter / DeepInfra API keys
- Rotate in the provider dashboard, update Cloud Run env, deploy. No data impact.

---

## 3. Data retention

Retention is enforced by `backend/retention_service.py` using the windows in
section 1. Two ways to run it:

- **Scheduled Cloud Run Job (preferred):** schedule `python retention_service.py`
  daily. It applies all configured windows and logs per-category delete counts.
- **Authenticated endpoint:** set `RETENTION_CRON_SECRET` and POST to
  `/api/admin/retention/run` with header `X-Retention-Secret: <secret>` from a
  scheduler. The endpoint is disabled (404) when the secret is unset.

Indexes supporting efficient purges: `backend/migrations/006_retention_indexes.sql`.

---

## 4. Incident response

### 4.1 Suspected token / key exposure
1. Rotate the affected secret (section 2) immediately.
2. If `CANVAS_TOKEN_ENCRYPTION_KEY` or `SUPABASE_SERVICE_KEY` exposed, also
   rotate `SESSION_SECRET_KEY` to force re-login.
3. Review Cloud Run + Supabase logs for anomalous access.
4. If Canvas tokens may be compromised, clear stored tokens (section 2.2 step 3)
   to force reconnection; notify GT OIT per their incident policy.

### 4.2 User data deletion / disconnect requests
- Self-service: users use **Settings → Your data → Export / Delete**.
- Operator: `POST /api/user/delete-data` (full erasure, cascades + revokes) or
  `POST /api/user/disconnect-canvas` (revoke tokens, keep content).
- Deletion removes the `users` row, which cascades to content tables, purges Supabase
  Storage objects under `{user_id}/`, and (via trigger
  `migrations/007_rate_limits_cascade.sql`) purges rate-limit buckets.

### 2.6 Redis (`RATELIMIT_STORAGE_URI`)

Production requires a shared Redis-compatible store (e.g. Upstash). Create the
database, store the URI in Secret Manager as `ratelimit-storage-uri`, and redeploy.
The deploy script does not provision Redis automatically.

### 4.3 Abuse / runaway syncs
- Per-user spacing (`MIN_SECONDS_BETWEEN_COURSE_SYNCS`) and hourly caps
  (`COURSE_SYNC_RATE_LIMIT_PER_HOUR`) are enforced in the shared store, so they
  hold across instances. Tighten via env + redeploy.
- Platform-level: use the rate limiter (`RATELIMIT_STORAGE_URI`) and Cloud Run
  max-instances / concurrency limits.

---

## 5. Database migrations

Apply SQL migrations in `backend/migrations/` in numeric order against the
Supabase project. Data-repair migrations (e.g. `005_repair_account_keys.py`) run
as Python scripts with `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` set; use
`--dry-run` first.

**Before OIT submission / after deploy to an environment with existing users:**

```bash
cd backend
python migrations/005_repair_account_keys.py --dry-run
python migrations/005_repair_account_keys.py
```

Apply `008_session_version.sql` for server-side session revocation support.

---

## 6. Verification after deploy

Run the end-to-end checks in `docs/PROD_VERIFICATION.md` after every production
deploy (health, OAuth round-trip, consent gating, sync, export/delete).
