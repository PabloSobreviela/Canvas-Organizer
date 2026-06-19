# CanvasSync - Canonical deployment pipeline
# =============================================================================
# Frontend host: VERCEL (the only configured host; see vercel.json). The
#   frontend deploys via Vercel's Git integration or `vercel --prod`. This
#   script does NOT deploy the frontend.
# Backend host: Google Cloud Run.
#
# This script is FAIL-CLOSED: it refuses to deploy unless every secret the
# backend requires in production (see backend/auth.py validate_production_secrets)
# already exists in Google Secret Manager. This prevents shipping a revision that
# boots into a misconfigured/insecure state.
#
# One-time secret setup (store each value in Secret Manager):
#   "value" | gcloud secrets create <name> --data-file=- --replication-policy=automatic
#
# Required secrets (Secret Manager name -> backend env var):
#   session-secret-key            -> SESSION_SECRET_KEY
#   canvas-token-encryption-key   -> CANVAS_TOKEN_ENCRYPTION_KEY
#   supabase-url                  -> SUPABASE_URL
#   supabase-service-key          -> SUPABASE_SERVICE_KEY
#   canvas-oauth-client-id        -> CANVAS_OAUTH_CLIENT_ID
#   canvas-oauth-client-secret    -> CANVAS_OAUTH_CLIENT_SECRET
#   openrouter-api-key            -> LLM_API_KEY
# A distributed RATELIMIT_STORAGE_URI (for example redis://...) is required for
# general launch. The temporary in-memory switch exists only so containment and
# other security fixes can be deployed before that service is provisioned.
# =============================================================================

param(
    [string]$ProjectId = "canvas-organizer-4437b",
    [string]$Region = "us-central1",
    [string]$ServiceName = "canvas-organizer-backend",

    # Non-secret runtime config:
    [Parameter(Mandatory = $true)][string]$FrontendUrl,            # e.g. https://canvassync.app
    [Parameter(Mandatory = $true)][string]$CanvasOAuthRedirectUri, # e.g. https://<backend>/api/auth/canvas/callback
    [string]$CanvasInstanceUrl = "https://gatech.instructure.com",
    [string]$SupabaseStorageBucket = "course-files",
    [string]$DisclosedAiProviders = "openrouter,deepinfra",
    [string]$ModelName = "qwen/qwen3.5-flash-02-23",
    [string]$RateLimitStorageUri = "memory://",

    [switch]$AllowTemporaryInMemoryRateLimits,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Write-Step { param($m) Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Err  { param($m) Write-Host "ERROR: $m" -ForegroundColor Red; exit 1 }

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Err "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install"
}

# Map of Secret Manager secret name -> backend env var name.
$requiredSecrets = [ordered]@{
    "session-secret-key"          = "SESSION_SECRET_KEY"
    "canvas-token-encryption-key" = "CANVAS_TOKEN_ENCRYPTION_KEY"
    "supabase-url"                = "SUPABASE_URL"
    "supabase-service-key"        = "SUPABASE_SERVICE_KEY"
    "canvas-oauth-client-id"      = "CANVAS_OAUTH_CLIENT_ID"
    "canvas-oauth-client-secret"  = "CANVAS_OAUTH_CLIENT_SECRET"
    "openrouter-api-key"          = "LLM_API_KEY"
}

cmd /c "gcloud config set project $ProjectId 2>nul"
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to set gcloud project. Run: gcloud auth login" }

# Fail closed: verify every required secret exists before deploying.
Write-Step "Verifying required secrets exist in Secret Manager..."
$projNum = (cmd /c "gcloud projects describe $ProjectId --format=`"value(projectNumber)`" 2>nul").Trim()
$computeSA = "$projNum-compute@developer.gserviceaccount.com"
$missing = @()
$secretFlags = @()
foreach ($name in $requiredSecrets.Keys) {
    $exists = cmd /c "gcloud secrets describe $name --project=$ProjectId 2>nul"
    if (-not $exists) {
        $missing += $name
        continue
    }
    # Ensure the Cloud Run runtime SA can read the secret.
    cmd /c "gcloud secrets add-iam-policy-binding $name --member=`"serviceAccount:$computeSA`" --role=`"roles/secretmanager.secretAccessor`" --project=$ProjectId 2>nul" | Out-Null
    $secretFlags += ("{0}={1}:latest" -f $requiredSecrets[$name], $name)
}
if ($missing.Count -gt 0) {
    Write-Err ("Missing required secrets in Secret Manager: " + ($missing -join ", ") + "`nCreate them before deploying (see header of this script).")
}
$setSecrets = $secretFlags -join ","

if ($RateLimitStorageUri.StartsWith("memory://") -and -not $AllowTemporaryInMemoryRateLimits) {
    Write-Err "A distributed RateLimitStorageUri is required. Use -AllowTemporaryInMemoryRateLimits only for the documented pre-launch containment deployment."
}

# Non-secret runtime configuration.
$envVarsList = @(
    "APP_ENV=production",
    "CLOUD_MODE=true",
    "FRONTEND_URL=$FrontendUrl",
    "CANVAS_OAUTH_REDIRECT_URI=$CanvasOAuthRedirectUri",
    "CANVAS_INSTANCE_URL=$CanvasInstanceUrl",
    "SUPABASE_STORAGE_BUCKET=$SupabaseStorageBucket",
    "DISCLOSED_AI_PROVIDERS=$DisclosedAiProviders",
    "MODEL_NAME=$ModelName",
    "LLM_BASE_URL=https://openrouter.ai/api/v1",
    "OPENROUTER_PROVIDER_ONLY=deepinfra",
    "OPENROUTER_ENFORCE_ZDR=true",
    "OPENROUTER_DENY_DATA_COLLECTION=true",
    "OPENROUTER_ALLOW_FALLBACK=false",
    "RATELIMIT_STORAGE_URI=$RateLimitStorageUri",
    ("ALLOW_IN_MEMORY_RATE_LIMITS=" + $(if ($AllowTemporaryInMemoryRateLimits) { "true" } else { "false" })),
    "STORE_RAW_CANVAS_JSON=false",
    "ENABLE_AI_USAGE_LOGS_DASHBOARD=false",
    "ENABLE_CLOUD_COST_AUDIT_ENDPOINT=false",
    "ENABLE_DEMO_SESSION=true"
)
$envVars = $envVarsList -join ","

Write-Step "Deploying backend to Cloud Run (fail-closed config)..."
$runArgs = "run deploy $ServiceName --source backend --region $Region --platform managed --allow-unauthenticated --set-secrets=$setSecrets --set-env-vars=$envVars"
Write-Host "    gcloud $runArgs"
if (-not $DryRun) {
    cmd /c "gcloud $runArgs"
    if ($LASTEXITCODE -ne 0) { Write-Err "Cloud Run deploy failed" }
}

Write-Host "`nBackend deployed. Frontend is hosted on Vercel (deploy via Git or 'vercel --prod')." -ForegroundColor Green
Write-Host "Verify the deployment with docs/PROD_VERIFICATION.md" -ForegroundColor Gray
