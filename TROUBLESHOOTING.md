# Troubleshooting

Production stack: **Vercel** (frontend) + **Google Cloud Run** (backend) + **Supabase**.

## Backend won't start (Cloud Run)

**Symptom:** Revision fails health checks or logs `Missing required production configuration`.

**Fix:** Ensure all secrets in [`deploy.ps1`](deploy.ps1) exist in GCP Secret Manager and
`APP_ENV=production` is set. See [`docs/OPS_RUNBOOK.md`](docs/OPS_RUNBOOK.md) §1.

Common missing vars:
- `SESSION_SECRET_KEY` (≥32 characters)
- `CANVAS_TOKEN_ENCRYPTION_KEY` (Fernet key)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `CANVAS_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI`
- `FRONTEND_URL`
- `RATELIMIT_STORAGE_URI` (must not be `memory://` in production)
- `DEEPINFRA_API_KEY` (required for direct AI date extraction)

## OAuth / "Sign in with Canvas" fails

1. **Developer key not provisioned** — GT OIT must create the key; see
   [`docs/GT_OIT_OUTREACH.md`](docs/GT_OIT_OUTREACH.md).
2. **Redirect URI mismatch** — must exactly match Cloud Run URL +
   `/api/auth/canvas/callback` registered on the Canvas developer key.
3. **CORS** — `FRONTEND_URL` must match the Vercel origin; check browser devtools
   for blocked preflight.
4. **Cookies** — session cookie is on the API domain; frontend must call API with
   `credentials: 'include'`.

## Sync returns 403 `legal_consent_required`

User must accept the consent modal before any Canvas data is ingested. If consent
version changed, re-accept from the modal.

## Assignments disappear after reconnect

Run account-key repair migration if upgrading from an older deploy:

```bash
cd backend
python migrations/005_repair_account_keys.py --dry-run
python migrations/005_repair_account_keys.py
```

## CORS errors from Vercel preview deploys

Production Cloud Run only allows configured origins. For preview URLs, set:

```
CORS_ALLOWED_ORIGIN_PATTERNS=https://your-project-*.vercel.app
```

## Local development

Local mode uses SQLite with **no authentication**. Never expose locally with
`APP_ENV=production` unset on a public host.

```bash
cd backend && python app.py   # http://localhost:5000
cd frontend && npm start      # http://localhost:3000
```

Set `REACT_APP_API_URL=http://localhost:5000` in `frontend/.env.local`.

Cloud mode locally: `CLOUD_MODE=true` in `backend/.env` with Supabase credentials.

## Memory / timeouts on Cloud Run

Python + AI SDK needs ≥1Gi. Default in `deploy.ps1` is 2Gi. Increase if syncs
timeout:

```powershell
.\deploy.ps1 -Memory 4Gi
```

## Rate limit / sync throttled

Course-sync spacing and hourly caps use the Supabase `rate_limits` table.
Flask endpoint limits use `RATELIMIT_STORAGE_URI`; `memory://` is process-local.
If a shared Redis-compatible URI is configured, verify it is reachable from
Cloud Run before representing those endpoint limits as multi-instance safe.

## Verification harness

```bash
python backend/tools/verify_deploy.py https://YOUR_BACKEND_URL \
  --origin https://canvas-organizer.vercel.app
```

See [`docs/PROD_VERIFICATION.md`](docs/PROD_VERIFICATION.md).
