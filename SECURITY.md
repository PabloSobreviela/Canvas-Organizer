# Security Guidelines

## Credentials and Secrets

- **Never commit** `.env`, `.env.local`, `.env.production`, or any file containing API keys, tokens, or credentials.
- Use `.env.template` files as the only committed reference for required environment variables. Copy to `.env` and fill in values locally.
- **Never commit** `*-key.json`, `*.pem`, or any GCP/Firebase service account files. Use `GOOGLE_APPLICATION_CREDENTIALS` with a path to a file that lives only on the deployment machine.
- If `backend/Amazon secret access key.txt` or any AWS credential file ever existed in this project, **rotate those credentials immediately**.
- In production, use secret managers (e.g., Google Cloud Secret Manager) instead of `.env` files.
- If credentials were ever committed, **rotate them immediately** and remove from git history.

## Environment Variables

- `backend/.env` and `frontend/.env.local` / `frontend/.env.production` are gitignored. Do not force-add them.
- For `GOOGLE_APPLICATION_CREDENTIALS`, use a relative path (e.g. `./firebase-key.json`) or a path that exists only in your deployment environment—never commit absolute paths with usernames.

## Local Mode

- Local mode (`USE_FIRESTORE=false`) has **no authentication**. Do not expose it publicly.
- When running locally, the server will refuse to bind to `0.0.0.0` unless `ALLOW_LOCAL_PUBLIC=1` is explicitly set.
- A startup warning is shown when running in local mode.

## Rate Limiting

- `RELAX_SYNC_RATE_LIMITS_FOR_TESTING` must **never** be set in any public deployment or production environment.
- It is only intended for local development and is **ignored** when running on Cloud Run (`K_SERVICE` is set).
- Auth and credential endpoints are rate-limited to prevent brute force and credential stuffing.
- See `backend/.env.template` for documentation.

## Dependencies

- **Backend:** Run `pip install pip-audit && pip-audit` (or `safety check`) regularly. Upgrade vulnerable packages.
- **Frontend:** Run `npm audit` and `npm audit fix`. Remaining issues in `react-scripts` transitive deps may require migrating to Vite or upgrading react-scripts when a patched version is available.
