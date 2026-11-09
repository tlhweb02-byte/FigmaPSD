param(
    [string]$LogFile = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\ps-box.log"
)
function Log($msg) { $msg | Out-File $LogFile -Append -Encoding utf8 }
Log "=== start $(Get-Date -Format o) ==="
try {
    $ps = [Runtime.InteropServices.Marshal]::GetActiveObject("Photoshop.Application")
    $ps.DisplayDialogs = 3
    $f = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\out\box-fixed.psd"
    $doc = $ps.Open($f)
    Start-Sleep -Milliseconds 500
    foreach ($layer in $doc.Layers) {
        $b = $layer.Bounds
        $ti = $layer.TextItem
        $x0 = [math]::Round($b[0]); $y0 = [math]::Round($b[1])
        $x1 = [math]::Round($b[2]); $y1 = [math]::Round($b[3])
        $px = [math]::Round($ti.Position[0]); $py = [math]::Round($ti.Position[1])
        Log "box-fixed: bounds=($x0,$y0)-($x1,$y1) pos=($px,$py) size=$($ti.Size) contents='$($ti.Contents)'"
    }
    $doc.Close(2)
} catch {
    Log "ERROR: $($_.Exception.Message)"
}
Log "=== end $(Get-Date -Format o) ==="
