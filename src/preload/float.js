// Pont de la mini-fenêtre flottante (superposition).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pouleyFloat', {
  cmd: (name, arg) => ipcRenderer.invoke('float:cmd', name, arg),
  onInfo: (fn) => ipcRenderer.on('info', (_e, info) => fn(info)),
});
