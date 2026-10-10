#ifndef AppVersion
#define AppVersion "0.1.3"
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
SetupIconFile=..\resources\win\mailbridge.ico
UninstallDisplayIcon={app}\MailBridge.exe
LicenseFile=..\..\..\LICENSE.md
[Files]
Source: "{#BuildDirectory}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\MailBridge"; Filename: "{app}\MailBridge.exe"; AppUserModelID: "io.github.khush2003.mailbridge"
Name: "{autodesktop}\MailBridge"; Filename: "{app}\MailBridge.exe"; Tasks: desktopicon; AppUserModelID: "io.github.khush2003.mailbridge"
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked
[Run]
Filename: "{app}\MailBridge.exe"; Description: "Open MailBridge"; Flags: nowait postinstall skipifsilent
[UninstallRun]
Filename: "{app}\MailBridge.exe"; Parameters: "--mailbridge-disable-startup"; Flags: runhidden waituntilterminated skipifdoesntexist
[Registry]
Root: HKCU; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "MailBridge"; ValueData: "Software\MailBridge\Capabilities"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\MailBridge\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "MailBridge"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\MailBridge\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Mail with a permanent local archive and encrypted sync"
Root: HKCU; Subkey: "Software\MailBridge\Capabilities\URLAssociations"; ValueType: string; ValueName: "mailto"; ValueData: "MailBridge.Mailto"
Root: HKCU; Subkey: "Software\Classes\MailBridge.Mailto"; ValueType: string; ValueName: ""; ValueData: "MailBridge Mail URL"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\MailBridge.Mailto"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\MailBridge.Mailto\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\MailBridge.exe"",0"
Root: HKCU; Subkey: "Software\Classes\MailBridge.Mailto\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\MailBridge.exe"" ""%1"""
