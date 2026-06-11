$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseDir = Join-Path $projectRoot "release"
$package = Get-Content -LiteralPath (Join-Path $projectRoot "package.json") -Raw | ConvertFrom-Json
$productName = $package.build.productName
$version = $package.version
$installerName = "$productName Setup $version.exe"
$zipName = "$productName Setup $version.zip"
$installerPath = Join-Path $releaseDir $installerName
$zipPath = Join-Path $releaseDir $zipName

if (-not (Test-Path -LiteralPath $installerPath -PathType Leaf)) {
  throw "Installer not found: $installerPath"
}

$releaseFullPath = [System.IO.Path]::GetFullPath($releaseDir)
if (-not $releaseFullPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to finalize outside the project: $releaseFullPath"
}

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -LiteralPath $installerPath -DestinationPath $zipPath -CompressionLevel Optimal

$disposablePaths = @(
  (Join-Path $releaseDir "win-unpacked"),
  (Join-Path $releaseDir "$installerName.blockmap"),
  (Join-Path $releaseDir "latest.yml")
)

foreach ($path in $disposablePaths) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

$zip = Get-Item -LiteralPath $zipPath
Write-Output "Created $($zip.FullName) ($($zip.Length) bytes)."
