# One-time setup: Create CANVAS_TOKEN_ENCRYPTION_KEY in Secret Manager
# Run this before first deploy if the secret does not exist.
#
# The key encrypts Canvas API tokens in Firestore. Generate a new Fernet key.

$ErrorActionPreference = "Stop"
$ProjectId = "canvas-organizer-4437b"
$SecretName = "canvas-token-encryption-key"

Write-Host "Creating Fernet encryption key..." -ForegroundColor Cyan
$key = python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
if (-not $key) { Write-Err "Failed to generate key. Ensure: pip install cryptography" }

Write-Host "Creating secret in Secret Manager..." -ForegroundColor Cyan
$key | gcloud secrets create $SecretName --replication-policy=automatic --project=$ProjectId 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Secret '$SecretName' created successfully." -ForegroundColor Green
} else {
    # Secret might already exist - try adding a version
    Write-Host "Secret may already exist. Adding new version..." -ForegroundColor Yellow
    $key | gcloud secrets versions add $SecretName --data-file=- --project=$ProjectId
    if ($LASTEXITCODE -eq 0) { Write-Host "New version added." -ForegroundColor Green }
    else { Write-Host "Run: gcloud secrets create $SecretName --replication-policy=automatic" -ForegroundColor Yellow }
}

Write-Host "`nGrant Cloud Run access to the secret:" -ForegroundColor Cyan
Write-Host "  gcloud secrets add-iam-policy-binding $SecretName --member=serviceAccount:93870731079-compute@developer.gserviceaccount.com --role=roles/secretmanager.secretAccessor --project=$ProjectId"
Write-Host "`n(Use your project's default compute SA; get it: gcloud iam service-accounts list --project=$ProjectId)" -ForegroundColor Gray
