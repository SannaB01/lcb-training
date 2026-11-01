# Baut die installierbare Web-App nach docs/ (wird von GitHub Pages ausgeliefert).
# Quelle bleibt index.html (gleiche Datei wie das claude.ai-Artifact) + calc.js + hammer.js.
# Aufruf im Ordner kraftaufbau:  powershell -ExecutionPolicy Bypass -File build.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$out = Join-Path $root 'docs'
$logo = Join-Path (Split-Path $root -Parent) 'Appbild1.png'
$utf8 = New-Object System.Text.UTF8Encoding($false)

New-Item -ItemType Directory -Force (Join-Path $out 'icons') | Out-Null

# Icons aus dem Logo (quadratisch, deckend – so verlangt es iOS)
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($logo)
foreach ($icon in @(@{ n = 'apple-touch-icon.png'; s = 180 }, @{ n = 'icon-192.png'; s = 192 }, @{ n = 'icon-512.png'; s = 512 }, @{ n = 'icon-32.png'; s = 32 })) {
  $bmp = New-Object System.Drawing.Bitmap($icon.s, $icon.s)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.DrawImage($src, 0, 0, $icon.s, $icon.s)
  $bmp.Save((Join-Path $out "icons\$($icon.n)"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
$src.Dispose()

# index.html: Artifact-Inhalt in ein vollständiges Dokument mit PWA-Kopf einbetten
$body = [System.IO.File]::ReadAllText((Join-Path $root 'index.html'), $utf8)
$head = @'
<!doctype html>
<html lang="de-CH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b4d23">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="LCB Training">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<link rel="icon" type="image/png" href="icons/icon-32.png">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,-apple-system,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>
<script src="config.js"></script>
</head>
<body>
'@
$tail = @'

<script>if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('sw.js'));</script>
</body>
</html>
'@
[System.IO.File]::WriteAllText((Join-Path $out 'index.html'), $head + $body + $tail, $utf8)

# Übrige Dateien
Copy-Item (Join-Path $root 'calc.js'), (Join-Path $root 'hammer.js') $out -Force
Copy-Item (Join-Path $root 'pwa\config.js'), (Join-Path $root 'pwa\manifest.webmanifest') $out -Force
$build = Get-Date -Format 'yyyyMMdd-HHmmss'
$sw = [System.IO.File]::ReadAllText((Join-Path $root 'pwa\sw.js'), $utf8).Replace('__BUILD__', $build)
[System.IO.File]::WriteAllText((Join-Path $out 'sw.js'), $sw, $utf8)
# GitHub Pages soll die Dateien unverändert ausliefern
[System.IO.File]::WriteAllText((Join-Path $out '.nojekyll'), '', $utf8)

Write-Output "Build $build -> $out"
