#Requires -Version 5.1
<#
.SYNOPSIS
  Local development helper for the memorial slideshow (setup, doctor, start server).

.DESCRIPTION
  Idempotent setup: ensures Node is available, optionally Python + OpenCV for the Python
  manifest generator, creates public/images if missing, and generates public/manifest.json
  when absent (or when -ForceManifest is used with -Setup).

.PARAMETER Setup
  Run setup steps only (no dev server).

.PARAMETER Start
  Verify requirements, run setup if needed, then start the static server and open the browser.

.PARAMETER Doctor
  Print diagnostics (Node, Python, manifest, images, port) and README-aligned next steps.

.PARAMETER Port
  Port for `serve` (default 3000).

.PARAMETER ForceManifest
  With -Setup, regenerate manifest even if manifest.json already exists.

.PARAMETER SkipBrowser
  With -Start, do not open the default browser.

.EXAMPLE
  .\scripts\dev.ps1 -Doctor

.EXAMPLE
  .\scripts\dev.ps1 -Setup

.EXAMPLE
  .\scripts\dev.ps1 -Start -Port 8080
#>

[CmdletBinding(DefaultParameterSetName = 'None')]
param(
  [Parameter(ParameterSetName = 'Setup')]
  [switch]$Setup,

  [Parameter(ParameterSetName = 'Start')]
  [switch]$Start,

  [Parameter(ParameterSetName = 'Doctor')]
  [switch]$Doctor,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [switch]$ForceManifest,

  [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'

function Get-ProjectRoot {
  $dir = $PSScriptRoot
  if ($dir -match '[\\/]scripts$') {
    return (Resolve-Path (Join-Path $dir '..')).Path
  }
  return $dir
}

function Test-CommandAvailable {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-PyLauncher {
  if (Test-CommandAvailable 'py') { return 'py' }
  return $null
}

function Get-PythonExe {
  if (Test-CommandAvailable 'python') {
    return 'python'
  }
  $py = Get-PyLauncher
  if ($py) { return $py }
  return $null
}

function Test-NodeReady {
  if (-not (Test-CommandAvailable 'node')) { return $false }
  try {
    $v = & node --version 2>$null
    return [bool]$v
  } catch {
    return $false
  }
}

function Test-NpmReady {
  return (Test-CommandAvailable 'npm')
}

function Test-PythonCv2 {
  param([string]$PythonExe)
  if (-not $PythonExe) { return $false }
  try {
    & $PythonExe -c "import cv2" 2>$null
    if ($LASTEXITCODE -ne 0 -and $null -ne $LASTEXITCODE) { return $false }
    return $true
  } catch {
    return $false
  }
}

function Test-NetTcpConnectionAvailable {
  return [bool](Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)
}

function Get-PortListenerProcessInfos {
  param([int]$Port)
  if (-not (Test-NetTcpConnectionAvailable)) {
    return @()
  }
  try {
    $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  } catch {
    return @()
  }
  if ($conns.Count -eq 0) {
    return @()
  }
  $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
  $out = foreach ($procId in $pids) {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($proc) {
      [PSCustomObject]@{
        Pid           = $procId
        ProcessName   = $proc.ProcessName
        Path          = $proc.Path
      }
    }
  }
  return @($out)
}

function Assert-DevPortIsFree {
  param([int]$Port)

  $listeners = @(Get-PortListenerProcessInfos -Port $Port)
  if ($listeners.Count -gt 0) {
    $lines = foreach ($L in $listeners) {
      if ($L.Path) {
        '  PID ' + $L.Pid + ' (' + $L.ProcessName + '): ' + $L.Path
      } else {
        '  PID ' + $L.Pid + ' (' + $L.ProcessName + ')'
      }
    }
    $detail = $lines -join [Environment]::NewLine
    throw ('Port ' + $Port + ' is already in use (another server or app is listening).' + [Environment]::NewLine +
      $detail + [Environment]::NewLine +
      'Stop that process, or start this dev server on a different port (e.g. -Port 8080).')
  }

  try {
    $tcp = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $tcp.Start()
    $tcp.Stop()
  } catch {
    throw ('Port ' + $Port + ' cannot be bound (reserved, policy, or race). Try -Port <other>. ' + $_.Exception.Message)
  }
}

function Invoke-PipInstallRequirements {
  param(
    [string]$ProjectRoot,
    [string]$PythonExe
  )
  $req = Join-Path $ProjectRoot 'tools\requirements.txt'
  if (-not (Test-Path $req)) {
    Write-Warning ('Missing ' + $req + ' - skipping pip install.')
    return
  }
  Write-Host '[dev] Installing Python dependencies (idempotent)…' -ForegroundColor Cyan
  & $PythonExe -m pip install -r $req
  if ($LASTEXITCODE -ne 0) {
    throw "pip install failed (exit $LASTEXITCODE)."
  }
}

function Test-ManifestPath {
  param([string]$ProjectRoot)
  $p = Join-Path $ProjectRoot 'public\manifest.json'
  return (Test-Path -LiteralPath $p)
}

function Invoke-GenerateManifestNode {
  param([string]$ProjectRoot)
  Push-Location $ProjectRoot
  try {
    Write-Host '[dev] Running: npm run manifest' -ForegroundColor Cyan
    & npm run manifest
    if ($LASTEXITCODE -ne 0) {
      throw "npm run manifest failed (exit $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

function Invoke-GenerateManifestPython {
  param([string]$ProjectRoot, [string]$PythonExe)
  $script = Join-Path $ProjectRoot 'tools\generate-manifest.py'
  Push-Location $ProjectRoot
  try {
    Write-Host ('[dev] Running: ' + $PythonExe + ' tools/generate-manifest.py') -ForegroundColor Cyan
    & $PythonExe $script
    if ($LASTEXITCODE -ne 0) {
      throw "Python manifest failed (exit $LASTEXITCODE)."
    }
  } finally {
    Pop-Location
  }
}

function Invoke-DevSetup {
  param(
    [string]$ProjectRoot,
    [switch]$ForceManifest
  )

  Write-Host ('[dev] Project root: ' + $ProjectRoot) -ForegroundColor Green

  $imagesDir = Join-Path $ProjectRoot 'public\images'
  if (-not (Test-Path -LiteralPath $imagesDir)) {
    New-Item -ItemType Directory -Path $imagesDir -Force | Out-Null
    Write-Host ('[dev] Created ' + $imagesDir) -ForegroundColor Cyan
  }

  if (-not (Test-NodeReady)) {
    throw "Node.js is not installed or not on PATH. Install an LTS release from https://nodejs.org/ and re-run."
  }
  if (-not (Test-NpmReady)) {
    throw "npm was not found on PATH. Reinstall Node.js (npm ships with Node) and re-run."
  }

  $pyExe = Get-PythonExe
  $usePythonManifest = $false
  if ($pyExe) {
    if (-not (Test-PythonCv2 -PythonExe $pyExe)) {
      Write-Host ('[dev] OpenCV not available for ' + $pyExe + ' — installing requirements…') -ForegroundColor Yellow
      try {
        Invoke-PipInstallRequirements -ProjectRoot $ProjectRoot -PythonExe $pyExe
      } catch {
        Write-Warning "Python dependency install failed; will use Node manifest only. $_"
        $pyExe = $null
      }
    }
    if ($pyExe -and (Test-PythonCv2 -PythonExe $pyExe)) {
      $usePythonManifest = $true
    }
  } else {
    Write-Host '[dev] Python not found — using Node-only manifest (center focal, no thumbnails).' -ForegroundColor Yellow
  }

  $manifestPath = Join-Path $ProjectRoot 'public\manifest.json'
  $shouldGen = $ForceManifest -or -not (Test-Path -LiteralPath $manifestPath)

  if (-not $shouldGen) {
    Write-Host '[dev] manifest.json already exists (use -ForceManifest to regenerate).' -ForegroundColor DarkGray
    return
  }

  if ($usePythonManifest) {
    Invoke-GenerateManifestPython -ProjectRoot $ProjectRoot -PythonExe $pyExe
  } else {
    Invoke-GenerateManifestNode -ProjectRoot $ProjectRoot
  }
}

function Write-DevDoctorRecommendedSteps {
  param(
    [bool]$NodeOk,
    [bool]$NpmOk,
    [string]$PythonExe,
    [bool]$PythonCv2Ok,
    [bool]$ImagesDirExists,
    [int]$ImageCount,
    [bool]$ManifestExists,
    [ValidateSet('available', 'in_use', 'cannot_bind')]
    [string]$PortState,
    [int]$Port
  )

  $steps = [System.Collections.Generic.List[string]]::new()

  $pol = $null
  try {
    $pol = Get-ExecutionPolicy -ErrorAction SilentlyContinue
  } catch {
    $pol = $null
  }
  if ($pol -in @('Restricted', 'AllSigned')) {
    $steps.Add('If .ps1 scripts fail to run: Set-ExecutionPolicy -Scope CurrentUser RemoteSigned (one-time), or: powershell -NoProfile -ExecutionPolicy Bypass -File .\quick-start.ps1')
  }

  if (-not $NodeOk) {
    $steps.Add('Install Node.js LTS from https://nodejs.org/ (add to PATH), then re-run: .\scripts\dev.ps1 -Doctor')
  }
  if ($NodeOk -and -not $NpmOk) {
    $steps.Add('npm was not found; reinstall Node.js (npm ships with Node), then re-run: .\scripts\dev.ps1 -Doctor')
  }

  $toolchainOk = $NodeOk -and $NpmOk
  $readyForQuickStart = $toolchainOk -and $ManifestExists -and $ImagesDirExists -and ($ImageCount -gt 0) -and ($PortState -eq 'available')

  if ($toolchainOk) {
    if (-not $ImagesDirExists -or -not $ManifestExists) {
      $steps.Add('From the project root, run: .\auto-setup.ps1   (same as: .\scripts\dev.ps1 -Setup) — creates public\images if needed and generates public\manifest.json when missing.')
    }
    if ($PythonExe -and -not $PythonCv2Ok -and $ManifestExists -and $ImagesDirExists) {
      $req = 'tools\requirements.txt'
      $steps.Add('OpenCV not importable for the Python manifest: .\auto-setup.ps1   or: ' + $PythonExe + ' -m pip install -r ' + $req + '   then .\auto-setup.ps1 -ForceManifest if you need face focal points in an existing manifest.')
    }
    if (-not $PythonExe -and -not $readyForQuickStart) {
      $steps.Add('Optional — face-based focal points + filmstrip thumbnails: install Python 3 on PATH, then run .\auto-setup.ps1. Without Python, the Node manifest uses center focal points only (README).')
    }
    if ($ImagesDirExists -and $ImageCount -eq 0) {
      $steps.Add('Add photo files under public\images, then regenerate the manifest: .\auto-setup.ps1 -ForceManifest   (or: .\scripts\dev.ps1 -Setup -ForceManifest)')
    }
  }

  if ($toolchainOk -and $ManifestExists -and $PortState -eq 'in_use') {
    $alt = if ($Port -eq 3000) { 8080 } else { 3000 }
    $steps.Add(('Port {0} is in use — stop the process listed above, or use another port (README quick start): .\quick-start.ps1 -Port {1}' -f $Port, $alt))
  }
  if ($toolchainOk -and $ManifestExists -and $PortState -eq 'cannot_bind') {
    $steps.Add(('Port {0} cannot be bound — try: .\quick-start.ps1 -Port 8080' -f $Port))
  }

  if ($readyForQuickStart) {
    $steps.Add('Start the local server and open the browser (project root must be served over http://, not file://): .\quick-start.ps1')
    $steps.Add('Optional (README): .\quick-start.ps1 -Port 8080 -SkipBrowser   Stop the server with Ctrl+C in that window.')
  }

  if ($steps.Count -eq 0) {
    if (-not $toolchainOk) {
      $steps.Add('Fix Node/npm above, then re-run: .\scripts\dev.ps1 -Doctor')
    } else {
      $steps.Add('From the project root: .\auto-setup.ps1   then: .\quick-start.ps1   (see README Quick start.)')
    }
  }

  Write-Host "`n--- Recommended next steps ---" -ForegroundColor Cyan
  Write-Host '  README Quick start order:  (1) optional execution policy if .ps1 scripts are blocked  (2) .\scripts\dev.ps1 -Doctor  (3) .\auto-setup.ps1  (4) .\quick-start.ps1' -ForegroundColor DarkGray
  Write-Host '  Tailored to your checks above:' -ForegroundColor DarkGray
  $i = 1
  foreach ($s in $steps) {
    Write-Host ('  ' + $i + '. ' + $s)
    $i++
  }
  Write-Host ''
}

function Invoke-DevDoctor {
  param(
    [string]$ProjectRoot,
    [int]$Port
  )

  Write-Host "`n=== Memorial dev doctor ===" -ForegroundColor Green

  $nodeOk = Test-NodeReady
  if ($nodeOk) {
    $nv = & node --version
    Write-Host ('Node:  OK (' + $nv + ')')
  } else {
    Write-Host 'Node:  MISSING (install Node.js LTS)' -ForegroundColor Red
  }

  $npmOk = Test-NpmReady
  if ($npmOk) {
    $mv = & npm --version
    Write-Host ('npm:   OK (' + $mv + ')')
  } else {
    Write-Host 'npm:   MISSING' -ForegroundColor Red
  }

  $pyExe = Get-PythonExe
  $pythonCv2Ok = $false
  if ($pyExe) {
    $pv = & $pyExe --version 2>&1
    $pythonCv2Ok = Test-PythonCv2 -PythonExe $pyExe
    if ($pythonCv2Ok) {
      Write-Host ('Python: OK (' + $pyExe + ') - OpenCV import OK (' + $pv + ')')
    } else {
      $pipHint = Join-Path $ProjectRoot 'tools\requirements.txt'
      Write-Host ('Python: PARTIAL (' + $pyExe + ') - OpenCV not importable; run -Setup or: ' + $pyExe + ' -m pip install -r ' + $pipHint) -ForegroundColor Yellow
    }
  } else {
    Write-Host 'Python: not on PATH (optional; Node manifest will be used)' -ForegroundColor DarkGray
  }

  $imgDir = Join-Path $ProjectRoot 'public\images'
  $imagesDirExists = Test-Path -LiteralPath $imgDir
  $imageCount = 0
  if ($imagesDirExists) {
    $imageCount = (Get-ChildItem -LiteralPath $imgDir -File -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Host ('Images: ' + $imageCount + ' file(s) in public\images')
  } else {
    Write-Host 'Images: public\images missing' -ForegroundColor Yellow
  }

  $mf = Join-Path $ProjectRoot 'public\manifest.json'
  $manifestExists = Test-Path -LiteralPath $mf
  if ($manifestExists) {
    $len = (Get-Item -LiteralPath $mf).Length
    Write-Host ('manifest.json: OK (' + $len + ' bytes)')
  } else {
    Write-Host 'manifest.json: MISSING (run -Setup or npm run manifest)' -ForegroundColor Yellow
  }

  $portState = 'available'
  $listeners = @(Get-PortListenerProcessInfos -Port $Port)
  if ($listeners.Count -gt 0) {
    $portState = 'in_use'
    Write-Host ('Port ' + $Port + ' : in use') -ForegroundColor Yellow
    foreach ($L in $listeners) {
      if ($L.Path) {
        Write-Host ('  PID ' + $L.Pid + ' (' + $L.ProcessName + '): ' + $L.Path) -ForegroundColor DarkGray
      } else {
        Write-Host ('  PID ' + $L.Pid + ' (' + $L.ProcessName + ')') -ForegroundColor DarkGray
      }
    }
    Write-Host '  Stop that process or use -Port <other>.' -ForegroundColor DarkGray
  } else {
    try {
      $tcp = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
      $tcp.Start()
      $tcp.Stop()
      Write-Host "Port $Port : available"
    } catch {
      $portState = 'cannot_bind'
      Write-Host ('Port ' + $Port + ' : cannot bind (reserved/blocked) — try another -Port') -ForegroundColor Yellow
    }
  }

  Write-Host '============================' -ForegroundColor Green

  $pyExeForSteps = if ($null -eq $pyExe) { '' } else { $pyExe }
  Write-DevDoctorRecommendedSteps -NodeOk:$nodeOk -NpmOk:$npmOk -PythonExe $pyExeForSteps -PythonCv2Ok:$pythonCv2Ok `
    -ImagesDirExists:$imagesDirExists -ImageCount $imageCount -ManifestExists:$manifestExists `
    -PortState $portState -Port $Port
}

function Test-DevRequirementsMet {
  param([string]$ProjectRoot)

  if (-not (Test-NodeReady)) { return $false }
  if (-not (Test-NpmReady)) { return $false }
  if (-not (Test-ManifestPath -ProjectRoot $ProjectRoot)) { return $false }
  return $true
}

function Invoke-DevStart {
  param(
    [string]$ProjectRoot,
    [int]$Port,
    [switch]$SkipBrowser
  )

  if (-not (Test-DevRequirementsMet -ProjectRoot $ProjectRoot)) {
    Write-Host '[dev] Requirements not fully met — running setup…' -ForegroundColor Yellow
    Invoke-DevSetup -ProjectRoot $ProjectRoot -ForceManifest:$false
  }

  if (-not (Test-ManifestPath -ProjectRoot $ProjectRoot)) {
    throw "manifest.json is still missing after setup. Add images to public\images and run -Setup -ForceManifest."
  }

  Assert-DevPortIsFree -Port $Port

  $url = "http://localhost:$Port/"
  Write-Host ('[dev] Starting static server at ' + $url) -ForegroundColor Green
  Write-Host ('[dev] Document root: ' + $ProjectRoot) -ForegroundColor DarkGray
  Write-Host ('[dev] Press Ctrl+C to stop.' + [Environment]::NewLine) -ForegroundColor DarkGray

  if (-not $SkipBrowser) {
    Start-Job -ScriptBlock {
      param($U)
      Start-Sleep -Seconds 2
      Start-Process $U
    } -ArgumentList $url | Out-Null
  }

  Push-Location $ProjectRoot
  try {
    # serve: -l is listen port (see https://github.com/vercel/serve)
    & npx --yes serve . -l $Port
  } finally {
    Pop-Location
  }
}

# --- main ---

$projectRoot = Get-ProjectRoot

if ($Doctor) {
  Invoke-DevDoctor -ProjectRoot $projectRoot -Port $Port
  exit 0
}

if ($Setup) {
  Invoke-DevSetup -ProjectRoot $projectRoot -ForceManifest:$ForceManifest
  exit 0
}

if ($Start) {
  Invoke-DevStart -ProjectRoot $projectRoot -Port $Port -SkipBrowser:$SkipBrowser
  exit 0
}

Write-Host @"
Memorial dev helper

Usage:
  .\scripts\dev.ps1 -Doctor              # Check Node, npm, Python, manifest, port
  .\scripts\dev.ps1 -Setup               # Idempotent install + generate manifest if missing
  .\scripts\dev.ps1 -Setup -ForceManifest # Regenerate manifest.json
  .\scripts\dev.ps1 -Start [-Port 3000]  # Ensure ready, then serve and open browser

Or use from repo root:
  .\quick-start.ps1
  .\auto-setup.ps1
"@
