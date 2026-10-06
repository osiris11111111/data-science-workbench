param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$defaultUrl = "http://127.0.0.1:5176"
$localUrl = $defaultUrl

function Test-LensLabServer {
  param([string]$Url)

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -ge 200 -and
      $response.StatusCode -lt 500 -and
      $response.Content -match "LensLab"
  }
  catch {
    return $false
  }
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  throw "Node.js was not found. Install Node.js 22 or newer."
}

$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  throw "npm was not found. Reinstall Node.js and add npm to PATH."
}

if (-not (Test-Path -LiteralPath (Join-Path $projectRoot "node_modules"))) {
  Write-Host "First launch: installing LensLab dependencies..." -ForegroundColor Cyan
  Push-Location $projectRoot
  try {
    & $npmCommand.Source install
    if ($LASTEXITCODE -ne 0) {
      throw "Dependency installation failed with exit code $LASTEXITCODE."
    }
  }
  finally {
    Pop-Location
  }
}

if (-not (Test-LensLabServer -Url $localUrl)) {
  $localUrl = $defaultUrl
  Write-Host "Starting the LensLab local server..." -ForegroundColor Cyan
  $previousDevLockSetting = $env:VINEXT_NO_DEV_LOCK
  $env:VINEXT_NO_DEV_LOCK = "1"
  try {
    $serverProcess = Start-Process `
      -FilePath $npmCommand.Source `
      -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1") `
      -WorkingDirectory $projectRoot `
      -WindowStyle Minimized `
      -PassThru
  }
  finally {
    if ($null -eq $previousDevLockSetting) {
      Remove-Item Env:VINEXT_NO_DEV_LOCK -ErrorAction SilentlyContinue
    }
    else {
      $env:VINEXT_NO_DEV_LOCK = $previousDevLockSetting
    }
  }

  $ready = $false
  for ($attempt = 0; $attempt -lt 90; $attempt++) {
    if ($serverProcess.HasExited) {
      throw "The LensLab server exited during startup. Check the minimized server window."
    }

    if (Test-LensLabServer -Url $localUrl) {
      $ready = $true
      break
    }

    Start-Sleep -Milliseconds 750
  }

  if (-not $ready) {
    throw "LensLab did not become ready within 67 seconds. Check the minimized server window."
  }
}

Write-Host "LensLab is ready: $localUrl" -ForegroundColor Green

if (-not $NoBrowser) {
  Start-Process $localUrl
}
