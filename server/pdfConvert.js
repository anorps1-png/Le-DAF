// Conversion xlsx -> pdf fidèle au fichier Excel d'origine (mise en page, fusions, bordures,
// zones d'impression), via automatisation COM de Microsoft Excel (moteur principal — installé
// sur la quasi-totalité des postes comptables), avec LibreOffice headless en repli si Excel
// n'est pas disponible. Aucune bibliothèque JS pure ne sait « imprimer » un classeur Excel
// complexe comme le formulaire officiel DGI — on délègue donc le rendu à un vrai moteur de
// tableur plutôt que de réinventer un moteur de mise en page.
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXCEL_TO_PDF_SCRIPT = path.join(__dirname, 'scripts', 'excel-to-pdf.ps1');

function convertViaExcelCom(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', EXCEL_TO_PDF_SCRIPT, '-InputPath', inputPath, '-OutputPath', outputPath
    ], { timeout: 120000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error((stderr && stderr.trim()) || err.message));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error("Excel n'a produit aucun fichier PDF."));
        return;
      }
      resolve();
    });
  });
}

function resolveSofficePath() {
  const candidates = [];
  if (process.env.SOFFICE_PATH) candidates.push(process.env.SOFFICE_PATH);
  // Build packagé (Electron) : LibreOffice portable embarqué dans les ressources de l'app.
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'libreoffice', 'program', 'soffice.exe'));
  }
  // Poste de dev : copie portable placée manuellement (non versionnée, voir .gitignore).
  candidates.push(path.join(__dirname, '..', 'packaging', 'libreoffice-portable', 'App', 'libreoffice', 'program', 'soffice.exe'));
  candidates.push(path.join(__dirname, '..', 'packaging', 'libreoffice-portable', 'program', 'soffice.exe'));
  // Installations standard de LibreOffice (Windows).
  candidates.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
  candidates.push('C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe');
  candidates.push('C:\\Program Files\\LibreOfficePortable\\App\\libreoffice\\program\\soffice.exe');
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function convertViaLibreOffice(inputPath, workDir, outputPath) {
  return new Promise((resolve, reject) => {
    const sofficePath = resolveSofficePath();
    if (!sofficePath) {
      reject(new Error('LibreOffice introuvable sur cet ordinateur.'));
      return;
    }

    let profileDir;
    try {
      profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohada-lo-profile-'));
    } catch (e) {
      reject(new Error("Impossible de créer un dossier temporaire pour LibreOffice : " + e.message));
      return;
    }
    const cleanupProfile = () => { try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch (_) {} };

    // Profil utilisateur LibreOffice isolé et jetable : évite les conflits de verrou quand
    // plusieurs conversions tournent (ou se sont mal terminées) en parallèle.
    const profileUri = 'file:///' + profileDir.replace(/\\/g, '/').replace(/ /g, '%20');
    const args = [
      '--headless', '--norestore', '--invisible', '--nodefault', '--nolockcheck', '--nologo',
      `-env:UserInstallation=${profileUri}`,
      '--convert-to', 'pdf', '--outdir', workDir, inputPath
    ];

    execFile(sofficePath, args, { timeout: 90000 }, (err, stdout, stderr) => {
      cleanupProfile();
      if (err) {
        reject(new Error((stderr && stderr.trim()) || err.message));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error("La conversion LibreOffice n'a produit aucun fichier PDF."));
        return;
      }
      resolve();
    });
  });
}

async function convertXlsxBufferToPdf(buffer) {
  let workDir;
  try {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohada-dsf-'));
  } catch (e) {
    throw new Error("Impossible de créer un dossier temporaire pour la conversion PDF : " + e.message);
  }
  const cleanup = () => { try { fs.rmSync(workDir, { recursive: true, force: true }); } catch (_) {} };

  const inputPath = path.join(workDir, 'DSF.xlsx');
  const outputPath = path.join(workDir, 'DSF.pdf');
  try {
    fs.writeFileSync(inputPath, buffer);
  } catch (e) {
    cleanup();
    throw new Error("Impossible d'écrire le fichier Excel temporaire : " + e.message);
  }

  const errors = [];
  try {
    await convertViaExcelCom(inputPath, outputPath);
    const pdfBuffer = fs.readFileSync(outputPath);
    cleanup();
    return pdfBuffer;
  } catch (excelErr) {
    errors.push('Microsoft Excel : ' + excelErr.message);
  }

  try {
    await convertViaLibreOffice(inputPath, workDir, outputPath);
    const pdfBuffer = fs.readFileSync(outputPath);
    cleanup();
    return pdfBuffer;
  } catch (loErr) {
    errors.push('LibreOffice : ' + loErr.message);
  }

  cleanup();
  throw new Error(
    "Impossible de générer le PDF de la DSF : ni Microsoft Excel ni LibreOffice n'ont réussi à convertir le fichier.\n" +
    errors.join('\n') +
    "\nInstallez Microsoft Excel ou LibreOffice (gratuit — https://fr.libreoffice.org/telecharger/) puis réessayez."
  );
}

module.exports = { convertXlsxBufferToPdf, resolveSofficePath };
