# select-pet.ps1
# List installed desktop-pet plugins and toggle which ones are active
# (i.e. which `- insert:` entries exist in cordis.patch.yml).
#
# Usage:
#   .\select-pet.ps1          interactive menu (type a number to toggle, 'q' to save & quit)
#   .\select-pet.ps1 -List    just list current state without editing

param([switch]$List)

$ErrorActionPreference = 'Stop'

# Locate the DSH home via the shared dsh-home.ps1 (probe order documented there:
# $env:DSH_HOME -> ~/.dsh -> desktop app %APPDATA% dir).
. (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'dsh-home.ps1')
$profileDir = Join-Path (Get-DshHome) 'profiles\web'
$nodeModules = Join-Path (Split-Path -Parent $profileDir) 'node_modules'
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

# 1) Find pet plugins: directories under node_modules whose package.json declares dsh.client.
$pets = @()
Get-ChildItem $nodeModules -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $pkg = Join-Path $_.FullName 'package.json'
    if (Test-Path $pkg) {
        try {
            $j = ([System.IO.File]::ReadAllText($pkg)) | ConvertFrom-Json
            if ($j.dsh -and $j.dsh.client) { $pets += $_.Name }
        } catch {}
    }
}
$pets = @($pets | Sort-Object)

if ($pets.Count -eq 0) {
    Write-Host "No desktop-pet plugins found under $nodeModules"
    exit 0
}

# 2) Determine active state from cordis.patch.yml.
$content = [System.IO.File]::ReadAllText($patchFile)
$active = @{}
foreach ($p in $pets) { $active[$p] = $content.Contains("name: '$p'") }

function Show-Pets {
    Write-Host ""
    Write-Host "Installed pets ([x] = active):"
    for ($i = 0; $i -lt $pets.Count; $i++) {
        $mark = if ($active[$pets[$i]]) { '[x]' } else { '[ ]' }
        Write-Host ("  {0}. {1} {2}" -f ($i + 1), $mark, $pets[$i])
    }
}

Show-Pets
if ($List) { exit 0 }

Write-Host ""
Write-Host "Type a number to toggle it, or 'q' to save and quit."

while ($true) {
    $choice = Read-Host "> "
    if ($choice -eq 'q') { break }
    $n = 0
    if ([int]::TryParse($choice, [ref]$n)) {
        $n = $n - 1
        if ($n -ge 0 -and $n -lt $pets.Count) {
            $active[$pets[$n]] = -not $active[$pets[$n]]
            Show-Pets
        }
    }
}

# 3) Rewrite cordis.patch.yml:
#    - keep comments and any NON-pet patch content in place (same behaviour as
#      install-to-dsh.ps1, so unrelated patch entries are never wiped)
#    - drop the bare `[]` placeholder (invalid YAML next to real entries)
#    - regenerate the pet insert entries from the active set
Copy-Item $patchFile "$patchFile.bak" -Force

$kept = @()
$lines = [System.IO.File]::ReadAllLines($patchFile)
$i = 0
while ($i -lt $lines.Count) {
    $line = $lines[$i]
    $t = $line.Trim()
    if ($t -eq '' -or $t -eq '[]') { $i++; continue }
    if ($t -match '^-\s*insert\s*:') {
        # Collect this YAML list item: the `- insert:` line plus its indented children.
        $block = @($line)
        $j = $i + 1
        while ($j -lt $lines.Count -and $lines[$j].Trim() -ne '' -and $lines[$j] -match '^\s') {
            $block += $lines[$j]
            $j++
        }
        # Pet entries are regenerated below, so drop them; keep everything else.
        $blockText = $block -join "`n"
        $isPetBlock = $false
        foreach ($p in $pets) {
            if ($blockText -match ("name:\s*'" + [regex]::Escape($p) + "'")) { $isPetBlock = $true; break }
        }
        if (-not $isPetBlock) { $kept += $block }
        $i = $j
    } else {
        $kept += $line
        $i++
    }
}

$entries = @()
foreach ($p in $pets) {
    if ($active[$p]) {
        $entries += "- insert:`r`n    - id: $p`r`n      name: '$p'"
    }
}

$parts = @()
if ($kept.Count -gt 0) { $parts += ($kept -join "`r`n") }
if ($entries.Count -gt 0) { $parts += ($entries -join "`r`n`r`n") }
$new = ($parts -join "`r`n`r`n") + "`r`n"
[System.IO.File]::WriteAllText($patchFile, $new, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Saved. Restart 'dsh web' and hard-refresh the browser to apply."
