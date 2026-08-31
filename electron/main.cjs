const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Le serveur Express (server/index.js) est chargé via require() directement dans ce processus
// principal (voir startBackendServer ci-dessous), donc il tourne sur le même tas V8 qu'Electron.
// La limite par défaut (~2,2 Go sur une machine à mémoire modeste) est trop juste pour un import
// comptable de plusieurs centaines de milliers à ~1,5M de lignes (fichier Excel entier tenu en
// mémoire, plusieurs copies du tableau de lignes le temps du traitement). Doit être fait AVANT
// app.whenReady().
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

let mainWindow = null;
const PORT = process.env.PORT || 3003;

// Définir les variables d'environnement pour le backend et SQLite
const userDataPath = app.getPath('userData');
process.env.USER_DATA_PATH = userDataPath;

// --- Fichier comptable actif (multi-dossiers, à la Sage Saari) ---
// Un même fichier .sqlite = un dossier comptable d'entreprise. Le chemin du fichier ACTIF est
// mémorisé dans un petit fichier de config séparé (impossible de stocker "quel fichier ouvrir"
// DANS le fichier qu'on doit justement d'abord localiser), lui-même dans userData — cet
// emplacement ne change jamais, contrairement au fichier comptable qu'il désigne.
const activeDbConfigPath = path.join(userDataPath, 'active-db-config.json');
const defaultDbPath = path.join(userDataPath, 'agent-ohada.sqlite');

function readActiveDbPath() {
  try {
    const parsed = JSON.parse(fs.readFileSync(activeDbConfigPath, 'utf-8'));
    if (parsed && typeof parsed.dbPath === 'string' && parsed.dbPath.trim()) {
      // Le fichier lui-même peut ne pas encore exister (cas "Nouveau fichier comptable" : sqlite3
      // le crée à la première connexion) — seul le dossier parent doit être valide.
      if (fs.existsSync(path.dirname(parsed.dbPath))) return parsed.dbPath;
    }
  } catch (e) {
    // Pas de config existante (premier lancement, ou "Ouvrir"/"Nouveau" jamais utilisé) : on
    // retombe sur le fichier par défaut, comportement inchangé.
  }
  return null;
}

function writeActiveDbPath(dbPath) {
  fs.writeFileSync(activeDbConfigPath, JSON.stringify({ dbPath }, null, 2), 'utf-8');
}

process.env.DB_PATH = readActiveDbPath() || defaultDbPath;
process.env.IS_ELECTRON = 'true';
process.env.PORT = String(PORT);

// Démarrer le serveur Express d'arrière-plan
function startBackendServer() {
  try {
    const expressApp = require('../server/index.js');
    console.log('[Electron] Serveur Express démarré sur le port', PORT);
    console.log('[Electron] Base de données SQLite :', process.env.DB_PATH);
  } catch (err) {
    console.error('[Electron] Erreur démarrage serveur Express:', err);
  }
}

// Vérifier que le serveur est prêt à répondre
function waitForServer(port, timeout = 10000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://localhost:${port}/api/sync/status`, (res) => {
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeout) {
          // Si le timeout expire, on tente quand même d'ouvrir
          resolve();
        } else {
          setTimeout(check, 250);
        }
      });
    };
    check();
  });
}

// Bascule vers un autre fichier comptable : mémorise le choix puis redémarre l'application
// entière plutôt que de rouvrir la connexion SQLite à chaud. Un redémarrage complet garantit
// qu'aucun état/cache de l'ancien dossier (côté serveur ou côté interface) ne survit au
// changement — plus sûr qu'une reconnexion dynamique pour un changement aussi peu fréquent.
async function switchDatabaseFile(newPath) {
  const confirmed = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Annuler', 'Redémarrer'],
    defaultId: 1,
    cancelId: 0,
    title: 'Changer de fichier comptable',
    message: `L'application va redémarrer sur ce fichier comptable :\n${newPath}`
  });
  if (confirmed.response !== 1) return;
  writeActiveDbPath(newPath);
  app.relaunch();
  app.exit(0);
}

// Extraites du menu "Fichier" pour être réutilisables aussi depuis les Paramètres (renderer, via
// IPC) : la carte "Dossier Comptable Actif" de SettingsModule.jsx doit proposer les mêmes actions
// que le menu natif plutôt que de dupliquer le flux web (upload HTTP), qui n'a pas de sens ici.
async function showOpenDbDialog() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Ouvrir un fichier comptable',
    defaultPath: path.dirname(process.env.DB_PATH),
    properties: ['openFile'],
    filters: [
      { name: 'Base comptable (.sqlite)', extensions: ['sqlite', 'db'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ]
  });
  if (result.canceled || result.filePaths.length === 0) return;
  await switchDatabaseFile(result.filePaths[0]);
}

async function showNewDbDialog() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Créer un nouveau fichier comptable',
    defaultPath: path.join(path.dirname(process.env.DB_PATH), 'Nouvelle entreprise.sqlite'),
    filters: [{ name: 'Base comptable (.sqlite)', extensions: ['sqlite'] }]
  });
  if (result.canceled || !result.filePath) return;
  await switchDatabaseFile(result.filePath);
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: `Agent OHADA (Le-DAF) — ${path.basename(process.env.DB_PATH, '.sqlite')}`,
    show: false,
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });

  // Ouvrir les liens externes dans le navigateur par défaut de l'utilisateur
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  // Afficher la fenêtre dès qu'elle est prête
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Attendre le serveur Express avant de charger l'URL
  await waitForServer(PORT);
  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Menu d'application minimal et moderne
  const menuTemplate = [
    {
      label: 'Fichier',
      submenu: [
        {
          label: 'Ouvrir un fichier comptable...',
          accelerator: 'CmdOrCtrl+O',
          click: () => showOpenDbDialog()
        },
        {
          label: 'Nouveau fichier comptable...',
          accelerator: 'CmdOrCtrl+N',
          click: () => showNewDbDialog()
        },
        { type: 'separator' },
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => mainWindow.reload() },
        { label: 'Plein écran', accelerator: 'F11', click: () => mainWindow.setFullScreen(!mainWindow.isFullScreen()) },
        { type: 'separator' },
        { label: 'Quitter', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Zoom +', accelerator: 'CmdOrCtrl+Plus', role: 'zoomIn' },
        { label: 'Zoom -', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: 'Réinitialiser le zoom', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' }
      ]
    },
    {
      label: 'Outils',
      submenu: [
        { label: 'Outils de développement', accelerator: 'F12', click: () => mainWindow.webContents.toggleDevTools() }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Instance unique de l'application (empêche d'ouvrir deux fois l'appli)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    ipcMain.handle('get-app-version', () => app.getVersion());
    ipcMain.handle('get-user-data-path', () => userDataPath);
    ipcMain.handle('db:open-dialog', () => showOpenDbDialog());
    ipcMain.handle('db:new-dialog', () => showNewDbDialog());
    ipcMain.handle('db:switch-to', (event, targetPath) => switchDatabaseFile(targetPath));

    startBackendServer();
    await createWindow();

    app.on('activate', async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createWindow();
      }
    });
  });
}

// Arrêt propre lors de la fermeture
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  // Arrêter proprement les connexions d'arrière-plan
  process.exit(0);
});
