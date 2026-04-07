#Requires -Version 5.1
<#
.SYNOPSIS
  Verify dev requirements, run setup if needed, then start the local static server.

.DESCRIPTION
  Thin wrapper around scripts\dev.ps1 -Start. If Node/npm/manifest are missing, setup runs automatically.

.EXAMPLE
  .\quick-start.ps1

.EXAMPLE
  .\quick-start.ps1 -Port 8080

.EXAMPLE
  .\quick-start.ps1 -SkipBrowser
#>
param(
  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [switch]$SkipBrowser
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $here 'scripts\dev.ps1') -Start -Port $Port -SkipBrowser:$SkipBrowser
