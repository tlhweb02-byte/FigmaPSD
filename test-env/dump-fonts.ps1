# Dump installed Windows fonts (registry) to CSV for font-map generation.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'test-env\cache'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$outCsv = Join-Path $outDir 'fonts-list.csv'

$reg = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts"
$props = (Get-ItemProperty $reg).PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' }
$fonts = @()
foreach ($p in $props) {
    $name = $p.Name
    $val = $p.Value
    if ($val -match '^[A-Za-z]:\\') {
        $path = $val
    } else {
        $path = Join-Path "$env:WINDIR\Fonts" $val
    }
    $fonts += [PSCustomObject]@{ RegistryName = $name; File = $path }
}
$fonts | Export-Csv -Path $outCsv -NoTypeInformation -Encoding UTF8
Write-Output "dumped $($fonts.Count) fonts -> $outCsv"
