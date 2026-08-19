const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const cacheDir = path.join(process.env.LOCALAPPDATA, 'electron', 'Cache');
let zipPath = '';

if (fs.existsSync(cacheDir)) {
  const entries = fs.readdirSync(cacheDir);
  for (const entry of entries) {
    const sub = path.join(cacheDir, entry);
    if (fs.statSync(sub).isDirectory()) {
      const files = fs.readdirSync(sub);
      const zip = files.find(f => f.endsWith('.zip'));
      if (zip) {
        zipPath = path.join(sub, zip);
        break;
      }
    }
  }
}

if (!zipPath || !fs.existsSync(zipPath)) {
  console.error('Archive Electron non trouvée dans le cache local.');
  process.exit(1);
}

const destDir = path.resolve(__dirname, '..', 'node_modules', 'electron', 'dist');
fs.mkdirSync(destDir, { recursive: true });

console.log('Extraction de :', zipPath);
console.log('Vers :', destDir);

execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: 'inherit' });

// Écrire path.txt pour electron package
const pathTxt = path.resolve(__dirname, '..', 'node_modules', 'electron', 'path.txt');
fs.writeFileSync(pathTxt, 'electron.exe');

console.log('Electron extrait et configuré avec succès !');
