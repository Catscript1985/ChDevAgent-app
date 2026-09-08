const { app, BrowserWindow, dialog, ipcMain, shell, session, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let agentProcess;
let dataRoot;
let tray;
let allowQuit = false;

function agentPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'agent.mjs')
    : path.join(__dirname, '..', 'agent.mjs');
}

function spawnAgent(workspace) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '0.0.0.0',
    CHDEVAGENT_PORT: '8228',
    CHDEVAGENT_WORKSPACE: workspace,
    CHDEVAGENT_DATA_ROOT: dataRoot,
    NODE_ENV: 'production',
  };
  agentProcess = spawn(process.execPath, [agentPath()], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  agentProcess.stdout.on('data', data => mainWindow?.webContents.send('agent-log', String(data)));
  agentProcess.stderr.on('data', data => mainWindow?.webContents.send('agent-log', String(data)));
  agentProcess.on('exit', (code, signal) => mainWindow?.webContents.send('agent-exit', { code, signal }));
}

async function chooseDataRoot() {
  const saved = app.getPath('userData');
  const result = await dialog.showOpenDialog({
    title: 'Chọn nơi lưu dữ liệu ChDevAgent',
    message: 'Chọn một thư mục riêng để lưu workspace, lịch sử và nhật ký. Bạn có thể đổi lại trong Cài đặt.',
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: saved,
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const root = result.filePaths[0];
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(path.join(root, 'workspace'), { recursive: true });
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  return root;
}

function createTray() { tray = new Tray(path.join(__dirname, 'renderer', 'logo.png')); tray.setToolTip('ChDevAgent — PC Agent đang chạy'); tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Mở giao diện', click: () => { mainWindow?.show(); mainWindow?.focus(); } }, { type: 'separator' }, { label: 'Dừng Agent', click: () => { if (agentProcess) agentProcess.kill(); mainWindow?.webContents.send('agent-exit', { code: 0, signal: 'tray-stop' }); } }, { label: 'Thoát ChDevAgent', click: () => { allowQuit = true; app.quit(); } }])); tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); }); }

async function createWindow() {
  dataRoot = app.getPath('userData');
  const settingsPath = path.join(dataRoot, 'desktop-settings.json');
  let settings = {};
  try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch {}
  if (!settings.dataRoot || !fs.existsSync(settings.dataRoot)) {
    const selected = await chooseDataRoot();
    if (!selected) app.quit();
    dataRoot = selected;
    fs.writeFileSync(settingsPath, JSON.stringify({ dataRoot }, null, 2));
  } else dataRoot = settings.dataRoot;

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1040,
    minHeight: 700,
    backgroundColor: '#071018',
    title: 'ChDevAgent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.on('close', (event) => { if (!allowQuit) { event.preventDefault(); mainWindow.hide(); } });
  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.send('desktop-config', { dataRoot, workspace: path.join(dataRoot, 'workspace') });
  spawnAgent(path.join(dataRoot, 'workspace'));
}

ipcMain.handle('choose-data-root', async () => {
  const selected = await chooseDataRoot();
  if (!selected) return null;
  dataRoot = selected;
  fs.writeFileSync(path.join(app.getPath('userData'), 'desktop-settings.json'), JSON.stringify({ dataRoot }, null, 2));
  if (agentProcess) agentProcess.kill();
  spawnAgent(path.join(dataRoot, 'workspace'));
  return { dataRoot, workspace: path.join(dataRoot, 'workspace') };
});
ipcMain.handle('open-data-root', () => shell.openPath(dataRoot));
ipcMain.handle('get-desktop-config', () => ({ dataRoot, workspace: path.join(dataRoot, 'workspace') }));

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await createWindow();
  createTray();
});
app.on('window-all-closed', () => { if (allowQuit && agentProcess) agentProcess.kill(); if (process.platform !== 'darwin' && allowQuit) app.quit(); });
app.on('before-quit', () => { allowQuit = true; if (agentProcess) agentProcess.kill(); if (tray) tray.destroy(); });
