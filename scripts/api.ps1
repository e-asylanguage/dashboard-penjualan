<#
.SYNOPSIS
  Memanggil endpoint dashboard tanpa perlu mengetik password tiap kali.

.DESCRIPTION
  Password dibaca dari .prod.vars (produksi) atau .dev.vars (lokal, pakai -Local).
  Keduanya diabaikan git, jadi tidak pernah ikut ter-commit.

.EXAMPLE
  .\scripts\api.ps1 /api/report/cs
.EXAMPLE
  .\scripts\api.ps1 "/api/sync/backfill?days=90" -Method POST
.EXAMPLE
  .\scripts\api.ps1 /api/settings -Local
#>
param(
  [Parameter(Mandatory = $true, Position = 0)][string]$Path,
  [ValidateSet('GET', 'POST', 'PUT', 'DELETE')][string]$Method = 'GET',
  [string]$Body,
  [switch]$Local,
  [switch]$Raw
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent

function Read-Vars([string]$file) {
  $h = @{}
  if (Test-Path $file) {
    foreach ($line in Get-Content $file) {
      if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
      $parts = $line -split '=', 2
      $h[$parts[0].Trim()] = $parts[1].Trim()
    }
  }
  return $h
}

if ($Local) {
  $vars = Read-Vars (Join-Path $root '.dev.vars')
  $base = 'http://localhost:8787'
} else {
  $file = Join-Path $root '.prod.vars'
  if (-not (Test-Path $file)) {
    Write-Host "Belum ada .prod.vars. Salin dari contohnya lalu isi password produksi:" -ForegroundColor Yellow
    Write-Host "  copy .prod.vars.example .prod.vars"
    exit 1
  }
  $vars = Read-Vars $file
  $base = if ($vars.BASE_URL) { $vars.BASE_URL } else { 'https://dashboard-penjualan.empatribupaketdotcom.workers.dev' }
}

$headers = @{}
$pw = $vars.DASHBOARD_PASSWORD
if ($pw) { $headers['X-Dashboard-Key'] = $pw }
if ($Body) { $headers['Content-Type'] = 'application/json' }

if (-not $Path.StartsWith('/')) { $Path = '/' + $Path }
$uri = $base + $Path
Write-Host "$Method $uri" -ForegroundColor DarkGray

try {
  $args = @{ Uri = $uri; Method = $Method; Headers = $headers; UseBasicParsing = $true; TimeoutSec = 600 }
  if ($Body) { $args['Body'] = $Body }
  $res = Invoke-WebRequest @args
  if ($Raw) { $res.Content } else { $res.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10 }
} catch {
  $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
  if ($code -eq 401) {
    $where = if ($Local) { '.dev.vars' } else { '.prod.vars' }
    Write-Host "401 unauthorized - DASHBOARD_PASSWORD di $where tidak cocok dengan yang terpasang di Cloudflare." -ForegroundColor Red
  } else {
    Write-Host "Gagal ($code): $($_.Exception.Message)" -ForegroundColor Red
  }
  exit 1
}
