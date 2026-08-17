# build-pet.ps1 <pet-name>
# One-command builder: point config.json at the named spritesheet, then run node build.js.
# Usage:
#   .\build-pet.ps1 nastya
#   .\build-pet.ps1 deepseek-chan
# After building, run .\install-to-dsh.ps1 to install/update that pet.

param(
    [Parameter(Mandatory = $true)][string]$Pet,
    [string]$NodePath   # optional: explicit path to node.exe; overrides PATH lookup
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Find the spritesheet named <Pet> (.webp / .png / .gif, excluding the repo banner)
$sheet = Get-ChildItem -Path $root -File | Where-Object {
    $_.BaseName -eq $Pet -and $_.Extension -match '^\.(webp|png|gif)$' -and $_.Name.ToLower() -ne 'banner.png'
} | Select-Object -First 1

if (-not $sheet) {
    $available = (Get-ChildItem -Path $root -File | Where-Object { $_.Extension -match '^\.(webp|png|gif)$' -and $_.Name.ToLower() -ne 'banner.png' } | ForEach-Object { $_.BaseName }) -join ', '
    throw "No spritesheet named '$Pet' found in $root. Available: $available"
}

# Write config.json (spritesheetPath only; the rest is derived by build.js)
$cfg = @{ spritesheetPath = $sheet.Name } | ConvertTo-Json
[System.IO.File]::WriteAllText(
    (Join-Path $root 'config.json'),
    $cfg,
    (New-Object System.Text.UTF8Encoding($false))
)
Write-Host "[ok] config.json -> spritesheetPath: $($sheet.Name)"

# Locate node: explicit -NodePath wins, then PATH, then a few common locations
# (the original author's portable D:\DSH\nodejs is kept as a last-resort fallback).
$node = $null
if ($NodePath) {
    if (Test-Path $NodePath) { $node = $NodePath }
    else { throw "NodePath not found: $NodePath" }
}
if (-not $node) { $node = (Get-Command node -ErrorAction SilentlyContinue).Source }
if (-not $node) {
    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        'D:\DSH\nodejs\node.exe'
    )) {
        if ($candidate -and (Test-Path $candidate)) { $node = $candidate; break }
    }
}
if (-not $node) {
    throw "node not found. Install Node.js, or pass -NodePath <path-to-node.exe>."
}

Push-Location $root
try {
    & $node build.js
    if ($LASTEXITCODE -ne 0) { throw "build.js failed (exit $LASTEXITCODE)" }
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "Build done. Next step: .\install-to-dsh.ps1"
