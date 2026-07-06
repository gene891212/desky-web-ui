Add-Type -AssemblyName System.Drawing

function New-DeskyIcon {
  param(
    [int]$Size,
    [string]$OutPath,
    [switch]$Maskable
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $bg = [System.Drawing.Color]::FromArgb(255, 2, 6, 23)      # slate-950
  $brand = [System.Drawing.Color]::FromArgb(255, 99, 102, 241) # brand-500
  $white = [System.Drawing.Color]::FromArgb(255, 241, 245, 249) # slate-100

  if ($Maskable) {
    $g.Clear($bg)
  } else {
    $g.Clear([System.Drawing.Color]::Transparent)
    $radius = [int]($Size * 0.22)
    $rectF = New-Object System.Drawing.Rectangle 0, 0, $Size, $Size
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc(0, 0, $d, $d, 180, 90)
    $path.AddArc($Size - $d, 0, $d, $d, 270, 90)
    $path.AddArc($Size - $d, $Size - $d, $d, $d, 0, 90)
    $path.AddArc(0, $Size - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $brush = New-Object System.Drawing.SolidBrush $bg
    $g.FillPath($brush, $path)
  }

  # Safe-zone-aware content box (fits within ~80% circle for maskable icons)
  $pad = if ($Maskable) { [double]$Size * 0.30 } else { [double]$Size * 0.20 }
  $innerSize = $Size - ($pad * 2)

  # Desk leg (vertical bar)
  $legW = $innerSize * 0.16
  $legX = $Size / 2 - $legW / 2
  $legTop = $pad + $innerSize * 0.30
  $legH = $innerSize * 0.55
  $brandBrush = New-Object System.Drawing.SolidBrush $brand
  $g.FillRectangle($brandBrush, [float]$legX, [float]$legTop, [float]$legW, [float]$legH)

  # Desktop surface (horizontal bar) with rounded ends
  $topW = $innerSize
  $topH = $innerSize * 0.16
  $topX = $Size / 2 - $topW / 2
  $topY = $pad + $innerSize * 0.20
  $topRect = New-Object System.Drawing.Rectangle ([int]$topX), ([int]$topY), ([int]$topW), ([int]$topH)
  $whiteBrush = New-Object System.Drawing.SolidBrush $white
  $topRadius = $topH / 2
  $topPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $dd = $topRadius * 2
  $topPath.AddArc([float]$topX, [float]$topY, [float]$dd, [float]$dd, 90, 180)
  $topPath.AddArc([float]($topX + $topW - $dd), [float]$topY, [float]$dd, [float]$dd, 270, 180)
  $topPath.CloseFigure()
  $g.FillPath($whiteBrush, $topPath)

  # Up/down height-adjust arrows to the right of the leg
  $arrowX = $Size / 2 + $innerSize * 0.28
  $arrowW = $innerSize * 0.16
  $arrowCy1 = $pad + $innerSize * 0.55
  $arrowCy2 = $pad + $innerSize * 0.78
  $pen = New-Object System.Drawing.Pen $brand, ([float]($innerSize * 0.09))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round

  # up chevron
  $g.DrawLines($pen, @(
    (New-Object System.Drawing.PointF ([float]($arrowX - $arrowW)), ([float]($arrowCy1 + $arrowW * 0.6))),
    (New-Object System.Drawing.PointF ([float]$arrowX), ([float]($arrowCy1 - $arrowW * 0.6))),
    (New-Object System.Drawing.PointF ([float]($arrowX + $arrowW)), ([float]($arrowCy1 + $arrowW * 0.6)))
  ))
  # down chevron
  $g.DrawLines($pen, @(
    (New-Object System.Drawing.PointF ([float]($arrowX - $arrowW)), ([float]($arrowCy2 - $arrowW * 0.6))),
    (New-Object System.Drawing.PointF ([float]$arrowX), ([float]($arrowCy2 + $arrowW * 0.6))),
    (New-Object System.Drawing.PointF ([float]($arrowX + $arrowW)), ([float]($arrowCy2 - $arrowW * 0.6)))
  ))

  $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

$iconDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

New-DeskyIcon -Size 192 -OutPath (Join-Path $iconDir "icon-192.png")
New-DeskyIcon -Size 512 -OutPath (Join-Path $iconDir "icon-512.png")
New-DeskyIcon -Size 512 -OutPath (Join-Path $iconDir "icon-maskable-512.png") -Maskable
New-DeskyIcon -Size 180 -OutPath (Join-Path $iconDir "apple-touch-icon.png")
New-DeskyIcon -Size 32 -OutPath (Join-Path $iconDir "favicon-32.png")

"Icons generated in $iconDir"
