const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow;
let agentProcess;
let dataRoot;

function agentPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), 'agent.mjs')
    : path.join(__dirname, '..', 'agent.mjs');
}

function spawnAgent(workspace) {
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    HOST: '127.0.0.1',
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

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  createWindow();
});
app.on('window-all-closed', () => { if (agentProcess) agentProcess.kill(); if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { if (agentProcess) agentProcess.kill(); });
