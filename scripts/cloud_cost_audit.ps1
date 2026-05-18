param(
  [string]$ApiBase = "http://localhost:5000",
  [string]$Token = "",
  [int]$Days = 7,
  [ValidateSet("hour", "day")]
  [string]$Granularity = "day",
  [int]$Limit = 300,
  [string]$ProjectId = "",
  [string]$CloudRunService = "",
  [string]$ArtifactRepository = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Add-QueryParam {
  param(
    [Parameter(Mandatory = $true)][hashtable]$Bag,
    [Parameter(Mandatory = $true)][string]$Key,
    [Parameter()][string]$Value
  )
  if ($Value -and $Value.Trim()) {
    $Bag[$Key] = $Value.Trim()
  }
}

$query = @{}
$query["days"] = "$Days"
$query["granularity"] = $Granularity
$query["limit"] = "$Limit"
Add-QueryParam -Bag $query -Key "project_id" -Value $ProjectId
Add-QueryParam -Bag $query -Key "cloud_run_service" -Value $CloudRunService
Add-QueryParam -Bag $query -Key "artifact_repository" -Value $ArtifactRepository

$queryString = (
  $query.GetEnumerator() |
  Sort-Object Key |
  ForEach-Object {
    "{0}={1}" -f [uri]::EscapeDataString([string]$_.Key), [uri]::EscapeDataString([string]$_.Value)
  }
) -join "&"

$base = $ApiBase.TrimEnd("/")
$uri = "$base/api/cloud/cost-audit"
if ($queryString) {
  $uri = "$uri?$queryString"
}

$headers = @{}
if ($Token -and $Token.Trim()) {
  $headers["Authorization"] = "Bearer $($Token.Trim())"
}

Write-Host "Requesting cloud cost audit from:"
Write-Host "  $uri"

if ($headers.Count -gt 0) {
  $res = Invoke-RestMethod -Uri $uri -Method Get -Headers $headers -TimeoutSec 180
} else {
  $res = Invoke-RestMethod -Uri $uri -Method Get -TimeoutSec 180
}

if ($null -eq $res) {
  throw "No response payload received."
}

Write-Host ""
Write-Host "Window"
Write-Host "  Start: $($res.window.start)"
Write-Host "  End:   $($res.window.end)"
Write-Host "  Days:  $($res.window.days)"
Write-Host ""

Write-Host "Totals (USD)"
Write-Host ("  Overall:           {0:N6}" -f [double]($res.totals.overallUsd))
Write-Host ("  Cloud Run:         {0:N6}" -f [double]($res.totals.cloudRunUsd))
Write-Host ("  Artifact Registry: {0:N6}" -f [double]($res.totals.artifactRegistryUsd))
Write-Host ("  Other:             {0:N6}" -f [double]($res.totals.otherUsd))
Write-Host ""

$series = @($res.series)
Write-Host "Cost Over Time"
if ($series.Count -eq 0) {
  Write-Host "  (no rows)"
} else {
  $series |
    Select-Object bucketStart, cloudRunUsd, artifactRegistryUsd, otherUsd, totalUsd |
    Format-Table -AutoSize
}
Write-Host ""

$cloudRevisions = @($res.cloudRun.byRevision) | Select-Object -First 15
Write-Host "Top Cloud Run Revisions"
if ($cloudRevisions.Count -eq 0) {
  Write-Host "  (no rows)"
} else {
  $cloudRevisions |
    Select-Object runService, runRevision, costUsd, usageRows, firstSeen, lastSeen |
    Format-Table -AutoSize
}
Write-Host ""

$artifactRepos = @($res.artifactRegistry.byRepository) | Select-Object -First 15
Write-Host "Top Artifact Repositories"
if ($artifactRepos.Count -eq 0) {
  Write-Host "  (no rows)"
} else {
  $artifactRepos |
    Select-Object name, costUsd, usageRows, firstSeen, lastSeen |
    Format-Table -AutoSize
}
Write-Host ""

Write-Host "Query Meta"
Write-Host "  Billing table: $($res.meta.billingTable)"
Write-Host "  Bytes billed:  $($res.meta.bytesBilled)"
Write-Host "  Bytes proc.:   $($res.meta.bytesProcessed)"
Write-Host "  Generated at:  $($res.meta.generatedAt)"

