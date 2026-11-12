const { contextBridge, ipcRenderer } = require('electron');

/**
 * Ponte Segura de Contexto (Preload)
 * Conecta a interface gráfica 3D diretamente ao núcleo nativo do Windows via IPC,
 * eliminando 100% a necessidade de servidor HTTP ou localhost.
 */
contextBridge.exposeInMainWorld('mpeApi', {
  getConfig: () => ipcRenderer.invoke('mpe:get-config'),
  saveConfig: (newConfig) => ipcRenderer.invoke('mpe:save-config', newConfig),
  executePoint: (point) => ipcRenderer.invoke('mpe:execute-point', point),
  completeAreaCrop: (payload) => ipcRenderer.invoke('mpe:complete-area-crop', payload),
  sendTextToTelegram: (payload) => ipcRenderer.invoke('mpe:send-text-telegram', payload),
  copyToClipboard: (text) => ipcRenderer.invoke('mpe:copy-text', text),
  openExternalPath: (targetPath) => ipcRenderer.invoke('mpe:open-path', targetPath),
  selectFolder: () => ipcRenderer.invoke('mpe:select-folder'),
  selectFile: () => ipcRenderer.invoke('mpe:select-file'),
  hideHud: () => ipcRenderer.invoke('mpe:hide-hud'),
  quitApp: () => ipcRenderer.invoke('mpe:quit-app'),

  onHudSummoned: (callback) => {
    ipcRenderer.on('mpe:hud-summoned', (_event, data) => callback(data));
  },
  onConfigUpdated: (callback) => {
    ipcRenderer.on('mpe:config-updated', (_event, data) => callback(data));
  }
});
