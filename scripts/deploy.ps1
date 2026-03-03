param(
  [ValidateSet("all", "hosting", "backend")]
  [string]$Only = "all",

  [string]$FirebaseProject = "canvas-organizer-4437b",
  [string]$HostingTarget = "app",

  [string]$CloudRunService = "canvas-organizer-backend",
  [string]$CloudRunRegion = "us-central1",

  # Vertex AI model used by backend/ai/gemini_model.py. Gemini 1.5 models were retired;
  # default to a currently supported Gemini 2.5 model.
  [string]$ModelName = "gemini-2.5-flash-lite",

  # Keeping at least 1 warm instance eliminates cold-start latency (cost tradeoff).
  [int]$MinInstances = 0,
  # Cloud Run resource sizing (cost/perf tradeoff). Prefer lower defaults for cost control.
  [string]$Memory = "1Gi",
  [string]$Cpu = "1",

  # Optional billing-export config for /api/cloud/cost-audit
  [string]$BillingProject = "",
  [string]$BillingDataset = "",
  [string]$BillingTable = "",
  [string]$BillingFilterProject = "",
  [string]$BillingLocation = "",
  [string]$CostAuditAllowedEmails = "",
  [switch]$DisableCloudCostAuditEndpoint,

  [switch]$SkipBuild,
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-CommandExists {
  param([Parameter(Mandatory = $true)][string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Missing required command '$Name'. Install it and ensure it's on PATH."
  }
}

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter()][string[]]$Args = @()
  )
  Write-Host "==> $Label"
  $display = $Exe
  if ($Args.Count -gt 0) {
    $display = $display + " " + ($Args -join " ")
  }
  Write-Host "    $display"
  if (-not $DryRun) {
    & $Exe @Args
  }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if ($Only -in @("all", "hosting")) {
    Assert-CommandExists "npm"
    Assert-CommandExists "firebase"

    if (-not $SkipBuild) {
      Invoke-Step -Label "Build frontend" -Exe "npm" -Args @("--prefix", "frontend", "run", "build")
    }

    # Avoid noisy update checks; not required for deploy.
    $env:FIREBASE_CLI_DISABLE_UPDATE_CHECK = "1"

    Invoke-Step -Label "Deploy hosting" -Exe "firebase" -Args @("deploy", "--only", "hosting:$HostingTarget", "--project", $FirebaseProject)
  }

  if ($Only -in @("all", "backend")) {
    Assert-CommandExists "gcloud"

    # Avoid writing to user AppData in sandboxed environments; keep gcloud state inside the repo.
    $env:CLOUDSDK_CONFIG = Join-Path $repoRoot ".gcloud-config"

    Invoke-Step -Label "Select gcloud project" -Exe "gcloud" -Args @("config", "set", "project", $FirebaseProject)
    $envVarsList = @(
      "FIREBASE_PROJECT_ID=$FirebaseProject",
      "GCP_PROJECT_ID=$FirebaseProject",
      "GCP_LOCATION=$CloudRunRegion",
      "MODEL_NAME=$ModelName"
    )

    if (-not [string]::IsNullOrWhiteSpace($BillingProject)) {
      $envVarsList += "GCP_BILLING_PROJECT_ID=$BillingProject"
    }
    if (-not [string]::IsNullOrWhiteSpace($BillingDataset)) {
      $envVarsList += "GCP_BILLING_DATASET=$BillingDataset"
    }
    if (-not [string]::IsNullOrWhiteSpace($BillingTable)) {
      $envVarsList += "GCP_BILLING_TABLE=$BillingTable"
    }
    if (-not [string]::IsNullOrWhiteSpace($BillingFilterProject)) {
      $envVarsList += "GCP_BILLING_FILTER_PROJECT_ID=$BillingFilterProject"
    }
    if (-not [string]::IsNullOrWhiteSpace($BillingLocation)) {
      $envVarsList += "GCP_BILLING_BQ_LOCATION=$BillingLocation"
    }
    if (-not [string]::IsNullOrWhiteSpace($CostAuditAllowedEmails)) {
      $envVarsList += "CLOUD_COST_ALLOWED_EMAILS=$CostAuditAllowedEmails"
    }
    if ($DisableCloudCostAuditEndpoint) {
      $envVarsList += "ENABLE_CLOUD_COST_AUDIT_ENDPOINT=false"
    }

    $envVars = $envVarsList -join ","

    $runArgs = @(
      "run", "deploy", $CloudRunService,
      "--region", $CloudRunRegion,
      "--source", "backend",
      "--memory", $Memory,
      "--cpu", $Cpu,
      "--min-instances", "$MinInstances",
      "--set-env-vars", $envVars,
      "--allow-unauthenticated"
    )
    Invoke-Step -Label "Deploy Cloud Run" -Exe "gcloud" -Args $runArgs
  }
}
finally {
  Pop-Location
}
