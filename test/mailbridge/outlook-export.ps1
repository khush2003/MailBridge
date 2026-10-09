$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot '../../app/mailbridge-tools/import-outlook.ps1'
$tokens=$null; $errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Resolve-Path $script), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$functions=$ast.FindAll({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst]}, $false)
foreach ($function in $functions) { Invoke-Expression $function.Extent.Text }
$OutputDirectory=Join-Path $env:TEMP ('mailbridge-export-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $OutputDirectory | Out-Null
try {
  $property=[pscustomobject]@{}
  $property | Add-Member ScriptMethod GetProperty { param($tag) if ($tag.EndsWith('0x1035001F')) { return '<outlook-fixture@example.test>' }; if ($tag.EndsWith('0x3712001F')) { return 'image@example.test' }; throw 'Absent property' }
  $attachment=[pscustomobject]@{FileName='report.bin'; PropertyAccessor=$property}
  $attachment | Add-Member ScriptMethod SaveAsFile { param($file) [IO.File]::WriteAllBytes($file, [byte[]]@(0,1,2,255)) }
  $attachments=[pscustomobject]@{Count=1; Fixture=$attachment}
  $attachments | Add-Member ScriptMethod Item {param($index) return $this.Fixture}
  $item=[pscustomobject]@{ SenderEmailAddress='sender@example.test'; SenderEmailType='SMTP'; SenderName='Sender'; Subject='Outlook import'; SentOn=[datetime]'2010-01-02T03:04:05Z'; EntryID='original-entry'; HTMLBody='<p>Complete body</p><img src="cid:image@example.test">'; Body='Complete body'; UnRead=$true; FlagStatus=2; Recipients=[pscustomobject]@{Count=0}; Attachments=$attachments; PropertyAccessor=$property }
  $result=ExportMail $item 'Sent' 'sent' | ConvertFrom-Json
  if (!$result.unread -or !$result.starred -or $result.role -ne 'sent') { throw 'Incorrect source state' }
  $second=ExportMail $item 'Sent' 'sent' | ConvertFrom-Json
  if ((Get-FileHash (Join-Path $OutputDirectory $result.file)).Hash -ne (Get-FileHash (Join-Path $OutputDirectory $second.file)).Hash) { throw 'Repeated exports must have identical bytes' }
  $env:MAILBRIDGE_TEST_EML=Join-Path $OutputDirectory $result.file
  python -c "import os,email; from email import policy; m=email.message_from_binary_file(open(os.environ['MAILBRIDGE_TEST_EML'],'rb'),policy=policy.default); assert m['Message-ID']=='<outlook-fixture@example.test>'; assert m['Subject']=='Outlook import'; assert m['Date'].datetime.year==2010; parts=list(m.iter_parts()); assert 'Complete body' in parts[0].get_content(); assert parts[1].get_payload(decode=True)==bytes([0,1,2,255]); assert parts[1].get_filename()=='report.bin'; assert parts[1]['Content-ID']=='<image@example.test>'"
  if ($LASTEXITCODE) { throw 'MIME validation failed' }
} finally { Remove-Item $OutputDirectory -Recurse -Force }
