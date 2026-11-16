# Runs inkflo from this folder with no internet. Windows only; nothing to install.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$port = 5191
$mime = @{ '.html'='text/html'; '.js'='text/javascript'; '.mjs'='text/javascript'; '.css'='text/css'; '.json'='application/json'
  '.webmanifest'='application/manifest+json'; '.wasm'='application/wasm'; '.png'='image/png'; '.jpg'='image/jpeg'; '.svg'='image/svg+xml'
  '.woff'='font/woff'; '.woff2'='font/woff2'; '.ttf'='font/ttf'; '.otf'='font/otf'; '.txt'='text/plain'; '.zip'='application/zip' }
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
try { $listener.Start() } catch {
  Write-Host "Could not start on port $port. Is inkflo already running in another window? Close it and try again." -ForegroundColor Yellow
  Read-Host 'Press Enter to close'; exit 1
}
Start-Process "http://localhost:$port/"
Write-Host ''
Write-Host '  inkflo is running.' -ForegroundColor Green
Write-Host '  Your browser should have opened. If not, go to  http://localhost:5191/'
Write-Host '  Keep this window open while you draw. Close it when you are done.'
Write-Host ''
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
    if ($rel -eq '' ) { $rel = 'index.html' }
    $path = [IO.Path]::GetFullPath((Join-Path $root $rel))
    if (-not $path.StartsWith($root) -or -not (Test-Path $path -PathType Leaf)) { $ctx.Response.StatusCode = 404 }
    else {
      $ext = [IO.Path]::GetExtension($path).ToLower()
      $ctx.Response.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [IO.File]::ReadAllBytes($path)
      $ctx.Response.ContentLength64 = $bytes.Length
      $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch { $ctx.Response.StatusCode = 500 }
  finally { $ctx.Response.Close() }
}
