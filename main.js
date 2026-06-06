const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const api = require('./src/api');
const storage = require('./src/storage');
const calc = require('./src/calc');

if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  app.setPath('userData', path.join(process.env.LOCALAPPDATA, 'MoyenneEDdesktop'));
}

const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 880,
    minHeight: 560,
    backgroundColor: '#f5f7fb',
    title: 'MoyenneED Desktop',
    icon: ICON_PATH,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile('index.html');

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.minec.moyenneed');
  }
  storage.init(app);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('auth:login', async (_e, { username, password, fa }) => {
  return api.login(username, password, fa);
});

ipcMain.handle('auth:qcm-get', async (_e, { token }) => {
  return api.getQcm(token);
});

ipcMain.handle('auth:qcm-answer', async (_e, { token, answer }) => {
  return api.answerQcm(token, answer);
});

ipcMain.handle('notes:fetch', async (_e, { token, eleveId }) => {
  return api.getNotes(token, eleveId);
});

ipcMain.handle(
  'calc:periods',
  async (_e, { notesPayload, excludedCodes, overrides, simulated }) => {
    return calc.computeAllPeriods(
      notesPayload,
      excludedCodes || [],
      overrides || {},
      simulated || {}
    );
  }
);

ipcMain.handle('storage:save', async (_e, payload) => {
  return storage.save(payload);
});

ipcMain.handle('storage:load', async () => {
  return storage.load();
});

ipcMain.handle('storage:clear', async () => {
  return storage.clear();
});

ipcMain.handle('app:open-external', async (_e, { url }) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle('app:version', async () => app.getVersion());
