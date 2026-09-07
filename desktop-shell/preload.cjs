const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chdevagentDesktop', {
  getConfig: () => ipcRenderer.invoke('get-desktop-config'),
  chooseDataRoot: () => ipcRenderer.invoke('choose-data-root'),
  openDataRoot: () => ipcRenderer.invoke('open-data-root'),
  onConfig: (callback) => ipcRenderer.on('desktop-config', (_event, value) => callback(value)),
  onAgentLog: (callback) => ipcRenderer.on('agent-log', (_event, value) => callback(value)),
  onAgentExit: (callback) => ipcRenderer.on('agent-exit', (_event, value) => callback(value)),
});
