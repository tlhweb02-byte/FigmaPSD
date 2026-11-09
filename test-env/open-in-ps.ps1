param(
    [string]$PsdPath = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\out\new-31.0.2-withcanvas.psd",
    [string]$LogFile = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\ps-open.log"
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
    $ps.DisplayDialogs = 3  # psDisplayNoDialogs
    Log "opening $PsdPath"
    $doc = $ps.Open($PsdPath)
    Log "opened: $($doc.Width)x$($doc.Height) layers=$($doc.Layers.Count)"
    foreach ($layer in $doc.Layers) {
        $kind = $layer.Kind
        $name = $layer.Name
        $isText = ($kind -eq 2)
        $contents = ""
        if ($isText) {
            try { $contents = $layer.TextItem.Contents } catch { $contents = "<err: $($_.Exception.Message)>" }
        }
        Log "LAYER name='$name' kind=$kind textLayer=$isText contents='$contents'"
    }
    $doc.Close(2)
    Log "closed"
} catch {
    Log "ERROR: $($_.Exception.Message)"
}
Log "=== end $(Get-Date -Format o) ==="
