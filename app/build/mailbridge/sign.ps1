param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
if (!$env:MAILBRIDGE_PFX_BASE64 -or !$env:MAILBRIDGE_PFX_PASSWORD) { throw 'Signing certificate and password must both be configured' }
$certificate = Join-Path $env:RUNNER_TEMP 'mailbridge-signing.pfx'
try {
  [IO.File]::WriteAllBytes($certificate, [Convert]::FromBase64String($env:MAILBRIDGE_PFX_BASE64))
  $tool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Filter signtool.exe -Recurse | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
  if (!$tool) { throw 'Windows SDK signing tool not found' }
  Get-ChildItem $Directory -Recurse -File | Where-Object { $_.Extension -in '.exe','.dll','.node' } | ForEach-Object {
    & $tool.FullName sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /f $certificate /p $env:MAILBRIDGE_PFX_PASSWORD $_.FullName
    if ($LASTEXITCODE) { throw "Signing failed for $($_.Name)" }
    if ((Get-AuthenticodeSignature $_.FullName).Status -ne 'Valid') { throw "Invalid signature for $($_.Name)" }
  }
} finally { Remove-Item $certificate -Force -ErrorAction SilentlyContinue }
