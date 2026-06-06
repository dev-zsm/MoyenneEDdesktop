const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ed', {
  login: (username, password, fa) =>
    ipcRenderer.invoke('auth:login', { username, password, fa }),
  qcmGet: (token) => ipcRenderer.invoke('auth:qcm-get', { token }),
  qcmAnswer: (token, answer) =>
    ipcRenderer.invoke('auth:qcm-answer', { token, answer }),
  fetchNotes: (token, eleveId) =>
    ipcRenderer.invoke('notes:fetch', { token, eleveId }),
  computePeriods: (notesPayload, excludedCodes, overrides, simulated) =>
    ipcRenderer.invoke('calc:periods', {
      notesPayload,
      excludedCodes,
      overrides,
      simulated,
    }),
});

contextBridge.exposeInMainWorld('store', {
  save: (payload) => ipcRenderer.invoke('storage:save', payload),
  load: () => ipcRenderer.invoke('storage:load'),
  clear: () => ipcRenderer.invoke('storage:clear'),
});

contextBridge.exposeInMainWorld('app', {
  openExternal: (url) => ipcRenderer.invoke('app:open-external', { url }),
  version: () => ipcRenderer.invoke('app:version'),
});
