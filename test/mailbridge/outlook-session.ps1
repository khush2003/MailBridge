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
$visibleExplorer=[pscustomobject]@{DisplayCount=0}
$visibleExplorer | Add-Member ScriptMethod Display {$this.DisplayCount++}
$windowApp=[pscustomobject]@{Explorer=$null}
$windowApp | Add-Member ScriptMethod ActiveExplorer {return $this.Explorer}
$windowFolder=[pscustomobject]@{Explorer=$visibleExplorer}
$windowFolder | Add-Member ScriptMethod GetExplorer {return $this.Explorer}
$windowNamespace=[pscustomobject]@{Folder=$windowFolder}
$windowNamespace | Add-Member ScriptMethod GetDefaultFolder {param($kind) return $this.Folder}
EnsureOutlookWindow $windowApp $windowNamespace
if($visibleExplorer.DisplayCount -ne 1){throw 'Automation startup must expose an Outlook window before attaching a PST'}
$windowApp.Explorer=$visibleExplorer
EnsureOutlookWindow $windowApp $windowNamespace
if($visibleExplorer.DisplayCount -ne 1){throw 'An existing Outlook window must not be duplicated'}
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
# Execute the real import entry point with an already-open source. Any attempted
# AddStoreEx or RemoveStore is a failure: neither operation is allowed on that file.
$fixture=Join-Path ([IO.Path]::GetTempPath()) ('mailbridge-open-pst-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
try {
 $SourcePstPath=Join-Path $fixture 'original.pst'
 $PstPath=$SourcePstPath; [IO.File]::WriteAllBytes($SourcePstPath,[byte[]]@());$ExistingStoreOnly=$true
 $OutputDirectory=Join-Path $fixture 'eml';$CancelPath=''
 $testRoot=[pscustomobject]@{Folders=[pscustomobject]@{Count=0}}
 $testStore=[pscustomobject]@{FilePath=$SourcePstPath;Root=$testRoot}
 $testStore | Add-Member ScriptMethod GetRootFolder {return $this.Root}
 $testStore | Add-Member ScriptMethod GetDefaultFolder {param($kind) return [pscustomobject]@{EntryID=('folder-'+$kind)}}
 $testStores=[pscustomobject]@{Count=1;Store=$testStore}
 $testStores | Add-Member ScriptMethod Item {param($index) return $this.Store}
 $testSession=[pscustomobject]@{Stores=$testStores}
 $testSession | Add-Member ScriptMethod GetDefaultFolder {param($kind) return [pscustomobject]@{EntryID='inbox'}}
 $testSession | Add-Member ScriptMethod AddStoreEx {throw 'Must not attach another copy of the open source'}
 $testSession | Add-Member ScriptMethod RemoveStore {throw 'Must not detach the user source'}
 $testOutlook=[pscustomobject]@{Namespace=$testSession}
 $testOutlook | Add-Member ScriptMethod GetNamespace {param($kind) return $this.Namespace}
 function New-Object {param([string]$ComObject) if($ComObject -eq 'Outlook.Application'){return $testOutlook};throw 'Unexpected construction in entry point'}
 $added=$false;$root=$null;$stage='Starting classic Outlook';$fullPath=''
 $entry=$ast.EndBlock.Statements | Where-Object {$_ -is [Management.Automation.Language.TryStatementAst]} | Select-Object -Last 1
 $records=@(Invoke-Expression $entry.Extent.Text | ForEach-Object {$_ | ConvertFrom-Json})
 if($added){throw 'Open source was classified as disposable'}
 if(!(Test-Path -LiteralPath $SourcePstPath)){throw 'Open source was removed'}
 if(!($records | Where-Object {$_.snapshotDetached -eq $true})){throw 'Unused snapshot cleanup was not confirmed'}
 if(!($records | Where-Object {$_.progress -like '*already open*'})){throw 'Open-source progress was not reported'}
}finally {Remove-Item Function:\New-Object -ErrorAction SilentlyContinue;Remove-Item -LiteralPath $fixture -Recurse -Force}
Write-Output 'Outlook session fixtures passed: initialization, stale stores, lookup, cleanup, and importing an open source without attaching/detaching it. Real COM requires separate pilot evidence.'
