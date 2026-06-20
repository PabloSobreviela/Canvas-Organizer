# Production Verification

Run after every production deploy. Combines an automated read-only harness with
a short manual authenticated flow.

## 1. Automated checks (read-only)

```bash
cd backend
  python tools/verify_deploy.py https://<backend-host> --origin https://canvas-organizer.vercel.app
```

This confirms (exit code 0 = all passed):

- `/api/health` returns 200 with security headers
  (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`,
  `Content-Security-Policy`).
- Authenticated endpoints (`/api/auth/me`, `/api/user/data`, `/api/user/export`)
  reject anonymous requests (401/403).
- Canvas ingestion endpoints (`/api/canvas/courses`, `/api/sync_assignments`,
  `/api/user/disconnect-canvas`) reject anonymous requests.
- CORS echoes a configured origin and rejects an unknown one.

## 2. Boot / configuration (fail-closed)

- Confirm the revision became healthy. If it crash-looped, check logs for
  `Missing required production configuration: ...` — provision the missing
  secret/env var (see `docs/OPS_RUNBOOK.md`) and redeploy.
- Confirm the boot log line `BOOT: APP_ENV=production IS_PRODUCTION=True
  CLOUD_MODE=True STORE_RAW_CANVAS_JSON=False`.

## 3. Manual authenticated flow

1. **OAuth round-trip:** Visit the frontend, click *Sign in with Canvas*,
   complete the Canvas authorization, and confirm you land back signed in.
2. **Consent gating:** As a brand-new user (no consent yet), attempt a course
   sync and confirm it is blocked with `legal_consent_required` until you accept
   the consent modal. After accepting, the sync proceeds.
3. **Sync:** Sync a course; confirm courses/assignments appear.
4. **Token refresh:** Leave the session idle past the access-token lifetime (or
   force it) and confirm a subsequent sync still works (auto-refresh), and that
   stored data remains visible (stable account key, R2).
5. **Export:** Settings → Your data → *Export my data*; confirm a JSON download
   containing your courses/assignments and NO token ciphertext.
6. **Disconnect:** Settings → *Disconnect*; confirm Canvas credentials are
   cleared server-side (a subsequent sync prompts re-connect) and stored data is
   retained.
7. **Delete:** Settings → *Delete all my data*; confirm you are signed out and
   that re-login shows no prior data. Confirm Supabase Storage has no objects
   under `{user_id}/` (Track C erasure).
8. **CSRF:** with a valid session, send an unsafe request from an untrusted
   Origin without `X-CanvasSync-CSRF`; confirm HTTP 403 and `csrf_failed`.

## 4. Data-handling spot checks (DB + Storage)

- In Supabase, confirm new assignment/announcement rows have `raw_canvas_json` /
  `raw_json` NULL in production (minimization, R4).
- Confirm a user's content rows share a single stable `canvas_credential_key`
  that does not change across token refreshes (R2).

## 5. Retention

- Trigger retention once using the private Cloud Run Job (or
  `python retention_service.py` against staging) and confirm it reports delete
  counts without error. There is no public retention endpoint.
