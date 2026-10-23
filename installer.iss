[Setup]
AppName=Media Extractor
AppVersion=1.0
DefaultDirName={autopf}\Media Extractor
DefaultGroupName=Media Extractor
OutputDir=Output
OutputBaseFilename=MediaExtractor_Setup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
; This gives your Setup.exe the same custom icon
SetupIconFile=icon.ico

[Files]
; Copy the main executable
Source: "dist\MediaExtractor\MediaExtractor.exe"; DestDir: "{app}"; Flags: ignoreversion
; Copy everything else in the PyInstaller output folder (including _internal, ffmpeg, etc.)
Source: "dist\MediaExtractor\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Create a Start Menu shortcut
Name: "{group}\Media Extractor"; Filename: "{app}\MediaExtractor.exe"
; Create a Desktop shortcut
Name: "{autodesktop}\Media Extractor"; Filename: "{app}\MediaExtractor.exe"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Run]
; Launch the app after installation finishes
Filename: "{app}\MediaExtractor.exe"; Description: "{cm:LaunchProgram,Media Extractor}"; Flags: nowait postinstall skipifsilent