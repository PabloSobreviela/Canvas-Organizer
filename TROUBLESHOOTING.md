# Troubleshooting: Cloud Run 503 Errors & CORS Failures

## Symptoms

- Frontend shows **CORS policy errors**: `No 'Access-Control-Allow-Origin' header is present`
- Browser console shows `net::ERR_FAILED` on all API calls
- Backend health endpoint (`/api/health`) returns **503 Service Unavailable**
- App appears stuck on "Connecting..." or reloads endlessly

> **Key insight:** If the health endpoint itself returns 503, the problem is NOT CORS configuration — the backend container is failing to start. CORS headers are absent because Flask never runs.

---

## Root Cause: Python Version Incompatibility (2026-02-10)

### What happened

The Cloud Run container uses **Python 3.11** (`Dockerfile`: `FROM python:3.11`), but development was done on **Python 3.12+**.

Python 3.12 relaxed f-string parsing rules to allow `#` comments inside `{}` expressions. Python 3.11 does **not** allow this and raises a `SyntaxError` at import time.

The offending code was in `backend/ai/gemini_model.py`, inside a large f-string prompt:

```python
# ❌ BROKEN on Python 3.11 — # inside f-string {} expression
full_prompt = f"""...
{json.dumps([{
    "cid": a["canvas_assignment_id"],
    "nam": a["name"],
    "due": a["ai_ready_date"],
    # This comment causes SyntaxError on Python 3.11!
    "des": (a.get("description") or "")[:600]
} for a in clean_assignments], ensure_ascii=False, indent=2)}
..."""
```

### The error message

```
SyntaxError: f-string expression part cannot include '#' (gemini_model.py, line 198)
```

### Why it was hard to find

1. `py_compile` on the local machine (Python 3.12+) passed — the syntax is valid in 3.12.
2. Cloud Run logs were **silent** by default — gunicorn workers crashed before Flask could handle any request, and the default error output was not visible in `gcloud logging read` without specific formatting.
3. The 503 response has no body and no CORS headers, making it look like a CORS misconfiguration.

### The fix

Remove `#` comments from inside f-string `{}` expression blocks:

```python
# ✅ FIXED — comment removed from inside the expression
full_prompt = f"""...
{json.dumps([{
    "cid": a["canvas_assignment_id"],
    "nam": a["name"],
    "due": a["ai_ready_date"],
    "des": (a.get("description") or "")[:600]
} for a in clean_assignments], ensure_ascii=False, indent=2)}
..."""
```

---

## Root Cause: Gemini Model Retired / Invalid Model Name (2026-02-10)

If `/api/resolve_course_dates` fails with something like:

```
404 Publisher Model `.../publishers/google/models/gemini-1.5-flash` was not found or your project does not have access to it.
```

That means the backend is configured to use a model name that is no longer available (or not enabled for your project).

### Fix

1. Update the Cloud Run env var `MODEL_NAME` to a supported model version (recommended: `gemini-2.5-flash-lite`).
2. Redeploy the backend so the new env vars apply.

```powershell
.\scripts\deploy.ps1 -Only backend -ModelName gemini-2.5-flash-lite
```

---

## Diagnostic Playbook

If you see 503 errors again, follow this sequence:

### Step 1: Confirm the container is failing (not a CORS issue)

```bash
curl -v https://canvas-organizer-backend-93870731079.us-central1.run.app/api/health
```

- **200 OK** → Container is running. Problem is in CORS config or frontend.
- **503** → Container is crashing. Proceed to Step 2.

### Step 2: Check Cloud Run logs

```bash
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=canvas-organizer-backend" \
  --limit 80 \
  --format="csv(timestamp,textPayload)" \
  --freshness=2h \
  | Out-File -FilePath debug_logs.log -Encoding ascii
```

Then open `debug_logs.log` and look for:
- `Worker exiting (pid: ...)` → Worker crashed during startup
- `SyntaxError` or `ImportError` → Code issue
- `ModuleNotFoundError` → Missing dependency in `requirements.txt`
- No logs at all → Container OOMing before it can log (increase `--memory`)

### Step 3: Check environment variables

```bash
gcloud run services describe canvas-organizer-backend \
  --region us-central1 \
  --format="yaml(spec.template.spec.containers[0].env)"
```

Required env vars for cloud mode:
| Variable | Example | Purpose |
|---|---|---|
| `USE_FIRESTORE` | `true` | Enables Firestore + Firebase Auth |
| `GCP_PROJECT_ID` | `canvas-organizer-4437b` | Vertex AI project |
| `GCP_LOCATION` | `us-central1` | Vertex AI region |
| `FIREBASE_PROJECT_ID` | `canvas-organizer-4437b` | Firebase token verification |
| `MODEL_NAME` | `gemini-2.5-flash-lite` | AI model for date resolution |
| `CANVAS_TOKEN_ENCRYPTION_KEY` | (Fernet key) | Encrypts stored Canvas tokens |

