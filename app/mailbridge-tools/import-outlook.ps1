param([Parameter(Mandatory=$true)][string]$PstPath, [Parameter(Mandatory=$true)][string]$OutputDirectory, [string]$CancelPath='')
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function ReleaseCom($Value) { if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value) } }
function CheckCancellation { if ($CancelPath -and (Test-Path -LiteralPath $CancelPath)) { throw 'Import canceled. Already imported messages are kept.' } }
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
$added=$false; $root=$null
try {
  if (!(Test-Path -LiteralPath $PstPath -PathType Leaf)) { throw 'PST file does not exist' }
  New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
  @{progress='Connecting to classic Outlook. Complete any Outlook profile or password prompts.'} | ConvertTo-Json -Compress
  $outlook = New-Object -ComObject Outlook.Application
  @{progress='Opening your Outlook profile.'} | ConvertTo-Json -Compress
  $namespace = $outlook.GetNamespace('MAPI')
  $fullPath = [IO.Path]::GetFullPath($PstPath)
  $store=$null
  for ($i=1; $i -le $namespace.Stores.Count; $i++) { $candidate=$namespace.Stores.Item($i); if ($candidate.FilePath -eq $fullPath) { $store=$candidate; break } }
  if (!$store) {
    @{progress='Opening the temporary PST copy in Outlook. Large PSTs can take several minutes.'} | ConvertTo-Json -Compress
    $namespace.AddStoreEx($fullPath, 3); $added=$true
    for ($i=1; $i -le $namespace.Stores.Count; $i++) { $candidate=$namespace.Stores.Item($i); if ($candidate.FilePath -eq $fullPath) { $store=$candidate; break } }
  }
  if (!$store) { throw 'Outlook could not open this PST file' }
  $root=$store.GetRootFolder()
  try { $script:InboxId=$store.GetDefaultFolder(6).EntryID } catch { $script:InboxId='' }
  try { $script:SentId=$store.GetDefaultFolder(5).EntryID } catch { $script:SentId='' }
  try { $script:TrashId=$store.GetDefaultFolder(3).EntryID } catch { $script:TrashId='' }
  for ($i=1; $i -le $root.Folders.Count; $i++) { CheckCancellation; $folder=$root.Folders.Item($i); try { Walk $folder $folder.Name } finally { ReleaseCom $folder } }
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
finally {
  if ($added -and $root) { try { $namespace.RemoveStore($root) } catch { [Console]::Error.WriteLine('Close the temporary MailBridge PST in classic Outlook if it remains open: ' + $PstPath) } }
  ReleaseCom $root; ReleaseCom $store; ReleaseCom $namespace; ReleaseCom $outlook
}
