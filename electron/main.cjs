const { app, BrowserWindow, Menu, shell, dialog, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

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
process.env.DB_PATH = path.join(userDataPath, 'agent-ohada.sqlite');
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

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: 'Agent OHADA (Le-DAF) — Pilotage Financier & Comptabilité OHADA',
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
