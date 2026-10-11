$ErrorActionPreference='Stop'
$script=Join-Path $PSScriptRoot '../../app/mailbridge-tools/import-outlook.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script),[ref]$tokens,[ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($function in $ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]},$false)) { Invoke-Expression $function.Extent.Text }
$session=[pscustomobject]@{Initialized=$false}
$session | Add-Member ScriptMethod GetDefaultFolder {param($kind) if($kind -ne 6){throw 'Wrong initialization folder'};$this.Initialized=$true;return [pscustomobject]@{EntryID='inbox'} }
InitializeOutlookSession $session
if (!$session.Initialized) { throw 'MAPI was not initialized' }
$broken=[pscustomobject]@{}
$broken | Add-Member ScriptProperty FilePath {throw 'The Outlook data file failed to load for this session'}
$target=[pscustomobject]@{FilePath='C:\Backups\Protected.pst'}
$stores=[pscustomobject]@{Count=3;Values=@($broken,[pscustomobject]@{FilePath='C:\Other.pst'},$target)}
$stores | Add-Member ScriptMethod Item {param($index) return $this.Values[$index-1]}
$session | Add-Member NoteProperty Stores $stores
$found=FindPstStore $session 'c:\backups\protected.pst'
if (!$found -or $found.FilePath -ne $target.FilePath) {throw 'A stale store interrupted the selected PST lookup'}
if ($null -ne (FindPstStore $session 'C:\Missing.pst')) {throw 'A missing PST must not match another store'}
$root=[pscustomobject]@{EntryID='temporary-root'}
$session | Add-Member NoteProperty DetachedRoot $null
$session | Add-Member ScriptMethod RemoveStore {param($folder) $this.DetachedRoot=$folder}
$result=DetachImportedPst $session $root 'C:\Backups\Protected.pst' | ConvertFrom-Json
if (!$result.snapshotDetached -or $session.DetachedRoot.EntryID -ne $root.EntryID) {throw 'Detach was not confirmed'}
$session | Add-Member ScriptMethod RemoveStore {param($folder) throw 'Store is still locked'} -Force
$originalError=[Console]::Error
$captured=New-Object IO.StringWriter
try {
 [Console]::SetError($captured)
 $result=DetachImportedPst $session $root 'C:\Backups\Protected.pst' | ConvertFrom-Json
 if (!$result.retainSnapshot -or !$result.progress.Contains('copy is kept')) {throw 'Failed cleanup must retain the copy'}
 if (!$captured.ToString().Contains('Close that')) {
   if (!$captured.ToString().Contains('close that')) {throw 'Cleanup instructions were not reported'}
 }
} finally {[Console]::SetError($originalError);$captured.Dispose()}
Write-Output 'Outlook session fixtures passed: MAPI initialization, inaccessible unrelated stores, case-insensitive PST lookup, confirmed detach and protected-copy preservation. Real Outlook COM remains untested.'
