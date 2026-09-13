const { execSync } = require('child_process');
const innosetup = require('innosetup');
const path = require('path');
const fs = require('fs');
const { version: APP_VERSION, productName: APP_NAME } = require('./package.json');

console.log('[Installer Build] Étape 1/2 : Génération du dossier dépaqueté Electron...');
execSync('npx electron-builder --win dir', { stdio: 'inherit' });

console.log('[Installer Build] Étape 2/2 : Compilation de l\'installateur Windows (Setup EXE via InnoSetup)...');

const winUnpackedDir = path.resolve(__dirname, 'dist-electron', 'win-unpacked');
const outputDir = path.resolve(__dirname, 'dist-electron');
const issPath = path.resolve(__dirname, 'dist-electron', 'setup_script.iss');

const issContent = `
[Setup]
AppName=${APP_NAME}
AppVersion=${APP_VERSION}
AppPublisher=${APP_NAME}
DefaultDirName={autopf}\\${APP_NAME}
DefaultGroupName=${APP_NAME}
OutputBaseFilename=AgentFinancier-Setup-v${APP_VERSION}
OutputDir=${outputDir}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "${winUnpackedDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\${APP_NAME}"; Filename: "{app}\\${APP_NAME}.exe"
Name: "{autodesktop}\\${APP_NAME}"; Filename: "{app}\\${APP_NAME}.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\\${APP_NAME}.exe"; Description: "{cm:LaunchProgram,${APP_NAME}}"; Flags: nowait postinstall skipifsilent
`;

fs.writeFileSync(issPath, issContent, 'utf8');

innosetup(issPath, { verbose: true }, (err) => {
  if (err) {
    console.error('[Installer Build] Erreur compilation InnoSetup:', err);
    process.exit(1);
  }
  console.log('----------------------------------------------------');
  console.log('✅ INSTALLATEUR GÉNÉRÉ AVEC SUCCÈS !');
  console.log(` Fichier d'installation : ${path.join(outputDir, 'AgentFinancier-Setup-v' + APP_VERSION + '.exe')}`);
  console.log('----------------------------------------------------');
});
