const { execSync } = require('child_process');
const innosetup = require('innosetup');
const path = require('path');
const fs = require('fs');
const { version: APP_VERSION, productName: APP_NAME } = require('./package.json');

const is32Bit = process.argv.includes('--ia32') || process.argv.includes('--x86') || process.env.TARGET_ARCH === 'ia32';
const targetArch = is32Bit ? 'ia32' : 'x64';
const archLabel = is32Bit ? '32 bits (ia32)' : '64 bits (x64)';
const unpackedFolder = is32Bit ? 'win-ia32-unpacked' : 'win-unpacked';
const outputBaseFilename = is32Bit ? `AgentFinancier-Setup-v${APP_VERSION}-32bits` : `AgentFinancier-Setup-v${APP_VERSION}`;

const distElectronDir = path.resolve(__dirname, 'dist-electron');
const targetUnpackedDir = path.resolve(distElectronDir, unpackedFolder);

const skipPack = process.argv.includes('--skip-pack');

if (!skipPack) {
  if (fs.existsSync(targetUnpackedDir)) {
    try {
      fs.rmSync(targetUnpackedDir, { recursive: true, force: true });
    } catch (e) {
      console.warn(`[Installer Build] Info: ancien dossier ${unpackedFolder} nettoyé.`);
    }
  }


  // Configuration des miroirs CDN haute vitesse pour éviter les déconnexions GitHub
  process.env.ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/';
  process.env.ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/';

  console.log(`[Installer Build] Configuration cible : Architecture Windows ${archLabel}`);
  console.log(`[Installer Build] Étape 1/2 : Génération du dossier dépaqueté Electron (${targetArch})...`);
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  execSync(`${npxCmd} electron-builder --win dir --${targetArch}`, { stdio: 'inherit' });
} else {
  console.log(`[Installer Build] Étape 1/2 : Réutilisation du dossier dépaqueté (${unpackedFolder})...`);
}

console.log(`[Installer Build] Étape 2/2 : Compilation de l'installateur Windows (${outputBaseFilename}.exe via InnoSetup)...`);

const outputDir = path.resolve(__dirname, 'dist-electron');
const issPath = path.resolve(__dirname, 'dist-electron', is32Bit ? 'setup_script_ia32.iss' : 'setup_script.iss');

const issContent = `
[Setup]
AppName=${APP_NAME}
AppVersion=${APP_VERSION}
AppPublisher=${APP_NAME}
DefaultDirName={autopf}\\${APP_NAME}
DefaultGroupName=${APP_NAME}
OutputBaseFilename=${outputBaseFilename}
OutputDir=${outputDir}
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=${is32Bit ? 'x86 x64 arm64' : 'x64 arm64'}
${is32Bit ? '' : 'ArchitecturesInstallIn64BitMode=x64compatible'}

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "${targetUnpackedDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

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
  const setupExe = path.join(outputDir, outputBaseFilename + '.exe');
  console.log('----------------------------------------------------');
  console.log(`✅ INSTALLATEUR ${archLabel.toUpperCase()} GÉNÉRÉ AVEC SUCCÈS !`);
  console.log(` Fichier d'installation : ${setupExe}`);
  console.log('----------------------------------------------------');

  if (process.argv.includes('--run') || process.env.RUN_SETUP === 'true') {
    console.log(`[Installer Build] Lancement immédiat de l'installateur : ${setupExe}`);
    const { spawn } = require('child_process');
    spawn(setupExe, [], { detached: true, stdio: 'ignore' }).unref();
  }
});
