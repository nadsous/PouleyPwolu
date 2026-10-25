// Pont minimal entre l'interface et le processus principal.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'state', 'shortcut', 'privacy:alert', 'permission:ask', 'permission:done', 'find:result',
  'download', 'toast', 'fullscreen', 'peek:inside', 'cluck', 'shot:done', 'group:created', 'media', 'favpeek', 'update',
  'vault', 'vault:open', 'vault:offer', 'vault:offer-done', 'aidetect', 'settings:open', 'engine',
]);

contextBridge.exposeInMainWorld('pouley', {
  getState: () => ipcRenderer.invoke('ui:state'),
  cmd: (name, arg) => ipcRenderer.invoke('cmd', name, arg),
  setLayout: (layout) => ipcRenderer.send('layout', layout),
  on: (channel, fn) => {
    if (!EVENTS.has(channel)) throw new Error('canal inconnu : ' + channel);
    const handler = (_e, payload) => fn(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
