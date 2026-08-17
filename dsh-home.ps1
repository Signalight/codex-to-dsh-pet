# dsh-home.ps1
# Shared DSH home detection used by install-to-dsh.ps1 and select-pet.ps1.
# Dot-source this file, then call Get-DshHome:
#   . .\dsh-home.ps1
#   $dshHome = Get-DshHome
#
# Probe order:
#   1. $env:DSH_HOME (explicit override, wins)
#   2. ~/.dsh (command-line dsh's conventional location, used if it exists)
#   3. %APPDATA%\io.github.hairyf.deepseek-harness-desktop\data\dsh
#      (DeepSeek Harness desktop app's data dir, used if it exists)
#
# Note: the desktop app does not export DSH_HOME to user terminals, so
# desktop-app users fall through to path 3 automatically.

function Get-DshHome {
    if ($env:DSH_HOME) { return $env:DSH_HOME }

    $cliHome = Join-Path $env:USERPROFILE '.dsh'
    if (Test-Path $cliHome) { return $cliHome }

    $appData = if ($env:APPDATA) { $env:APPDATA } else { Join-Path $env:USERPROFILE 'AppData\Roaming' }
    $appHome = Join-Path $appData 'io.github.hairyf.deepseek-harness-desktop\data\dsh'
    if (Test-Path $appHome) { return $appHome }

    throw "Cannot locate DSH home. Set DSH_HOME or install DeepSeek Harness first."
}
