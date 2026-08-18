# select-pet.ps1
# List installed desktop-pet plugins and toggle which LEGACY per-pet plugins
# are active (i.e. which `- insert:` entries exist in cordis.patch.yml).
#
# Scoped runtime plugins (e.g. @signalight/dsh-codex-pet) are listed for
# information only: they manage their own pets through the Settings → 桌宠 UI
# and are NEVER rewritten by this script. Only the legacy per-pet rows
# (top-level, client-only plugins produced by build.js) are toggled here, and
# every other patch entry is preserved untouched.
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

# Read one package.json (returns $null when absent/unparseable).
function Read-Pkg([string]$dir) {
    $pkg = Join-Path $dir 'package.json'
    if (-not (Test-Path $pkg)) { return $null }
    try {
        $text = [System.IO.File]::ReadAllText($pkg)
        return ($text | ConvertFrom-Json)
    } catch {
        return $null
    }
}

# 1) Discover plugins.
#    - legacy per-pet plugins = top-level node_modules dirs whose package.json
#      declares dsh.client and no dsh.bundle (build.js output) -> toggleable.
#    - runtime plugins = everything else declaring dsh.client or dsh.bundle
#      (scoped dirs like @scope/name, or top-level with dsh.bundle) -> listed
#      for information only, never rewritten here.
$pets = @()    # legacy per-pet plugins (toggleable)
$runtime = @() # runtime plugins (display-only)

# Top-level dirs.
Get-ChildItem $nodeModules -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $j = Read-Pkg $_.FullName
    if ($j -and $j.dsh -and ($j.dsh.client -or $j.dsh.bundle)) {
        if ($j.dsh.client -and -not $j.dsh.bundle) { $pets += $_.Name }
        else { $runtime += $_.Name }
    }
}

# Scoped dirs: @scope/<pkg> (one level deeper).
Get-ChildItem $nodeModules -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like '@*' } |
    ForEach-Object {
        $scope = $_.Name
        Get-ChildItem $_.FullName -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $j = Read-Pkg $_.FullName
            if ($j -and $j.dsh -and ($j.dsh.client -or $j.dsh.bundle)) {
                $runtime += ($scope + '/' + $_.Name)
            }
        }
    }

$pets = @($pets | Sort-Object)
$runtime = @($runtime | Sort-Object)

# 2) Determine active state from cordis.patch.yml (legacy pets only).
$content = [System.IO.File]::ReadAllText($patchFile)
$active = @{}
foreach ($p in $pets) { $active[$p] = $content.Contains("name: '$p'") }

function Show-Pets {
    Write-Host ""
    Write-Host "Legacy per-pet plugins ([x] = active):"
    if ($pets.Count -eq 0) { Write-Host "  (none)" }
    for ($i = 0; $i -lt $pets.Count; $i++) {
        $mark = if ($active[$pets[$i]]) { '[x]' } else { '[ ]' }
        Write-Host ("  {0}. {1} {2}" -f ($i + 1), $mark, $pets[$i])
    }
    if ($runtime.Count -gt 0) {
        Write-Host ""
        Write-Host "Runtime plugins (managed elsewhere, not toggled here):"
        foreach ($r in $runtime) { Write-Host ("   - {0}" -f $r) }
    }
}

Show-Pets
if ($List) { exit 0 }

if ($pets.Count -eq 0) {
    Write-Host ""
    Write-Host "No legacy per-pet plugins to toggle. Runtime plugins are managed via"
    Write-Host "Settings -> 桌宠 (or their own settings surface)."
    exit 0
}

Write-Host ""
Write-Host "Type a number to toggle a legacy pet, or 'q' to save and quit."

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
#    - keep comments and every non-pet patch block in place (runtime plugins and
#      any other third-party entries are never wiped)
#    - drop the bare `[]` placeholder (invalid YAML next to real entries)
#    - regenerate ONLY the legacy per-pet insert entries from the active set
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
        # Legacy pet blocks are regenerated below; keep everything else untouched.
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
Write-Host "Saved. The DSH profile hot-reloads cordis.patch.yml, so hard-refresh the"
Write-Host "browser (Ctrl+Shift+R) to apply. Command-line 'dsh web' users may also"
Write-Host "restart the process."
