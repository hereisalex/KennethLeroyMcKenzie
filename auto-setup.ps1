#Requires -Version 5.1
<#
.SYNOPSIS
  Idempotent local setup: Python deps (if needed), manifest generation, ensure public/images exists.

.DESCRIPTION
  Thin wrapper around scripts\dev.ps1 -Setup. Pass -ForceManifest to regenerate manifest.json.

.EXAMPLE
  .\auto-setup.ps1

.EXAMPLE
  .\auto-setup.ps1 -ForceManifest
#>
param(
  [switch]$ForceManifest
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $here 'scripts\dev.ps1') -Setup -ForceManifest:$ForceManifest
