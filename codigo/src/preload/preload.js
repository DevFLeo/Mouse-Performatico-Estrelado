const { contextBridge, ipcRenderer, webUtils } = require('electron');

/**
 * Ponte Segura de Contexto (Preload)
 * Conecta a interface grafica 3D diretamente ao nucleo nativo do Windows via IPC,
 * eliminando 100% a necessidade de servidor HTTP ou localhost.
 */
contextBridge.exposeInMainWorld('mpeApi', {
  getConfig: () => ipcRenderer.invoke('mpe:get-config'),
  saveConfig: (newConfig) => ipcRenderer.invoke('mpe:save-config', newConfig),
  executePoint: (point) => ipcRenderer.invoke('mpe:execute-point', point),
  completeAreaCrop: (payload) => ipcRenderer.invoke('mpe:complete-area-crop', payload),
  saveNamedPrint: (payload) => ipcRenderer.invoke('mpe:save-named-print', payload),
  sendTextToTelegram: (payload) => ipcRenderer.invoke('mpe:send-text-telegram', payload),
  sendToTargetSystem: (payload) => ipcRenderer.invoke('mpe:send-to-system', payload),
  listOpenWindows: () => ipcRenderer.invoke('mpe:list-open-windows'),
  copyToClipboard: (text) => ipcRenderer.invoke('mpe:copy-text', text),
  openExternalPath: (targetPath) => ipcRenderer.invoke('mpe:open-path', targetPath),
  selectFolder: () => ipcRenderer.invoke('mpe:select-folder'),
  selectFile: () => ipcRenderer.invoke('mpe:select-file'),
  hideHud: () => ipcRenderer.invoke('mpe:hide-hud'),
  quitApp: () => ipcRenderer.invoke('mpe:quit-app'),
  ensureShortcuts: () => ipcRenderer.invoke('mpe:ensure-shortcuts'),

  onHudSummoned: (callback) => {
    ipcRenderer.on('mpe:hud-summoned', (_event, data) => callback(data));
  },
  onConfigUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mpe:config-updated', listener);
    return () => ipcRenderer.removeListener('mpe:config-updated', listener);
  },
  onEscapePressed: (callback) => {
    ipcRenderer.on('mpe:escape-pressed', () => callback());
  },

  // Config & Slot Sync
  reorderPoint: (fromIndex, toIndex) => {
    const payload =
      fromIndex && typeof fromIndex === 'object'
        ? { fromIndex: fromIndex.fromIndex, toIndex: fromIndex.toIndex }
        : { fromIndex, toIndex };
    return ipcRenderer.invoke('mpe:reorder-point', payload);
  },

  // Consentimento de Primeiro Acesso (ConsentManager)
  getConsentStatus: () => ipcRenderer.invoke('mpe:get-consent'),
  setConsentDecision: (accepted, permissions) =>
    ipcRenderer.invoke('mpe:set-consent', { accepted, permissions }),
  onConsentUpdated: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mpe:consent-updated', listener);
    return () => ipcRenderer.removeListener('mpe:consent-updated', listener);
  },

  // Mini Astrolabio (MiniAstrolabeManager)
  toggleMiniAstrolabe: (enabled) => ipcRenderer.invoke('mpe:mini-toggle', { enabled }),
  getMiniAstrolabeState: () => ipcRenderer.invoke('mpe:mini-get-state'),
  isMainWindowVisible: () => ipcRenderer.invoke('mpe:main-window-visible'),
  updateMiniAstrolabeLayout: (payload) =>
    ipcRenderer.invoke('mpe:mini-update-layout', payload || {}),
  setMiniIgnoreMouse: (ignore, forward) =>
    ipcRenderer.send('mpe:mini-ignore-mouse', { ignore, forward }),
  setMiniExpandedBounds: (expanded) =>
    ipcRenderer.invoke('mpe:mini-set-expanded', { expanded }),
  onMiniStateChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mpe:mini-state-changed', listener);
    return () => ipcRenderer.removeListener('mpe:mini-state-changed', listener);
  },

  // Auto-Script Python (PythonRecorder & PythonScheduler)
  startPythonRecording: (options) =>
    ipcRenderer.invoke('mpe:py-record-start', options || {}),
  stopPythonRecording: (options) =>
    ipcRenderer.invoke('mpe:py-record-stop', options || {}),
  savePythonScript: (payload) =>
    ipcRenderer.invoke('mpe:py-save-script', payload || {}),
  runPythonScript: (scriptIdOrPath, options) => {
    const payload =
      scriptIdOrPath && typeof scriptIdOrPath === 'object'
        ? Object.assign({}, scriptIdOrPath)
        : Object.assign({}, options || {}, { scriptIdOrPath });
    return ipcRenderer.invoke('mpe:py-run-script', payload);
  },
  schedulePythonScript: (scriptId, schedule) =>
    ipcRenderer.invoke('mpe:py-schedule-script', { scriptId, schedule }),
  deletePythonScript: (scriptId) =>
    ipcRenderer.invoke('mpe:py-delete-script', { scriptId }),
  onPythonRecordingState: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mpe:py-recording-state', listener);
    return () => ipcRenderer.removeListener('mpe:py-recording-state', listener);
  },
  onPythonScriptExecuted: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('mpe:py-script-executed', listener);
    return () => ipcRenderer.removeListener('mpe:py-script-executed', listener);
  },

  // Organizador de Arquivos & Prints (Estilo Arquithon)
  orgSelectFiles: () => ipcRenderer.invoke('mpe:org-select-files'),
  orgSelectFolder: () => ipcRenderer.invoke('mpe:org-select-folder'),
  orgOrganize: (payload) => ipcRenderer.invoke('mpe:org-organize', payload),
  orgRevert: () => ipcRenderer.invoke('mpe:org-revert'),
  orgUndoInfo: () => ipcRenderer.invoke('mpe:org-undo-info'),
  orgScan: (payload) => ipcRenderer.invoke('mpe:org-scan', payload || {}),
  orgSearch: (payload) => ipcRenderer.invoke('mpe:org-search', payload || {}),
  orgDeleteFile: (payload) => ipcRenderer.invoke('mpe:org-delete-file', payload || {}),
  orgOpenExplorer: (payload) => ipcRenderer.invoke('mpe:org-open-explorer', payload || {}),
  orgOpenFile: (payload) => ipcRenderer.invoke('mpe:org-open-file', payload || {}),
  getDroppedFilePath: (file) => {
    try {
      return webUtils && typeof webUtils.getPathForFile === 'function' ? webUtils.getPathForFile(file) : file.path || '';
    } catch (_) {
      return (file && file.path) || '';
    }
  },
  onOrgProgress: (callback) => {
    ipcRenderer.on('mpe:org-progress', (_event, data) => callback(data));
  }
});
