# install-to-dsh.ps1
# Install the built codex-to-dsh-pet plugin into the DSH "web" profile.
# Prerequisite: run `node build.js` first (produces lib/client.js + config.effective.json).
# Plugin name comes from config.effective.json `name` (derived from the spritesheet
# filename), falling back to config.json then codex-to-dsh-pet.
# Idempotent: safe to re-run; backs up cordis.patch.yml before editing.

$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $workspace 'config.json'
$effectivePath = Join-Path $workspace 'config.effective.json'
$pluginName = 'codex-to-dsh-pet'
if (Test-Path $effectivePath) {
    $eff = ([System.IO.File]::ReadAllText($effectivePath)) | ConvertFrom-Json
    if ($eff.name) { $pluginName = $eff.name }
} elseif (Test-Path $configPath) {
    $config = ([System.IO.File]::ReadAllText($configPath)) | ConvertFrom-Json
    if ($config.name) { $pluginName = $config.name }
}

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
$pluginDst = Join-Path $nodeModules $pluginName
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path $profileDir)) {
    throw "DSH web profile not found at $profileDir"
}
if (-not (Test-Path (Join-Path $workspace 'lib\client.js'))) {
    throw "built client bundle missing - run: node $workspace\build.js"
}

# 1) Copy runtime files; align package.json name to the plugin name.
if (Test-Path $pluginDst) { Remove-Item $pluginDst -Recurse -Force }
[System.IO.Directory]::CreateDirectory($pluginDst) | Out-Null
[System.IO.Directory]::CreateDirectory((Join-Path $pluginDst 'lib')) | Out-Null
Copy-Item (Join-Path $workspace 'package.json') (Join-Path $pluginDst 'package.json') -Force
Copy-Item (Join-Path $workspace 'lib\index.js') (Join-Path $pluginDst 'lib\index.js') -Force
Copy-Item (Join-Path $workspace 'lib\client.js') (Join-Path $pluginDst 'lib\client.js') -Force

$pkgPath = Join-Path $pluginDst 'package.json'
$pkgText = [System.IO.File]::ReadAllText($pkgPath)
$pkgText = $pkgText -replace '("name"\s*:\s*")[^"]*(")', "`$1$pluginName`$2"
[System.IO.File]::WriteAllText($pkgPath, $pkgText, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "[ok] plugin copied to $pluginDst"

# 2) Register in cordis.patch.yml.
$content = [System.IO.File]::ReadAllText($patchFile)
if ($content.Contains($pluginName)) {
    Write-Host "[ok] cordis.patch.yml already references $pluginName"
} else {
    Copy-Item $patchFile "$patchFile.bak" -Force
    Write-Host "[ok] backed up cordis.patch.yml -> cordis.patch.yml.bak"

    # Keep the comment header and any existing patch entries, but drop the bare
    # `[]` placeholder: `[]` followed by real entries is invalid YAML and would
    # break the whole patch layer.
    $commentLines = @()
    $bodyLines = @()
    foreach ($line in [System.IO.File]::ReadAllLines($patchFile)) {
        $trimmed = $line.Trim()
        if ($trimmed.StartsWith('#')) { $commentLines += $line }
        elseif ($trimmed -ne '' -and $trimmed -ne '[]') { $bodyLines += $line }
    }

    $entry = "- insert:`r`n    - id: $pluginName`r`n      name: '$pluginName'"
    $parts = @()
    if ($commentLines.Count -gt 0) { $parts += ($commentLines -join "`r`n") }
    if ($bodyLines.Count -gt 0) { $parts += ($bodyLines -join "`r`n") }
    $parts += $entry
    $new = ($parts -join "`r`n`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($patchFile, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[ok] registered $pluginName in cordis.patch.yml"
}

Write-Host ""
Write-Host "Done. Restart the DSH web surface to load the pet:"
Write-Host "  stop the current 'dsh web' process, then run:  dsh web"
Write-Host "Then hard-refresh http://127.0.0.1:3080 (Ctrl+Shift+R)."
Write-Host ""
Write-Host "Rollback: delete $pluginDst and restore $patchFile.bak"
