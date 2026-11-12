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

// Otimizacoes de GPU e memoria para maxima fluidez do motor 3D
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

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Quando o usuario clica novamente no icone executavel MPE.exe, abre no Modo Edicao Completo
    summonHud({ playIntro: true, mode: 'executable-editor', source: 'executable' });
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

  const indexHtmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexHtmlPath);

  mainWindow.webContents.once('did-finish-load', async () => {
    const isSilentStartup = process.argv.includes('--startup');
    if (!isSilentStartup) {
      // Ao abrir pelo executavel MPE.exe, inicia com Intro e Modo de Edicao habilitado
      summonHud({ playIntro: true, mode: 'executable-editor', source: 'startup' });
    }

    if (process.argv.includes('--self-test')) {
      try {
        const outDir = path.join(ROOT_DIR, 'Capturas_MPE');
        if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

        await new Promise((r) => setTimeout(r, 450));
        const imgInit = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_1_init.png'), imgInit.toPNG());

        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('modal-register').classList.add('hidden');
          document.getElementById('splash-phase-init').classList.add('hidden');
          document.getElementById('splash-phase-welcome').classList.remove('hidden');
          document.getElementById('splash-welcome-title').textContent = 'Bem-vindo, DevFLeo';
          document.getElementById('splash-welcome-sub').textContent = 'Sistema M.P.E sincronizado e pronto para integracao entre sistemas.';
        `);
        await new Promise((r) => setTimeout(r, 350));
        const imgWelcome = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_2_welcome.png'), imgWelcome.toPNG());

        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('splash-screen').classList.add('hidden');
          document.getElementById('modal-register').classList.add('hidden');
        `);
        await new Promise((r) => setTimeout(r, 900));
        const imgAstrolabe = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_3_astrolabe3d.png'), imgAstrolabe.toPNG());

        console.log('MPE_SELF_TEST_PASSED');
        isQuitting = true;
        hookBridge.stop();
        app.quit();
      } catch (err) {
        console.error('MPE_SELF_TEST_FAILED:', err);
        isQuitting = true;
        hookBridge.stop();
        app.exit(1);
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  // Garante em nivel nativo que a tecla ESC sempre minimize/oculte o HUD sem encerrar o projeto
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.webContents.send('mpe:escape-pressed');
    }
  });
}

function summonHud({ x, y, playIntro = false, mode = 'hud-only', source = 'shortcut' } = {}) {
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
    mode,
    source,
    originSystem: hookBridge.getOriginSystemInfo(),
    config: configManager.get()
  });
}

function createSystemTray() {
  const pngPath = path.join(ROOT_DIR, 'assets', 'icon.png');

  let trayIcon = fs.existsSync(pngPath)
    ? nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('M.P.E - Mouse Performatico Estrelado (Shift+Ctrl+Alt+Botao Direito)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Modo Edicao e Configuracao (MPE.exe)',
      click: () => summonHud({ playIntro: false, mode: 'executable-editor', source: 'tray-editor' })
    },
    {
      label: 'Abrir Circulo 3D Rapido (Modo Atalho)',
      click: () => summonHud({ playIntro: false, mode: 'hud-only', source: 'tray-hud' })
    },
    {
      label: 'Reproduzir Inicializacao Cinematografica',
      click: () => summonHud({ playIntro: true, mode: 'executable-editor', source: 'tray-intro' })
    },
    { type: 'separator' },
    {
      label: 'Abrir Pasta de Capturas',
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
      label: 'Encerrar M.P.E Completamente',
      click: () => {
        isQuitting = true;
        hookBridge.stop();
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    // Clicar no icone executavel na bandeja abre o Modo de Edicao
    summonHud({ playIntro: false, mode: 'executable-editor', source: 'tray-click' });
  });
}

function setupHooksAndShortcuts() {
  hookBridge.on('trigger', ({ x, y }) => {
    // Quando acionado via Shift + Ctrl + Alt + Botao Direito do Mouse:
    // Abre exclusivamente o Circulo 3D limpo (sem menus de edicao) para alta performance
    summonHud({ x, y, playIntro: false, mode: 'hud-only', source: 'mouse-hook' });
  });
  hookBridge.start();

  const cfg = configManager.get();
  const fallbackKey =
    (cfg.system && cfg.system.fallbackKeyboardShortcut) || 'CommandOrControl+Shift+Alt+M';
  try {
    globalShortcut.register(fallbackKey, () => {
      summonHud({ playIntro: false, mode: 'hud-only', source: 'keyboard-shortcut' });
    });
  } catch (err) {
    console.warn('[M.P.E Shortcut] Atalho complementar nao pode ser registrado:', err.message);
  }
}

function setupIpcHandlers() {
  ipcMain.handle('mpe:get-config', async () => {
    const cfg = configManager.get();
    const isStartupEnabled = await startupManager.checkStartup();
    cfg.system.startWithWindows = isStartupEnabled;
    cfg.originSystem = hookBridge.getOriginSystemInfo();
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
    return await actionExecutor.completeAreaCrop(
      Object.assign({}, payload, { mainWindow })
    );
  });

  ipcMain.handle('mpe:send-text-telegram', async (_event, { text, target }) => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }
    return await actionExecutor.dispatchToTelegram({
      textMessage: text,
      customTarget: target
    });
  });

  ipcMain.handle('mpe:send-to-system', async (_event, { text, targetSystem, autoSendEnter }) => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    }
    return await actionExecutor.dispatchToTargetSystem({
      targetSystem,
      autoSendEnter: autoSendEnter !== false,
      isTelegram: false,
      textMessage: text
    });
  });

  ipcMain.handle('mpe:list-open-windows', async () => {
    return await hookBridge.listOpenWindows();
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
      title: 'Selecionar Arquivo ou Executavel (M.P.E)',
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
