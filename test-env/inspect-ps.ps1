# Open PSDs in Photoshop and report layer kinds
param([string]$PsdDir = "C:\Users\jm038153\Desktop\jpg\Figma2PSD-Pro\test-env\out")

$ps = New-Object -ComObject Photoshop.Application
$ps.DisplayDialogs = 3  # psDisplayNoDialogs
$results = @()

Get-ChildItem -Path $PsdDir -Filter "*.psd" | ForEach-Object {
    $file = $_.FullName
    try {
        $doc = $ps.Open($file)
        Start-Sleep -Milliseconds 500
        $layerInfo = @()
        foreach ($layer in $doc.Layers) {
            $kind = $layer.Kind  # 1=normal, 2=text, 5=background...
            $name = $layer.Name
            $isText = ($kind -eq 2)
            $textContents = ""
            if ($isText) {
                try { $textContents = $layer.TextItem.Contents } catch { $textContents = "<err>" }
            }
            $layerInfo += "  layer: '$name' kind=$kind textLayer=$isText contents='$textContents'"
        }
        $results += "FILE: $(Split-Path $file -Leaf)"
        $results += "  doc: $($doc.Width)x$($doc.Height)"
        $results += $layerInfo
        $doc.Close(2)  # psDoNotSaveChanges
    } catch {
        $results += "FILE: $(Split-Path $file -Leaf) ERROR: $($_.Exception.Message)"
    }
}

$ps.Quit()
$results | Out-String
