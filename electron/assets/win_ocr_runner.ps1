param([string]$ImagePath)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
[Windows.Media.Ocr.OcrEngine, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Foundation.Metadata, ContentType = WindowsRuntime] | Out-Null

function Await-AsyncOp($asyncOp, $type) {
  $asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.IsGenericMethod
  } | Select-Object -First 1
  $asTask = $asTaskGeneric.MakeGenericMethod($type)
  $task = $asTask.Invoke($null, @($asyncOp))
  return $task.GetAwaiter().GetResult()
}

$fullPath = [System.IO.Path]::GetFullPath($ImagePath)
$file = Await-AsyncOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($fullPath)) ([Windows.Storage.StorageFile])
$stream = Await-AsyncOp ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await-AsyncOp ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await-AsyncOp ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

$lang = [Windows.Globalization.Language, Windows.Foundation.Metadata, ContentType = WindowsRuntime]::new('zh-Hans-CN')
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
if (-not $engine) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages() }

$ocrResult = Await-AsyncOp ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

$pixelW = [double]$bitmap.PixelWidth
$pixelH = [double]$bitmap.PixelHeight
$lines = @()

foreach ($line in $ocrResult.Lines) {
  if ($line.Words.Count -gt 0) {
    $minX = $pixelW
    $minY = $pixelH
    $maxX = 0.0
    $maxY = 0.0
    foreach ($w in $line.Words) {
      $rx = [double]$w.BoundingRect.X
      $ry = [double]$w.BoundingRect.Y
      $rw = [double]$w.BoundingRect.Width
      $rh = [double]$w.BoundingRect.Height
      if ($rx -lt $minX) { $minX = $rx }
      if ($ry -lt $minY) { $minY = $ry }
      if (($rx + $rw) -gt $maxX) { $maxX = ($rx + $rw) }
      if (($ry + $rh) -gt $maxY) { $maxY = ($ry + $rh) }
    }

    $normX = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($minX / $pixelW, 4)))
    $normY = [Math]::Max(0.0, [Math]::Min(1.0, [Math]::Round($minY / $pixelH, 4)))
    $normW = [Math]::Max(0.005, [Math]::Min(1.0 - $normX, [Math]::Round(($maxX - $minX) / $pixelW, 4)))
    $normH = [Math]::Max(0.005, [Math]::Min(1.0 - $normY, [Math]::Round(($maxY - $minY) / $pixelH, 4)))

    $lines += @{
      text = $line.Text
      bbox = @{
        x = $normX
        y = $normY
        width = $normW
        height = $normH
      }
    }
  }
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$outputObj = @{
  width = $pixelW
  height = $pixelH
  lines = $lines
}

Write-Output (ConvertTo-Json -Depth 5 -Compress $outputObj)
