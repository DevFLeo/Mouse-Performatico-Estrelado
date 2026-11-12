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
  selectDocumentFile: () => ipcRenderer.invoke('mpe:select-document-file'),
  hideHud: () => ipcRenderer.invoke('mpe:hide-hud'),
  quitApp: () => ipcRenderer.invoke('mpe:quit-app'),

  // I.A Local & Mini Assistente Flutuante (Lower Third Sci-Fi)
  reviewText: (payload) => ipcRenderer.invoke('mpe:ai-review', payload),
  draftText: (payload) => ipcRenderer.invoke('mpe:ai-draft', payload),
  classifyObsidian: (payload) => ipcRenderer.invoke('mpe:ai-classify-obsidian', payload),
  saveToObsidian: (payload) => ipcRenderer.invoke('mpe:save-to-obsidian', payload),
  saveDocumentFile: (payload) => ipcRenderer.invoke('mpe:ai-save-document', payload),
  listDocuments: (payload) => ipcRenderer.invoke('mpe:ai-list-documents', payload || {}),
  removeDocument: (payload) => ipcRenderer.invoke('mpe:ai-remove-document', payload || {}),
  aiChat: (payload) => ipcRenderer.invoke('mpe:ai-chat', payload),
  aiStatus: (payload) => ipcRenderer.invoke('mpe:ai-status', payload || {}),
  onAiChatChunk: (callback) => {
    ipcRenderer.on('mpe:ai-chat-chunk', (_event, data) => callback(data));
  },
  onAiChatStatus: (callback) => {
    ipcRenderer.on('mpe:ai-chat-status', (_event, data) => callback(data));
  },
  miniDragStart: () => ipcRenderer.send('mpe:mini-drag-start'),
  miniDragEnd: () => ipcRenderer.send('mpe:mini-drag-end'),
  miniResize: (size) => ipcRenderer.send('mpe:mini-resize', size),

  onHudSummoned: (callback) => {
    ipcRenderer.on('mpe:hud-summoned', (_event, data) => callback(data));
  },
  onMiniAssistantSummoned: (callback) => {
    ipcRenderer.on('mpe:mini-assistant-summoned', (_event, data) => callback(data));
  },
  onConfigUpdated: (callback) => {
    ipcRenderer.on('mpe:config-updated', (_event, data) => callback(data));
  },
  onEscapePressed: (callback) => {
    ipcRenderer.on('mpe:escape-pressed', () => callback());
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
