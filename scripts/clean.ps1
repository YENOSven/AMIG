$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$targets = @(
  (Join-Path $projectRoot "dist"),
  (Join-Path $projectRoot "release")
)

foreach ($target in $targets) {
  $fullPath = [System.IO.Path]::GetFullPath($target)
  if (-not $fullPath.StartsWith($projectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clean outside the project: $fullPath"
  }

  if (Test-Path -LiteralPath $fullPath) {
    Remove-Item -LiteralPath $fullPath -Recurse -Force
  }
}

Write-Output "Cleaned dist and release."
