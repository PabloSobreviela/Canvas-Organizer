# Deployment verification results

Attach JSON output from `verify_deploy.py` to the OIT submission package.

## Generate results

```bash
python backend/tools/verify_deploy.py https://YOUR_BACKEND.run.app \
  --origin https://canvassync.app \
  --json-out docs/verification/verify_deploy_results.json
```

## Manual OAuth checklist (after GT developer key)

Complete `docs/PROD_VERIFICATION.md` §3 and note results here:

| Step | Date | Pass |
|------|------|------|
| OAuth round-trip | | |
| Consent gating | | |
| Sync | | |
| Token refresh | | |
| Export | | |
| Disconnect | | |
| Delete (+ Storage empty) | | |

## Migration 005

```bash
cd backend
python migrations/005_repair_account_keys.py --dry-run
python migrations/005_repair_account_keys.py
```

Record run date and row counts in the OIT package.
