# Security Guidelines

## Credentials and Secrets

- **Never commit** `.env`, `.env.local`, `.env.production`, or any file containing API keys, tokens, or credentials.
- Use `.env.template` files as the only committed reference for required environment variables. Copy to `.env` and fill in values locally.
- **Never commit** `*-key.json`, `*.pem`, or GCP service account files.
- In production, use Google Cloud Secret Manager (see [`deploy.ps1`](deploy.ps1)).
- If credentials were ever committed, **rotate them immediately**.

## Environment Variables

- `backend/.env` and `frontend/.env.local` are gitignored. Do not force-add them.

## Local Mode

- Local development mode (`APP_ENV=development`, SQLite) has **no authentication**. Do not expose it publicly.
- Production requires `APP_ENV=production`, Supabase, Canvas OAuth, and all secrets in `validate_production_secrets`.

## Sessions

- Production sessions use **HttpOnly cookies** on the API domain only. Session JWTs are not stored in `localStorage`.
- Logout increments a server-side `session_version` to invalidate outstanding cookies.

## Rate Limiting

- `RELAX_SYNC_RATE_LIMITS_FOR_TESTING` must **never** be set in production.
- Multi-instance or general-launch production requires a shared
  `RATELIMIT_STORAGE_URI` (Redis/Upstash).
- The documented pre-launch containment deployment may use `memory://` only
  with `ALLOW_IN_MEMORY_RATE_LIMITS=true` and Cloud Run capped at one instance.

## Dependencies

- **Backend:** `pip-audit -r backend/requirements.txt` (also run in CI).
- **Frontend:** `npm audit` in `frontend/`.
