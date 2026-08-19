; Installateur Windows pour Agent OHADA.
; Installe en per-utilisateur (aucun droit administrateur requis) dans %LOCALAPPDATA%,
; car le serveur Node local écrit sa base SQLite dans ce même dossier : un emplacement
; sous Program Files nécessiterait des droits admin et poserait des soucis d'écriture.
#define MyAppName "Agent OHADA (Le-DAF)"
#define MyAppVersion "2.0.2"
#define MyAppPublisher "Agent OHADA"

[Setup]
AppId={{8E3C9B1A-6F2D-4A7B-9C3E-2D5B7A1F9E44}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\AgentOHADA
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\installer-output
OutputBaseFilename=AgentOHADA-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\AgentOHADA.exe
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Files]
Source: "stage\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\AgentOHADA.exe"; WorkingDir: "{app}"
Name: "{group}\Désinstaller {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\AgentOHADA.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le Bureau"; GroupDescription: "Raccourcis supplémentaires :"

[Run]
Filename: "{app}\AgentOHADA.exe"; Description: "Lancer {#MyAppName} maintenant"; Flags: postinstall skipifsilent nowait

[UninstallDelete]
Type: files; Name: "{app}\server\agent-ohada.sqlite"
Type: filesandordirs; Name: "{app}\server\public\exports"
