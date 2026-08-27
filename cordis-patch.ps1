# cordis-patch.ps1
# Shared editing helpers for the DSH "web" profile's cordis.patch.yml.
#
# WHY THIS EXISTS
#   The same plugin can be registered into cordis.patch.yml by more than one
#   path (this repo's manual installers, the `dsh plugin` CLI, and `dsh market`
#   merging the package's declared `dsh.bundle.patch`). If two of those run for
#   the same plugin, the file ends up with TWO identical `- insert:` loader
#   entries for that id, which can wedge cordis at boot.
#
#   Set-CordisPluginEntry makes an installer idempotent AND self-healing: it
#   guarantees exactly one `- insert:` block for a given plugin id, collapsing
#   any duplicates, preserving the comment header and every other plugin's
#   entries, and dropping the bare `[]` placeholder next to real entries.
#
# DOT-SOURCE + USE
#   . .\cordis-patch.ps1
#   $res = Set-CordisPluginEntry -Path $patchFile -Id 'codex-pet' -Name '@signalight/dsh-codex-pet'
#   if ($res.Changed) { ... } else { ... }
#
#   Returns @{ Changed=bool; Message=string; Count=int } where Count is how many
#   entries for this plugin exist in the file after the call (always 1).

# Read a cordis.patch.yml into its comment header and top-level patch blocks,
# so edits can preserve everything the caller does not own.
function Split-CordisPatch {
    param([Parameter(Mandatory = $true)][string]$Path)

    $lines = [System.IO.File]::ReadAllLines($Path)
    $header = @()
    $blocks = New-Object System.Collections.Generic.List[object]

    $i = 0
    # Leading comment header (and leading blank lines) before the first entry.
    while ($i -lt $lines.Count) {
        $t = $lines[$i].Trim()
        if ($t -eq '' -or $t.StartsWith('#')) { $header += $lines[$i]; $i++; continue }
        break
    }
    # Drop trailing blank lines from the header; we re-emit one blank after it.
    while ($header.Count -gt 0 -and $header[$header.Count - 1].Trim() -eq '') {
        $header = $header[0..($header.Count - 2)]
    }

    # Body: top-level YAML entries. Each block starts at an unindented, non-blank,
    # non-comment line and continues through indented (continuation) lines.
    while ($i -lt $lines.Count) {
        $t = $lines[$i].Trim()
        if ($t -eq '') { $i++; continue }
        if ($t.StartsWith('#')) {
            # A comment in the body: keep it as its own fragment to preserve order.
            $blocks.Add(@{ Lines = @($lines[$i]); IsInsert = $false; RefId = $null; RefName = $null })
            $i++
            continue
        }
        $blk = @($lines[$i])
        $i++
        while ($i -lt $lines.Count -and $lines[$i] -match '^\s' -and $lines[$i].Trim() -ne '') {
            $blk += $lines[$i]; $i++
        }

        $isInsert = ($blk[0].Trim() -match '^-\s*insert\s*:')
        $refId = $null
        $refName = $null
        foreach ($ln in $blk) {
            $lt = $ln.Trim()
            if ($lt -match '^-\s*id\s*:\s*(.+)$') { $refId = $Matches[1].Trim().Trim('"').Trim("'") }
            if ($lt -match '^name\s*:\s*(.+)$') { $refName = $Matches[1].Trim().Trim('"').Trim("'") }
        }
        $blocks.Add(@{ Lines = $blk; IsInsert = $isInsert; RefId = $refId; RefName = $refName })
    }

    return @{ Header = $header; Blocks = $blocks }
}

# Ensure exactly one `- insert:` loader entry for a plugin. Collapses duplicate
# rows for the same id, preserves the header and all other plugins, drops the
# bare `[]` placeholder, backs up the file before any change, and writes UTF-8
# without BOM (matching the existing installers).
function Set-CordisPluginEntry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Id,
        [Parameter(Mandatory = $true)][AllowEmptyString()][string]$Name
    )

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

    if (-not (Test-Path $Path)) {
        $header = @(
            "# Your patch layer for this dsh profile, applied after every bundle layer:",
            "# a top-level YAML array of loader patch entries (id-targeted config",
            "# overrides, disables, and insert lists; ``!!js`` expressions allowed)."
        )
        [System.IO.File]::WriteAllText($Path, (($header -join "`r`n") + "`r`n`r`n"), $utf8NoBom)
    }

    $before = [System.IO.File]::ReadAllText($Path)
    $parsed = Split-CordisPatch -Path $Path

    $canonical = "- insert:`r`n    - id: $Id`r`n      name: '$Name'"

    $kept = New-Object System.Collections.Generic.List[object]
    $targetCount = 0
    foreach ($b in $parsed.Blocks) {
        $t = ($b.Lines -join "`n").Trim()
        if ($t -eq '[]') { continue } # drop the bare placeholder next to real entries

        $isTarget = $false
        if ($b.IsInsert) {
            if ($Id -and $b.RefId -eq $Id) { $isTarget = $true }
            elseif ($Name -and $b.RefName -eq $Name) { $isTarget = $true }
        }
        if ($isTarget) { $targetCount++ } else { $kept.Add($b) }
    }

    # Rebuild: header, then every non-target block, then exactly one target row.
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($h in $parsed.Header) { $out.Add($h) }
    if ($parsed.Header.Count -gt 0) { $out.Add('') }

    $priorBlock = $false
    foreach ($b in $kept) {
        if ($priorBlock) { $out.Add('') }
        $out.Add(($b.Lines -join "`r`n"))
        $priorBlock = $true
    }
    if ($priorBlock) { $out.Add('') }
    $out.Add($canonical)

    $after = ($out -join "`r`n") + "`r`n"

    if ($after -ne $before) {
        Copy-Item $Path "$Path.bak" -Force
        [System.IO.File]::WriteAllText($Path, $after, $utf8NoBom)
        $msg = 'added'
        if ($targetCount -eq 1) { $msg = 'normalized' }
        elseif ($targetCount -gt 1) { $msg = 'deduped' }
        return @{ Changed = $true; Count = 1; Message = $msg }
    }

    return @{ Changed = $false; Count = 1; Message = 'unchanged' }
}
