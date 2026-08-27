# install-runtime.ps1
# Install the dsh-codex-pet runtime plugin into the DSH "web" profile.
# Unlike install-to-dsh.ps1 (which installs one client-only pet bundle), this
# installs the single host+client runtime plugin: copy packages/dsh-codex-pet
# into the profile's loose node_modules and register its row in cordis.patch.yml.
# Idempotent: safe to re-run; backs up cordis.patch.yml before editing.
#
# (The official route is `dsh plugin --profile web add link:<pkg>` which needs
# pnpm; this script is the manual equivalent that works without pnpm.)

$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$pkgDir = Join-Path $workspace 'packages\dsh-codex-pet'
$pluginName = '@signalight/dsh-codex-pet'
$pluginId = 'codex-pet'

# Locate the DSH home via the shared dsh-home.ps1 (probe order documented there:
# $env:DSH_HOME -> ~/.dsh -> desktop app %APPDATA% dir).
. (Join-Path $workspace 'dsh-home.ps1')
# Shared idempotent + dedupe patch editor (guards against duplicate loader entries).
. (Join-Path $workspace 'cordis-patch.ps1')
$profileDir = Join-Path (Get-DshHome) 'profiles\web'
$nodeModules = Join-Path (Split-Path -Parent $profileDir) 'node_modules'
$pluginDst = Join-Path $nodeModules ($pluginName -replace '/', '\')
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

if (-not (Test-Path $profileDir)) {
    throw "DSH web profile not found at $profileDir"
}
if (-not (Test-Path (Join-Path $pkgDir 'package.json'))) {
    throw "plugin package missing: $pkgDir"
}

# 1) Copy the plugin package (src/ + assets/ + cordis.patch.yml + package.json).
if (Test-Path $pluginDst) { Remove-Item $pluginDst -Recurse -Force }
[System.IO.Directory]::CreateDirectory($pluginDst) | Out-Null
Copy-Item (Join-Path $pkgDir 'package.json') (Join-Path $pluginDst 'package.json') -Force
Copy-Item (Join-Path $pkgDir 'cordis.patch.yml') (Join-Path $pluginDst 'cordis.patch.yml') -Force
Copy-Item (Join-Path $pkgDir 'src') (Join-Path $pluginDst 'src') -Recurse -Force
if (Test-Path (Join-Path $pkgDir 'assets')) {
    Copy-Item (Join-Path $pkgDir 'assets') (Join-Path $pluginDst 'assets') -Recurse -Force
}
Write-Host "[ok] plugin copied to $pluginDst"

# 2) Register in cordis.patch.yml (idempotent + self-healing: ensures exactly
#    one loader entry for this plugin, collapsing any duplicates so cordis
#    never sees two rows for the same id).
$res = Set-CordisPluginEntry -Path $patchFile -Id $pluginId -Name $pluginName
if ($res.Changed) {
    Write-Host "[ok] cordis.patch.yml $($res.Message): $pluginName -> 1 insert row"
} else {
    Write-Host "[ok] cordis.patch.yml already registers $pluginName exactly once"
}

Write-Host ""
Write-Host "Done. The DSH profile hot-reloads cordis.patch.yml, so hard-refresh the"
Write-Host "browser (Ctrl+Shift+R) to load the runtime plugin. If it still doesn't show,"
Write-Host "fully quit and relaunch the DSH web surface. (Command-line 'dsh web' users"
Write-Host "can restart the process instead.)"
Write-Host ""
Write-Host "Add pets: drop <pet>/pet.json + <pet>/spritesheet.webp into"
Write-Host "  ~/.dsh/pets/  (or the plugin's assets/ directory)."
Write-Host "Rollback: delete $pluginDst and restore $patchFile.bak"
