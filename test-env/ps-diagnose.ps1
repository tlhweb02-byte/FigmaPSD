param(
    [string]$LogFile = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\ps-diagnose.log"
)
function Log($msg) { $msg | Out-File $LogFile -Append -Encoding utf8 }
Log "=== start $(Get-Date -Format o) ==="
try {
    $ps = $null
    try {
        $ps = [Runtime.InteropServices.Marshal]::GetActiveObject("Photoshop.Application")
        Log "attached to running instance, version=$($ps.Version)"
    } catch {
        $ps = New-Object -ComObject Photoshop.Application
        Log "created new instance, version=$($ps.Version)"
    }
    $ps.DisplayDialogs = 3
    Log "docs open: $($ps.Documents.Count)"
    foreach ($doc in $ps.Documents) {
        Log "DOC: '$($doc.Name)' $($doc.Width)x$($doc.Height) res=$($doc.Resolution) layers=$($doc.Layers.Count)"
        foreach ($layer in $doc.Layers) {
            $kind = $layer.Kind
            $name = $layer.Name
            $b = $layer.Bounds
            $boundsStr = "($([math]::Round($b[0])),$([math]::Round($b[1])))-($([math]::Round($b[2])),$([math]::Round($b[3])))"
            $extra = ""
            if ($kind -eq 2) { # text layer
                try {
                    $ti = $layer.TextItem
                    $extra = " | textItem size=$($ti.Size) position=($([math]::Round($ti.Position[0])),$([math]::Round($ti.Position[1]))) font=$($ti.Font) contents='$($ti.Contents)'"
                } catch {
                    $extra = " | textItem read err: $($_.Exception.Message)"
                }
            }
            Log "  LAYER '$name' kind=$kind bounds=$boundsStr$extra"
        }
    }
} catch {
    Log "ERROR: $($_.Exception.Message)"
}
Log "=== end $(Get-Date -Format o) ==="
