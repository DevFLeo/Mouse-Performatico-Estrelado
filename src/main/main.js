const path = require('path');
const fs = require('fs');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  screen,
  dialog,
  clipboard,
  shell,
  nativeImage
} = require('electron');

const ConfigManager = require('./configManager');
const StartupManager = require('./startupManager');
const HookBridge = require('./hookBridge');
const ActionExecutor = require('./actionExecutor');

const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Otimizações de GPU e memória para máxima fluidez do motor 3D WebGL/Canvas
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const configManager = new ConfigManager(ROOT_DIR);
const startupManager = new StartupManager(ROOT_DIR);
const hookBridge = new HookBridge(ROOT_DIR);
const actionExecutor = new ActionExecutor(configManager, hookBridge);

// Garante instância única do M.P.E
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    summonHud({ playIntro: true, source: 'executable' });
  });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  const iconPath = path.join(ROOT_DIR, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true,
      backgroundThrottling: false
    }
  });

  // Carrega diretamente via protocolo de arquivo local (Zero localhost / Zero servidor web)
  const indexHtmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexHtmlPath);

  mainWindow.once('ready-to-show', () => {
    summonHud({ playIntro: true, source: 'startup' });
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function summonHud({ x, y, playIntro = false, source = 'shortcut' } = {}) {
  if (!mainWindow) return;

  const cursor = screen.getCursorScreenPoint();
  const targetX = typeof x === 'number' ? x : cursor.x;
  const targetY = typeof y === 'number' ? y : cursor.y;

  const currentDisplay = screen.getDisplayNearestPoint({ x: targetX, y: targetY });
  mainWindow.setBounds(currentDisplay.bounds);

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.webContents.send('mpe:hud-summoned', {
    x: targetX - currentDisplay.bounds.x,
    y: targetY - currentDisplay.bounds.y,
    playIntro,
    source,
    config: configManager.get()
  });
}

function createSystemTray() {
  const pngPath = path.join(ROOT_DIR, 'assets', 'icon.png');
  const icoPath = path.join(ROOT_DIR, 'assets', 'icon.ico');
  const iconFile = fs.existsSync(icoPath) ? icoPath : pngPath;

  let trayIcon = fs.existsSync(iconFile)
    ? nativeImage.createFromPath(iconFile)
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('M.P.E - Mouse Performático Estrelado (Shift+Ctrl+Alt+Botão Direito)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '✨ Abrir Astrolábio 3D (M.P.E)',
      click: () => summonHud({ playIntro: false, source: 'tray' })
    },
    {
      label: '🎬 Reproduzir Inicialização Cinematográfica',
      click: () => summonHud({ playIntro: true, source: 'tray-intro' })
    },
    { type: 'separator' },
    {
      label: '📁 Abrir Pasta de Capturas',
      click: () => {
        const cfg = configManager.get();
        const dir = configManager.resolvePath(
          (cfg.telegram && cfg.telegram.savedScreenshotsFolder) || './Capturas_MPE'
        );
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        shell.openPath(dir);
      }
    },
    { type: 'separator' },
    {
      label: '❌ Encerrar M.P.E Completamente',
      click: () => {
        isQuitting = true;
        hookBridge.stop();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      summonHud({ playIntro: false, source: 'tray-click' });
    }
  });
}

function setupHooksAndShortcuts() {
  // 1. Inicia o Hook Global Win32 (Shift + Ctrl + Alt + Botão Direito do Mouse)
  hookBridge.on('trigger', ({ x, y }) => {
    if (mainWindow && mainWindow.isVisible()) {
      // Se já estiver visível, reposiciona o centro ou alterna
      summonHud({ x, y, playIntro: false, source: 'mouse-hook' });
    } else {
      summonHud({ x, y, playIntro: false, source: 'mouse-hook' });
    }
  });
  hookBridge.start();

  // 2. Registra também um atalho de teclado complementar (Ctrl+Shift+Alt+M)
  const cfg = configManager.get();
  const fallbackKey =
    (cfg.system && cfg.system.fallbackKeyboardShortcut) || 'CommandOrControl+Shift+Alt+M';
  try {
    globalShortcut.register(fallbackKey, () => {
      summonHud({ playIntro: false, source: 'keyboard-shortcut' });
    });
  } catch (err) {
    console.warn('[M.P.E Shortcut] Atalho complementar não pôde ser registrado:', err.message);
  }
}

function setupIpcHandlers() {
  ipcMain.handle('mpe:get-config', async () => {
    const cfg = configManager.get();
    const isStartupEnabled = await startupManager.checkStartup();
    cfg.system.startWithWindows = isStartupEnabled;
    return cfg;
  });

  ipcMain.handle('mpe:save-config', async (_event, newConfig) => {
    if (newConfig && newConfig.system && typeof newConfig.system.startWithWindows === 'boolean') {
      await startupManager.setStartup(newConfig.system.startWithWindows);
    }
    const saved = configManager.save(newConfig);
    if (mainWindow) {
      mainWindow.webContents.send('mpe:config-updated', saved);
    }
    return saved;
  });

  ipcMain.handle('mpe:execute-point', async (_event, point) => {
    return await actionExecutor.executePoint(point, mainWindow);
  });

  ipcMain.handle('mpe:complete-area-crop', async (_event, payload) => {
    return await actionExecutor.completeAreaCrop(payload);
  });

  ipcMain.handle('mpe:send-text-telegram', async (_event, { text, target }) => {
    return await actionExecutor.dispatchToTelegram({
      textMessage: text,
      customTarget: target
    });
  });

  ipcMain.handle('mpe:copy-text', (_event, text) => {
    clipboard.writeText(text || '');
    return { ok: true };
  });

  ipcMain.handle('mpe:open-path', async (_event, targetPath) => {
    const resolved = configManager.resolvePath(targetPath);
    await shell.openPath(resolved);
    return { ok: true, path: resolved };
  });

  ipcMain.handle('mpe:select-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Pasta de Destino (M.P.E)',
      properties: ['openDirectory', 'createDirectory']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('mpe:select-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo ou Executável (M.P.E)',
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  ipcMain.handle('mpe:hide-hud', () => {
    if (mainWindow) {
      mainWindow.hide();
    }
    return { ok: true };
  });

  ipcMain.handle('mpe:quit-app', () => {
    isQuitting = true;
    hookBridge.stop();
    app.quit();
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  const cfg = configManager.load();
  if (cfg.system && cfg.system.startWithWindows) {
    await startupManager.setStartup(true);
  }

  setupIpcHandlers();
  createWindow();
  createSystemTray();
  setupHooksAndShortcuts();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hookBridge.stop();
});
