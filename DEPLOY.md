# Deploy

CanvasSync uses a **split deploy**: frontend on Vercel, backend on Google Cloud Run.

| Layer | Host | How |
| --- | --- | --- |
| Frontend | **Vercel** | Git integration or `vercel --prod` from `frontend/` |
| Backend | **Google Cloud Run** | Root [`deploy.ps1`](deploy.ps1) |

There is no Firebase Hosting path. See [`vercel.json`](vercel.json) and
[`docs/OPS_RUNBOOK.md`](docs/OPS_RUNBOOK.md) for configuration.

## Backend (Cloud Run)

```powershell
# From repo root — provisions secrets from GCP Secret Manager
.\deploy.ps1 -FrontendUrl "https://canvassync.app"
```

The script:
- Verifies required Secret Manager secrets exist
- Deploys `backend/` to Cloud Run service `canvassync-backend` (region `us-central1`)
- Sets `APP_ENV=production`, `CLOUD_MODE=true`, and mounts all production secrets

### First-time GCP auth

```powershell
gcloud auth login
gcloud config set project YOUR_GCP_PROJECT_ID
```

### Required Secret Manager secrets

| Secret name | Env var |
| --- | --- |
| `session-secret-key` | `SESSION_SECRET_KEY` |
| `canvas-token-encryption-key` | `CANVAS_TOKEN_ENCRYPTION_KEY` |
| `supabase-url` | `SUPABASE_URL` |
| `supabase-service-key` | `SUPABASE_SERVICE_KEY` |
| `canvas-oauth-client-id` | `CANVAS_OAUTH_CLIENT_ID` |
| `canvas-oauth-client-secret` | `CANVAS_OAUTH_CLIENT_SECRET` |
| `openrouter-api-key` | `LLM_API_KEY` |
| `ratelimit-storage-uri` | `RATELIMIT_STORAGE_URI` |

Create secrets manually before first deploy, e.g.:

```powershell
echo -n "YOUR_VALUE" | gcloud secrets create session-secret-key --data-file=-
```

Also set non-secret env vars via deploy parameters: `FRONTEND_URL`,
`CANVAS_OAUTH_REDIRECT_URI` (defaults derived from `-FrontendUrl`).

### Reduce cold starts

```powershell
.\deploy.ps1 -FrontendUrl "https://canvassync.app" -MinInstances 1
```

## Frontend (Vercel)

1. Link the repo to Vercel with root directory `frontend/` (or use root `vercel.json`).
2. Set production env: `REACT_APP_API_URL=https://YOUR_CLOUD_RUN_URL`
3. Deploy via Git push or:

```bash
cd frontend
vercel --prod
```

Do **not** set `REACT_APP_ENABLE_MANUAL_TOKEN_CONNECT=true` in production.

## Post-deploy verification

```bash
python backend/tools/verify_deploy.py https://YOUR_CLOUD_RUN_URL \
  --origin https://canvassync.app
```

See [`docs/PROD_VERIFICATION.md`](docs/PROD_VERIFICATION.md) for the full checklist
(including OAuth round-trip once GT provisions the developer key).
