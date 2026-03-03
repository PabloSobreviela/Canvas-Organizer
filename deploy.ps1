# Canvas Organizer - Secure Deployment Script
# Deploys backend to Cloud Run and frontend to Firebase Hosting.
# Ensures no .env files or secrets are deployed; uses Secret Manager for sensitive config.
#
# Prerequisites:
#   1. gcloud CLI installed and authenticated: gcloud auth login
#   2. Firebase CLI installed and logged in: firebase login
#   3. CANVAS_TOKEN_ENCRYPTION_KEY stored in Secret Manager (see below)
#   4. frontend/.env.production exists with REACT_APP_* (gitignored; never committed)
#
# Create the encryption key secret (run once):
#   $key = python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
#   echo $key | gcloud secrets create canvas-token-encryption-key --data-file=-
#   # Or: gcloud secrets create canvas-token-encryption-key --replication-policy=automatic
#   # Then add the secret value in GCP Console

param(
    [switch]$BackendOnly,
    [switch]$FrontendOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$ProjectId = "canvas-organizer-4437b"
$Region = "us-central1"
$ServiceName = "canvas-organizer-backend"
$SecretName = "canvas-token-encryption-key"

function Write-Step { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok { param($msg) Write-Host "OK: $msg" -ForegroundColor Green }
function Write-Err { param($msg) Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

# Verify tools
Write-Step "Checking prerequisites..."
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) { Write-Err "gcloud CLI not found. Install: https://cloud.google.com/sdk/docs/install" }
if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) { Write-Err "Firebase CLI not found. Install: npm install -g firebase-tools" }
# Docker not required: Cloud Build builds the image when using --source

# Set project (use cmd to avoid PowerShell treating gcloud Production-tag caution as error)
cmd /c "gcloud config set project $ProjectId 2>nul"
if ($LASTEXITCODE -ne 0) { Write-Err "Failed to set gcloud project. Run: gcloud auth login" }

# Verify encryption secret exists and Cloud Run has access (required for backend)
if (-not $FrontendOnly) {
    $secretExists = cmd /c "gcloud secrets describe $SecretName --project=$ProjectId 2>nul"
    if (-not $secretExists) {
        Write-Err "Secret '$SecretName' not found. Run: .\scripts\setup-secret.ps1"
    }
    # Ensure default compute SA can access the secret
    $projNum = (cmd /c "gcloud projects describe $ProjectId --format=`"value(projectNumber)`" 2>nul")
    $computeSA = "$projNum-compute@developer.gserviceaccount.com"
    cmd /c "gcloud secrets add-iam-policy-binding $SecretName --member=`"serviceAccount:$computeSA`" --role=`"roles/secretmanager.secretAccessor`" --project=$ProjectId 2>nul"
}

if (-not $BackendOnly) {
    Write-Step "Building frontend..."
    if (-not (Test-Path "frontend\.env.production")) {
        Write-Err "frontend/.env.production not found. Copy from frontend/.env.template and fill in REACT_APP_API_URL, REACT_APP_FIREBASE_* values. Never commit this file."
    }
    Push-Location frontend
    try {
        $ea = $ErrorActionPreference; $ErrorActionPreference = "Continue"
        npm ci 2>$null; if ($LASTEXITCODE -ne 0) { npm install 2>$null }
        npm run build 2>$null
        $ErrorActionPreference = $ea
        if ($LASTEXITCODE -ne 0) { Write-Err "Frontend build failed" }
        Write-Ok "Frontend build complete"
    } finally { Pop-Location }

    Write-Step "Deploying frontend to Firebase Hosting..."
    firebase deploy --only hosting
    if ($LASTEXITCODE -ne 0) { Write-Err "Firebase deploy failed" }
    Write-Ok "Frontend deployed"
}

if (-not $FrontendOnly) {
    Write-Step "Building and deploying backend to Cloud Run (using Cloud Build)..."
    Push-Location backend
    try {
        $gcloudArgs = "run deploy $ServiceName --source . --region $Region --platform managed --allow-unauthenticated --set-secrets=CANVAS_TOKEN_ENCRYPTION_KEY=$SecretName`:latest --set-env-vars=USE_FIRESTORE=true,GCP_PROJECT_ID=$ProjectId,GCP_LOCATION=$Region,FIREBASE_PROJECT_ID=$ProjectId,GCS_BUCKET=canvas-organizer-files"
        cmd /c "gcloud $gcloudArgs 2>nul"
        if ($LASTEXITCODE -ne 0) { Write-Err "Cloud Run deploy failed" }
        Write-Ok "Backend deployed"
    } finally { Pop-Location }
}

Write-Host "`nDeployment complete. No .env files or secrets were included in the deployed artifacts." -ForegroundColor Green
$projNum = (cmd /c "gcloud projects describe $ProjectId --format=value(projectNumber) 2>nul")
Write-Host "Backend: https://$ServiceName-$projNum.$Region.run.app" -ForegroundColor Gray
Write-Host "Frontend: https://canvas-organizer-4437b.web.app" -ForegroundColor Gray
