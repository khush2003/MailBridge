#ifndef AppVersion
#define AppVersion "0.1.0"
#endif
#ifndef BuildDirectory
#define BuildDirectory "..\..\dist\MailBridge-win32-x64"
#endif
[Setup]
AppId={{924D63BC-963E-4EE4-BFF4-FF79B9B15590}
AppName=MailBridge
AppVersion={#AppVersion}
AppPublisher=MailBridge contributors
AppPublisherURL=https://github.com/khush2003/MailBridge
DefaultDirName={localappdata}\Programs\MailBridge
DefaultGroupName=MailBridge
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\mailbridge-installer
OutputBaseFilename=MailBridge-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\MailBridge.exe
LicenseFile=..\..\..\LICENSE.md
[Files]
Source: "{#BuildDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\MailBridge"; Filename: "{app}\MailBridge.exe"
Name: "{autodesktop}\MailBridge"; Filename: "{app}\MailBridge.exe"; Tasks: desktopicon
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\MailBridge.exe"; Description: "Open MailBridge"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{app}\MailBridge.exe"; Parameters: "--mailbridge-disable-startup"; Flags: runhidden waituntilterminated skipifdoesntexist
