# Deploy

This repo deploys:
- Frontend: Firebase Hosting (target `app`, project `canvas-organizer-4437b`)
- Backend: Google Cloud Run (service `canvas-organizer-backend`, region `us-central1`)

## One Command

```powershell
.\scripts\deploy.ps1
```

## First-Time Auth (Your Machine)

```powershell
firebase login --reauth
gcloud auth login
```

## Deploy Only One Side

```powershell
.\scripts\deploy.ps1 -Only hosting
.\scripts\deploy.ps1 -Only backend
```

## Reduce Cold Starts (Faster First Load)

Cloud Run cold starts are the main reason the first page load can take 10-20s after inactivity.
To keep at least one warm instance running (cost tradeoff):

```powershell
.\scripts\deploy.ps1 -Only backend -MinInstances 1
```

By default, `scripts/deploy.ps1` deploys with `-MinInstances 0` (scale to zero) unless you override it.

## Notes

- The script runs `npm --prefix frontend run build` before deploying Hosting (use `-SkipBuild` to skip).
- If Firebase says your credentials are invalid: run `firebase login --reauth` and retry.
- If Cloud Run deploy fails due to auth: run `gcloud auth login` and retry.

## Optional: Configure Cloud Cost Audit Endpoint

If you want `/api/cloud/cost-audit` to work after deploy, include your billing export settings:

```powershell
.\scripts\deploy.ps1 -Only backend `
  -BillingProject "canvas-organizer-4437b" `
  -BillingDataset "billing_export" `
  -BillingTable "gcp_billing_export_v1_xxxxx_xxxxx" `
  -BillingFilterProject "canvas-organizer-4437b" `
  -BillingLocation "US"
```

Optional access restriction:

```powershell
.\scripts\deploy.ps1 -Only backend -CostAuditAllowedEmails "you@example.com"
```
