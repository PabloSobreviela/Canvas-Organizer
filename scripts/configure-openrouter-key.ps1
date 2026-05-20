# Push OpenRouter API key from backend/.env to Cloud Run via Secret Manager + env binding.
# Usage: set LLM_API_KEY in backend/.env, then:
#   .\scripts\configure-openrouter-key.ps1

param(
  [string]$CloudRunService = "canvas-organizer-backend",
  [string]$CloudRunRegion = "us-central1",
  [string]$GcpProject = "canvas-organizer-4437b",
  [string]$SecretName = "openrouter-api-key",
  [string]$EnvFile = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $EnvFile) {
  $EnvFile = Join-Path $repoRoot "backend\.env"
}

if (-not (Test-Path $EnvFile)) {
  throw "Missing env file: $EnvFile"
}

$llmKey = ""
foreach ($line in Get-Content $EnvFile) {
  if ($line -match '^\s*LLM_API_KEY\s*=\s*(.+)\s*$') {
    $llmKey = $Matches[1].Trim().Trim('"').Trim("'").Trim([char]0xFEFF)
    break
  }
}

if (-not $llmKey -or $llmKey -eq "your-openrouter-api-key") {
  throw @"
LLM_API_KEY is not configured in $EnvFile.
Add your OpenRouter key, save the file, then re-run:
  .\scripts\configure-openrouter-key.ps1
"@
}

$serviceAccount = (gcloud run services describe $CloudRunService `
  --region $CloudRunRegion `
  --project $GcpProject `
  --format="value(spec.template.spec.serviceAccountName)" 2>$null)

if (-not $serviceAccount) {
  $serviceAccount = "$((gcloud config get-value project 2>$null) -replace '\D','')-compute@developer.gserviceaccount.com"
}

Write-Host "Project: $GcpProject"
Write-Host "Secret:  $SecretName"
Write-Host "Service: $CloudRunService ($CloudRunRegion)"

$secretExists = $false
try {
  gcloud secrets describe $SecretName --project $GcpProject 2>$null | Out-Null
  $secretExists = $true
} catch {
  $secretExists = $false
}

$tempFile = New-TemporaryFile
try {
  [System.IO.File]::WriteAllText($tempFile, $llmKey, [System.Text.UTF8Encoding]::new($false))

  if ($secretExists) {
    Write-Host "Adding new secret version..."
    gcloud secrets versions add $SecretName --project $GcpProject --data-file=$tempFile | Out-Null
  } else {
    Write-Host "Creating secret..."
    gcloud secrets create $SecretName --project $GcpProject --replication-policy=automatic --data-file=$tempFile | Out-Null
  }
} finally {
  Remove-Item -Force $tempFile -ErrorAction SilentlyContinue
}

Write-Host "Granting Secret Manager access to $serviceAccount..."
gcloud secrets add-iam-policy-binding $SecretName `
  --project $GcpProject `
  --member="serviceAccount:$serviceAccount" `
  --role="roles/secretmanager.secretAccessor" `
  --quiet | Out-Null

Write-Host "Updating Cloud Run to mount LLM_API_KEY from secret..."
gcloud run services update $CloudRunService `
  --project $GcpProject `
  --region $CloudRunRegion `
  --set-secrets="LLM_API_KEY=${SecretName}:latest" `
  --remove-env-vars="VERTEX_MODEL" `
  --quiet | Out-Null

Write-Host "Done. Demo AI resolve should work after the new revision is live."
