# install-to-dsh.ps1
# Install the built codex-to-dsh-pet plugin into the DSH "web" profile.
# Prerequisite: run `node build.js` first (produces lib/client.js).
# Plugin name comes from config.json `name` (default: codex-to-dsh-pet).
# Idempotent: safe to re-run; backs up cordis.patch.yml before editing.

$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $workspace 'config.json'
$pluginName = 'codex-to-dsh-pet'
if (Test-Path $configPath) {
    $config = ([System.IO.File]::ReadAllText($configPath)) | ConvertFrom-Json
    if ($config.name) { $pluginName = $config.name }
}

$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
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

    $entry = "- insert:`r`n    - id: $pluginName`r`n      name: '$pluginName'"
    $trimmed = $content.Trim()
    if ($trimmed -eq '' -or $trimmed -eq '[]') {
        $new = $entry + "`r`n"
    } else {
        $new = $content.TrimEnd() + "`r`n`r`n" + $entry + "`r`n"
    }
    [System.IO.File]::WriteAllText($patchFile, $new, (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[ok] registered $pluginName in cordis.patch.yml"
}

Write-Host ""
Write-Host "Done. Restart the DSH web surface to load the pet:"
Write-Host "  stop the current 'dsh web' process, then run:  dsh web"
Write-Host "Then hard-refresh http://127.0.0.1:3080 (Ctrl+Shift+R)."
Write-Host ""
Write-Host "Rollback: delete $pluginDst and restore $patchFile.bak"
