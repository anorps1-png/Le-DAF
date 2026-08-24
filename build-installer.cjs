const { execSync } = require('child_process');
const innosetup = require('innosetup');
const path = require('path');
const fs = require('fs');

console.log('[Installer Build] Étape 1/2 : Génération du dossier dépaqueté Electron...');
execSync('npx electron-builder --win dir', { stdio: 'inherit' });

console.log('[Installer Build] Étape 2/2 : Compilation de l\'installateur Windows (Setup EXE via InnoSetup)...');

const winUnpackedDir = path.resolve(__dirname, 'dist-electron', 'win-unpacked');
const outputDir = path.resolve(__dirname, 'dist-electron');
const issPath = path.resolve(__dirname, 'dist-electron', 'setup_script.iss');

const issContent = `
[Setup]
AppName=Agent OHADA (Le-DAF)
AppVersion=2.0.2
AppPublisher=Agent OHADA
DefaultDirName={autopf}\\Agent OHADA (Le-DAF)
DefaultGroupName=Agent OHADA (Le-DAF)
OutputBaseFilename=AgentOHADA-Setup-v2.0.2
OutputDir=${outputDir}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "${winUnpackedDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\Agent OHADA (Le-DAF)"; Filename: "{app}\\Agent OHADA (Le-DAF).exe"
Name: "{autodesktop}\\Agent OHADA (Le-DAF)"; Filename: "{app}\\Agent OHADA (Le-DAF).exe"; Tasks: desktopicon

[Run]
Filename: "{app}\\Agent OHADA (Le-DAF).exe"; Description: "{cm:LaunchProgram,Agent OHADA (Le-DAF)}"; Flags: nowait postinstall skipifsilent
`;

fs.writeFileSync(issPath, issContent, 'utf8');

innosetup(issPath, { verbose: true }, (err) => {
  if (err) {
    console.error('[Installer Build] Erreur compilation InnoSetup:', err);
    process.exit(1);
  }
  console.log('----------------------------------------------------');
  console.log('✅ INSTALLATEUR GÉNÉRÉ AVEC SUCCÈS !');
  console.log(` Fichier d'installation : ${path.join(outputDir, 'AgentOHADA-Setup-v2.0.2.exe')}`);
  console.log('----------------------------------------------------');
});
