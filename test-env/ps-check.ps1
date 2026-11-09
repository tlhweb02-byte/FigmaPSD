param(
    [string]$PsdFile = "C:\Users\jm038153\Desktop\直接导出打标PSD.psd",
    [string]$LogFile = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\ps-check.log"
)
function Log($msg) { $msg | Out-File $LogFile -Append -Encoding utf8 }
Log "=== start $(Get-Date -Format o) ==="
Log "file: $PsdFile"
try {
    $ps = $null
    try {
        $ps = [Runtime.InteropServices.Marshal]::GetActiveObject("Photoshop.Application")
        Log "attached to running PS, version=$($ps.Version)"
    } catch {
        $ps = New-Object -ComObject Photoshop.Application
        Log "created new PS instance, version=$($ps.Version)"
    }
    $ps.DisplayDialogs = 3
    $doc = $ps.Open($PsdFile)
    Start-Sleep -Milliseconds 800
    Log "doc: $($doc.Name) $($doc.Width)x$($doc.Height) res=$($doc.Resolution)"
    foreach ($layer in $doc.Layers) {
        $b = $layer.Bounds
        $x0 = [math]::Round($b[0]); $y0 = [math]::Round($b[1])
        $x1 = [math]::Round($b[2]); $y1 = [math]::Round($b[3])
        $info = "  LAYER '$($layer.Name)' kind=$($layer.Kind) bounds=($x0,$y0)-($x1,$y1)"
        if ($layer.Kind -eq 2) {
            try {
                $ti = $layer.TextItem
                $px = [math]::Round($ti.Position[0]); $py = [math]::Round($ti.Position[1])
                $info += " | TEXT pos=($px,$py) size=$([math]::Round($ti.Size,1)) font=$($ti.Font) contents='$($ti.Contents)'"
            } catch { $info += " | textItem err" }
        }
        Log $info
    }
    $doc.Close(2)
    Log "closed"
} catch {
    Log "ERROR: $($_.Exception.Message)"
}
Log "=== end $(Get-Date -Format o) ==="
