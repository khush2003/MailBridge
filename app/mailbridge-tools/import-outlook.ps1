param([Parameter(Mandatory=$true)][string]$PstPath, [Parameter(Mandatory=$true)][string]$OutputDirectory, [string]$CancelPath='', [string]$SourcePstPath='')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function ReleaseCom($Value) { if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value) } }
function CheckCancellation { if ($CancelPath -and (Test-Path -LiteralPath $CancelPath)) { throw 'Import canceled. Already imported messages are kept.' } }
function InitializeOutlookSession($Namespace) {
  # Microsoft recommends referencing a default folder to initialize MAPI before
  # accessing stores. Do not Logon to a second profile or handle PST passwords here.
  $inbox=$null
  try { $inbox=$Namespace.GetDefaultFolder(6) } finally { ReleaseCom $inbox }
}
function EnsureOutlookWindow($Application, $Namespace) {
  $explorer=$null; $folder=$null
  try {
    $explorer=$Application.ActiveExplorer()
    if (!$explorer) { $folder=$Namespace.GetDefaultFolder(6); $explorer=$folder.GetExplorer(); $explorer.Display() }
  } finally { ReleaseCom $explorer; ReleaseCom $folder }
}
function FindPstStore($Namespace, [string]$Path) {
  for ($i=1; $i -le $Namespace.Stores.Count; $i++) {
    $candidate=$null
    try {
      $candidate=$Namespace.Stores.Item($i)
      if ($candidate.FilePath -eq $Path) { $match=$candidate; $candidate=$null; return $match }
    } catch {
      # A different locked, disconnected or stale store must not abort this import.
    } finally { ReleaseCom $candidate }
  }
  return $null
}
function DetachImportedPst($Namespace, $Root, [string]$Path) {
  $cleanupRoot=$null
  $cleanupStore=$null
  try {
    if ($Root) { $Namespace.RemoveStore($Root); @{snapshotDetached=$true} | ConvertTo-Json -Compress; return }
    $cleanupStore=FindPstStore $Namespace $Path
    if ($cleanupStore) { $cleanupRoot=$cleanupStore.GetRootFolder(); $Namespace.RemoveStore($cleanupRoot); @{snapshotDetached=$true} | ConvertTo-Json -Compress; return }
    # AddStoreEx can fail after updating the profile. Retain the copy if detaching
    # cannot be confirmed; deleting it can leave a broken Outlook profile entry.
    throw 'The temporary store could not be inspected.'
  } catch {
    @{retainSnapshot=$true; progress=('Outlook may still have the temporary PST attached. The copy is kept at: ' + $Path)} | ConvertTo-Json -Compress
    [Console]::Error.WriteLine('The temporary PST copy was kept at ' + $Path + '. In Outlook, close that data file before deleting the copy. Your original PST is unchanged.')
  } finally { ReleaseCom $cleanupRoot; ReleaseCom $cleanupStore }
}
function Clean([string]$Value) { return ($Value -replace '[\r\n]', ' ').Trim() }
function Encoded([string]$Value) { return '=?UTF-8?B?' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Clean $Value))) + '?=' }
function Property($Item, [string]$Tag) { try { return $Item.PropertyAccessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/' + $Tag) } catch { return $null } }
function Address($Recipient) {
  try {
    if ($Recipient.AddressEntry.Type -eq 'EX') {
      $user = $Recipient.AddressEntry.GetExchangeUser()
      if ($user) { return Clean $user.PrimarySmtpAddress }
      $smtp = Property $Recipient.AddressEntry '0x39FE001E'
      if ($smtp) { return Clean $smtp }
    }
    return Clean $Recipient.Address
  } catch { return '' }
}
function Base64Lines([byte[]]$Bytes) { return [Convert]::ToBase64String($Bytes, [Base64FormattingOptions]::InsertLineBreaks) }
function ExportMail($Item, [string]$Folder, [string]$Role) {
  $id = [Guid]::NewGuid().ToString('N')
  $temporary = Join-Path $OutputDirectory ($id + '.attachments')
  New-Item -ItemType Directory -Path $temporary | Out-Null
  try {
    $sender = Clean $Item.SenderEmailAddress
    if ($Item.SenderEmailType -eq 'EX') { try { $sender = Clean $Item.Sender.GetExchangeUser().PrimarySmtpAddress } catch {} }
    if (!$sender.Contains('@')) { throw 'Cannot resolve sender SMTP address' }
    $headers = New-Object 'System.Collections.Generic.List[string]'
    $headers.Add('From: ' + (Encoded $Item.SenderName) + ' <' + $sender + '>')
    foreach ($type in @(1,2,3)) {
      $addresses = @()
      for ($i=1; $i -le $Item.Recipients.Count; $i++) {
        $recipient = $Item.Recipients.Item($i)
        if ($recipient.Type -eq $type) {
          $address = Address $recipient
          if ($address.Contains('@')) { $addresses += (Encoded $recipient.Name) + ' <' + $address + '>' }
        }
      }
      if ($addresses.Count) { $headers.Add(@('To','Cc','Bcc')[$type-1] + ': ' + ($addresses -join ', ')) }
    }
    $messageId = Property $Item '0x1035001F'
    if (!$messageId) { $messageId = Property $Item '0x1035001E' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Item.EntryID))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
    if (!$messageId) { $messageId = '<outlook-' + $digest + '@mailbridge.local>' }
    $headers.Add('Message-ID: ' + (Clean $messageId))
    $headers.Add('Subject: ' + (Encoded $Item.Subject))
    $headers.Add('Date: ' + $Item.SentOn.ToUniversalTime().ToString('ddd, dd MMM yyyy HH:mm:ss +0000', [Globalization.CultureInfo]::InvariantCulture))
    $references = Property $Item '0x1039001F'
    if ($references) { $headers.Add('References: ' + (Clean $references)) }
    $reply = Property $Item '0x1042001F'
    if ($reply) { $headers.Add('In-Reply-To: ' + (Clean $reply)) }
    $boundary = 'MailBridge_' + $digest
    $headers.Add('MIME-Version: 1.0')
    $headers.Add('Content-Type: multipart/mixed; boundary="' + $boundary + '"')
    $parts = New-Object 'System.Collections.Generic.List[string]'
    $html = [string]$Item.HTMLBody
    $body = [string]$Item.Body
    if ($html) { $parts.Add('--' + $boundary + "`r`nContent-Type: text/html; charset=utf-8`r`nContent-Transfer-Encoding: base64`r`n`r`n" + (Base64Lines ([Text.Encoding]::UTF8.GetBytes($html)))) }
    else { $parts.Add('--' + $boundary + "`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Transfer-Encoding: base64`r`n`r`n" + (Base64Lines ([Text.Encoding]::UTF8.GetBytes($body)))) }
    for ($i=1; $i -le $Item.Attachments.Count; $i++) {
      $attachment = $Item.Attachments.Item($i)
      $file = Join-Path $temporary ($i.ToString() + '.bin')
      $attachment.SaveAsFile($file)
      $name = [Uri]::EscapeDataString([string]$attachment.FileName)
      $cid = Property $attachment '0x3712001F'
      $disposition = if ($cid) { 'inline' } else { 'attachment' }
      $contentType = Property $attachment '0x370E001F'
      if (!$contentType -or $contentType -notmatch '^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$') {
        $types=@{'.png'='image/png';'.jpg'='image/jpeg';'.jpeg'='image/jpeg';'.gif'='image/gif';'.pdf'='application/pdf'}
        $contentType=$types[[IO.Path]::GetExtension($attachment.FileName).ToLowerInvariant()]
        if (!$contentType) { $contentType='application/octet-stream' }
      }
      $part = '--' + $boundary + "`r`nContent-Type: " + $contentType + "`r`nContent-Disposition: " + $disposition + "; filename*=UTF-8''" + $name + "`r`nContent-Transfer-Encoding: base64`r`n"
      if ($cid) { $part += 'Content-ID: <' + (Clean $cid).Trim('<','>') + ">`r`n" }
      $parts.Add($part + "`r`n" + (Base64Lines ([IO.File]::ReadAllBytes($file))))
    }
    $mime = ($headers -join "`r`n") + "`r`n`r`n" + ($parts -join "`r`n") + "`r`n--" + $boundary + "--`r`n"
    $fileName = $id + '.eml'
    [IO.File]::WriteAllText((Join-Path $OutputDirectory $fileName), $mime, [Text.Encoding]::ASCII)
    @{ file=$fileName; folder=$Folder; role=$Role; unread=[bool]$Item.UnRead; starred=($Item.FlagStatus -eq 2) } | ConvertTo-Json -Compress
  } finally { Remove-Item $temporary -Recurse -Force -ErrorAction SilentlyContinue }
}
function Walk($Folder, [string]$Path) {
  @{progress=('Exporting Outlook folder: ' + $Path)} | ConvertTo-Json -Compress
  $role = ''
  if ($Folder.EntryID -eq $script:InboxId) { $role='inbox'; $Path='INBOX' }
  if ($Folder.EntryID -eq $script:SentId) { $role='sent'; $Path='Sent' }
  if ($Folder.EntryID -eq $script:TrashId) { $role='trash'; $Path='Trash' }
  for ($i=1; $i -le $Folder.Items.Count; $i++) {
    CheckCancellation
    $item = $Folder.Items.Item($i)
    try { if ($item.Class -eq 43 -and $item.Sent) {
      try { ExportMail $item $Path $role } catch { @{warning='A message could not be exported'; folder=$Path; detail=$_.Exception.Message} | ConvertTo-Json -Compress }
    } } finally { ReleaseCom $item }
  }
  for ($i=1; $i -le $Folder.Folders.Count; $i++) {
    CheckCancellation
    $child=$Folder.Folders.Item($i)
    try { Walk $child ($Path + '/' + $child.Name) } finally { ReleaseCom $child }
  }
}
$added=$false; $root=$null; $stage='Starting classic Outlook'; $fullPath=''
try {
  if (!(Test-Path -LiteralPath $PstPath -PathType Leaf)) { throw 'PST file does not exist' }
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  @{progress='Connecting to classic Outlook. Complete any Outlook profile or password prompts.'} | ConvertTo-Json -Compress
  $outlook = New-Object -ComObject Outlook.Application
  $stage='Opening your Outlook profile'
  @{progress='Opening your Outlook profile.'} | ConvertTo-Json -Compress
  $namespace = $outlook.GetNamespace('MAPI')
  InitializeOutlookSession $namespace
  CheckCancellation
  $fullPath = [IO.Path]::GetFullPath($PstPath)
  # An already-open source was explicitly unlocked by the user. Read its existing
  # store without adding/removing it or saving changes to its messages. This avoids
  # asking COM to reopen a password-protected copy, which can stall without a prompt.
  $store=$null
  if ($SourcePstPath) { $store=FindPstStore $namespace ([IO.Path]::GetFullPath($SourcePstPath)) }
  if ($store) {
    @{progress='Reading the PST already open in Outlook. Its data file will stay attached.'} | ConvertTo-Json -Compress
    $stage='Reading the PST already open in Outlook'
  } else { $store=FindPstStore $namespace $fullPath }
  if (!$store) {
    $stage='Opening the temporary PST copy'
    @{progress='Opening the temporary PST copy in Outlook. If it has a password, Outlook can ask for it again even after you unlock your profile.'} | ConvertTo-Json -Compress
    EnsureOutlookWindow $outlook $namespace
    $added=$true
    $namespace.AddStoreEx($fullPath, 2) # olStoreUnicode (Outlook 2003 and later)
    $store=FindPstStore $namespace $fullPath
  }
  if (!$store) { throw 'Outlook could not open this PST file' }
  if ($added) { $stage='Reading the temporary PST copy' }
  $root=$store.GetRootFolder()
  try { $script:InboxId=$store.GetDefaultFolder(6).EntryID } catch { $script:InboxId='' }
  try { $script:SentId=$store.GetDefaultFolder(5).EntryID } catch { $script:SentId='' }
  try { $script:TrashId=$store.GetDefaultFolder(3).EntryID } catch { $script:TrashId='' }
  for ($i=1; $i -le $root.Folders.Count; $i++) { CheckCancellation; $folder=$root.Folders.Item($i); try { Walk $folder $folder.Name } finally { ReleaseCom $folder } }
} catch {
  $failure=$_.Exception.GetBaseException()
  $detail=$failure.Message
  $code=$failure.HResult.ToString('X8')
  [Console]::Error.WriteLine($stage + ' failed (0x' + $code + '): ' + $detail + ' Open classic Outlook yourself, unlock its profile and confirm the original PST opens normally, then retry with Outlook left open. The temporary copy retains the PST password; a separate Outlook prompt may appear for it. If it still fails, export a separate PST from Outlook without a password and import that closed export. Keep your original PST.')
  exit 1
}
finally {
  if ($added) { DetachImportedPst $namespace $root $fullPath }
  else { @{snapshotDetached=$true} | ConvertTo-Json -Compress }
  ReleaseCom $root; ReleaseCom $store; ReleaseCom $namespace; ReleaseCom $outlook
}