### Step 4: Check resource limits

```bash
gcloud run services describe canvas-organizer-backend \
  --region us-central1 \
  --format="value(spec.template.spec.containers[0].resources.limits)"
```

- Minimum recommended: `memory=1Gi`
- Current production: `memory=2Gi, cpu=2`
- If memory is `512Mi`, increase it — the Python stack with AI libraries needs more.

### Step 5: Inject debug logging (last resort)

If logs are empty, add this to the top of `app.py` temporarily:

```python
import sys
print("--- [BOOT] app.py STARTING ---", file=sys.stdout, flush=True)

# Wrap each import group in try/except:
try:
    from flask import Flask, request, jsonify, g
    print("--- [BOOT] Flask OK ---", file=sys.stdout, flush=True)
except Exception as e:
    print(f"--- [BOOT] Flask FAILED: {e} ---", file=sys.stdout, flush=True)
    sys.exit(1)

try:
    from ai.gemini_model import resolve_assignment_dates_with_gemini
    print("--- [BOOT] AI model OK ---", file=sys.stdout, flush=True)
except Exception as e:
    print(f"--- [BOOT] AI model FAILED: {e} ---", file=sys.stdout, flush=True)
    sys.exit(1)
```

Deploy, trigger the error, then check logs per Step 2. **Remove the debug logging after diagnosing.**

---

## Common Pitfalls

| Pitfall | Rule |
|---|---|
| `#` comments inside f-string `{}` | **Never** use `#` inside f-string expressions when targeting Python <3.12 |
| Heavy imports at module level | Defer `import vertexai` into functions — it takes 15-40s to import |
| Missing `FIREBASE_PROJECT_ID` | Always set explicitly; don't rely on `GOOGLE_CLOUD_PROJECT` fallback |
| Low memory (`512Mi`) | Python + Firebase + AI SDK needs ≥1Gi; use 2Gi for safety |
| `Dockerfile` Python version | Currently `python:3.11` — if upgrading, test f-string syntax compatibility |

---

## Deployment Command Reference

```powershell
# Backend only
.\scripts\deploy.ps1 -Only backend

# Frontend only
.\scripts\deploy.ps1 -Only hosting

# Both
.\scripts\deploy.ps1
```

The deploy script (`scripts/deploy.ps1`) sets `--memory 1Gi`, `--cpu 1`, and `FIREBASE_PROJECT_ID` automatically.
Use `-Memory 2Gi -Cpu 2` only if you confirm your workload needs it.

---

## Cloud Cost Audit Endpoint

New backend endpoint:

- `GET /api/cloud/cost-audit`

It returns:

- Time-bucketed spend (`series`) so you can see **when** costs happened.
- Cloud Run breakdowns by SKU/service/revision/resource.
- Artifact Registry breakdowns by SKU/repository/resource.

### Required env vars (Cloud Run backend)

| Variable | Example |
|---|---|
| `GCP_BILLING_PROJECT_ID` | `canvas-organizer-4437b` |
| `GCP_BILLING_DATASET` | `billing_export` |
| `GCP_BILLING_TABLE` | `gcp_billing_export_v1_xxxxx_xxxxx` |

Optional:

| Variable | Example | Purpose |
|---|---|---|
| `GCP_BILLING_FILTER_PROJECT_ID` | `canvas-organizer-4437b` | Project filter inside billing table |
| `GCP_BILLING_BQ_LOCATION` | `US` | BigQuery job location |
| `GCP_CLOUD_RUN_SERVICE` | `canvas-organizer-backend` | Default Cloud Run service filter |
| `GCP_ARTIFACT_REPOSITORY` | `my-repo` | Default Artifact Registry repository filter |
| `CLOUD_COST_ALLOWED_EMAILS` | `you@example.com` | Comma-separated allowlist |
| `ENABLE_CLOUD_COST_AUDIT_ENDPOINT` | `true` | Enable/disable endpoint |

### Terminal script

Use:

```powershell
.\scripts\cloud_cost_audit.ps1 `
  -ApiBase "https://<your-cloud-run-url>" `
  -Token "<firebase-id-token>" `
  -Days 7 `
  -Granularity day
```

Local backend (no auth in local mode):

```powershell
.\scripts\cloud_cost_audit.ps1 -ApiBase "http://localhost:5000" -Days 7
```
