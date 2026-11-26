[Setup]
; Fixed: AppId keeps upgrades working (same ID = new installer updates the old install).
AppId={{288553C3-9D4A-4ED0-BD72-F21F876B6A98}
AppName=Beans Extractor
; Keep in step with APP_VERSION in app.py
AppVersion=1.0.0
AppPublisher=CoffeeUnderFlow
AppPublisherURL=https://coffeeunderflow.in/
DefaultDirName={autopf}\Beans Extractor
DefaultGroupName=Beans Extractor
OutputDir=Output
; Fixed: this line was broken ("OutputBaseFiBeansExtractor_Setup").
OutputBaseFilename=BeansExtractor_Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
SetupIconFile=icon.ico
; Shows the GPL on an info page (plain Next button; the GPL does not require clicking "accept").
; Use LicenseFile=LICENSE instead if you want an "I accept" page.
InfoBeforeFile=LICENSE

[Files]
Source: "dist\BeansExtractor\BeansExtractor.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "dist\BeansExtractor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Licence files, installed next to the app (the GPL asks for a copy to travel with it)
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "THIRD_PARTY_NOTICES.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "licenses\GPL-3.0.txt"; DestDir: "{app}\licenses"; Flags: ignoreversion

[Icons]
Name: "{group}\Beans Extractor"; Filename: "{app}\BeansExtractor.exe"
Name: "{autodesktop}\Beans Extractor"; Filename: "{app}\BeansExtractor.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
Filename: "{app}\BeansExtractor.exe"; Description: "{cm:LaunchProgram,Beans Extractor}"; Flags: nowait postinstall skipifsilent
