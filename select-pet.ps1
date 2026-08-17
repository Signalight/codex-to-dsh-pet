# select-pet.ps1
# List installed desktop-pet plugins and toggle which ones are active
# (i.e. which `- insert:` entries exist in cordis.patch.yml).
#
# Usage:
#   .\select-pet.ps1          interactive menu (type a number to toggle, 'q' to save & quit)
#   .\select-pet.ps1 -List    just list current state without editing

param([switch]$List)

$ErrorActionPreference = 'Stop'

# Locate the DSH home: $env:DSH_HOME wins, then the conventional ~/.dsh,
# then the DeepSeek Harness desktop app's fixed data dir. (The desktop app
# only exports DSH_HOME to its own child processes, so user terminals fall
# through to the app-data path.)
$dshHome = $null
if ($env:DSH_HOME) {
    $dshHome = $env:DSH_HOME
} elseif (Test-Path (Join-Path $env:USERPROFILE '.dsh')) {
    $dshHome = Join-Path $env:USERPROFILE '.dsh'
} else {
    $appDataHome = Join-Path $env:APPDATA 'io.github.hairyf.deepseek-harness-desktop\data\dsh'
    if (Test-Path $appDataHome) { $dshHome = $appDataHome }
}
if (-not $dshHome) {
    throw "无法定位 DSH home：请设置 DSH_HOME 环境变量，或确认已安装 DeepSeek Harness"
}
$profileDir = Join-Path $dshHome 'profiles\web'
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

# 3) Rewrite cordis.patch.yml: keep the comment header, regenerate insert entries.
Copy-Item $patchFile "$patchFile.bak" -Force

$commentLines = @()
foreach ($line in [System.IO.File]::ReadAllLines($patchFile)) {
    if ($line.TrimStart().StartsWith('#')) { $commentLines += $line }
}

$entries = @()
foreach ($p in $pets) {
    if ($active[$p]) {
        $entries += "- insert:`r`n    - id: $p`r`n      name: '$p'"
    }
}

$new = ($commentLines -join "`r`n") + "`r`n`r`n" + ($entries -join "`r`n`r`n") + "`r`n"
[System.IO.File]::WriteAllText($patchFile, $new, (New-Object System.Text.UTF8Encoding($false)))

Write-Host ""
Write-Host "Saved. Restart 'dsh web' and hard-refresh the browser to apply."
