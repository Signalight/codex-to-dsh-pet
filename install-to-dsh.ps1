# install-to-dsh.ps1
# 把构建好的 codex-to-dsh-pet 插件安装进 DSH 的 "web" profile。
# 前置：先运行 `node build.js`（生成 lib/client.js）。
# 插件名取自 config.json 的 `name`（缺省为 codex-to-dsh-pet）。
# 幂等：可重复运行；编辑 cordis.patch.yml 前自动备份。

$ErrorActionPreference = 'Stop'

$workspace = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $workspace 'config.json'
$pluginName = 'codex-to-dsh-pet'
if (Test-Path $configPath) {
    $config = Get-Content $configPath -Raw | ConvertFrom-Json
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
    throw "built client bundle missing — run: node $workspace\build.js"
}

# 1) 复制运行时文件，并把 package.json 的 name 对齐到插件名。
New-Item -ItemType Directory -Force -Path (Join-Path $pluginDst 'lib') | Out-Null
Copy-Item (Join-Path $workspace 'package.json') $pluginDst -Force
Copy-Item (Join-Path $workspace 'lib\index.js') (Join-Path $pluginDst 'lib\index.js') -Force
Copy-Item (Join-Path $workspace 'lib\client.js') (Join-Path $pluginDst 'lib\client.js') -Force
$pkgText = Get-Content (Join-Path $pluginDst 'package.json') -Raw
$pkgText = $pkgText -replace '("name"\s*:\s*")[^"]*(")', "`$1$pluginName`$2"
Set-Content (Join-Path $pluginDst 'package.json') -Value $pkgText -Encoding utf8
Write-Host "[ok] plugin copied to $pluginDst"

# 2) 注册到 cordis.patch.yml。
$content = Get-Content $patchFile -Raw
if ($content -match [regex]::Escape($pluginName)) {
    Write-Host "[ok] cordis.patch.yml already references $pluginName"
} else {
    Copy-Item $patchFile "$patchFile.bak" -Force
    Write-Host "[ok] backed up cordis.patch.yml -> cordis.patch.yml.bak"

    $entry = @"
- insert:
    - id: $pluginName
      name: '$pluginName'
"@

    if ($content.TrimEnd().EndsWith('[]')) {
        $new = $content -replace '\[\]\s*$', $entry
    } else {
        $new = $content.TrimEnd() + "`r`n`r`n" + $entry + "`r`n"
    }
    Set-Content -Path $patchFile -Value $new -Encoding utf8
    Write-Host "[ok] registered $pluginName in cordis.patch.yml"
}

Write-Host ""
Write-Host "Done. Restart the DSH web surface to load the pet:"
Write-Host "  stop the current 'dsh web' process, then run:  dsh web"
Write-Host "Then hard-refresh http://127.0.0.1:3080 (Ctrl+Shift+R)."
Write-Host ""
Write-Host "Rollback: delete $pluginDst and restore $patchFile.bak"
