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

const DEBUG_LOG = path.join(__dirname, '..', '..', 'logs', 'app_debug.log');
function logDebug(msg) {
  try {
    fs.mkdirSync(path.dirname(DEBUG_LOG), { recursive: true });
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${msg}\n`);
  } catch (_) {}
}
logDebug(`[MAIN START] pid=${process.pid} argv=${JSON.stringify(process.argv)}`);

process.on('uncaughtException', (err) => {
  logDebug(`[UNCAUGHT EXCEPTION] ${err.stack || err.message}`);
});

process.on('unhandledRejection', (reason) => {
  logDebug(`[UNHANDLED REJECTION] ${reason}`);
});

process.on('exit', (code) => {
  logDebug(`[PROCESS EXIT] code=${code}`);
});

// Identificador unico do aplicativo no Windows para agrupar e fixar na Barra de Tarefas com o icone do M.P.E
const APP_USER_MODEL_ID = 'DevFLeo.MousePerformaticoEstrelado';
app.setAppUserModelId(APP_USER_MODEL_ID);

// Registro de travamentos: toda janela que congelar (UI sem resposta) fica anotada no log com a duracao.
app.on('browser-window-created', (_evt, win) => {
  let frozenSince = 0;
  const label = () => {
    try { return win.getTitle() || `janela-${win.id}`; } catch (_) { return 'janela'; }
  };
  win.on('unresponsive', () => {
    frozenSince = Date.now();
    logDebug(`[FREEZE] ${label()} parou de responder`);
  });
  win.on('responsive', () => {
    if (frozenSince) {
      logDebug(`[FREEZE END] ${label()} voltou apos ${Date.now() - frozenSince}ms`);
      frozenSince = 0;
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    logDebug(`[RENDER GONE] ${label()} reason=${details && details.reason} exitCode=${details && details.exitCode}`);
  });
});
app.name = 'M.P.E - Mouse Performatico Estrelado';

// Otimizacoes de GPU e memoria para maxima fluidez do motor 2D e 3D
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-http-cache');

function getCliArgValue(argv, flagName) {
  if (!Array.isArray(argv)) return '';
  const prefix = `${flagName}=`;
  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] || '');
    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length).replace(/^["']|["']$/g, '').trim();
    }
    if (arg === flagName && i + 1 < argv.length) {
      return String(argv[i + 1] || '').replace(/^["']|["']$/g, '').trim();
    }
  }
  return '';
}

const cliConfigPath = getCliArgValue(process.argv, '--config-path');
const envConfigPath = String(process.env.MPE_CONFIG_PATH || '').trim();
const customConfigPath = cliConfigPath || envConfigPath || '';
const isCleanState = process.argv.includes('--clean-state');
const forceCleanConsent = process.env.MPE_FORCE_CLEAN_CONSENT === '1';
const isSelfTest = process.argv.includes('--self-test');
const isIsolatedConfig = Boolean(customConfigPath || isCleanState);

const gotTheLock = app.requestSingleInstanceLock();
logDebug(`[LOCK] gotTheLock=${gotTheLock}`);
if (!gotTheLock) {
  logDebug(`[LOCK FAILED] Exiting immediately because another instance has the lock`);
  app.exit(0);
  return;
}

const ConfigManager = require('./configManager');
const ConsentManager = require('./consentManager');
const StartupManager = require('./startupManager');
const HookBridge = require('./hookBridge');
const ActionExecutor = require('./actionExecutor');
const FileOrganizer = require('./fileOrganizer');

function tryRequireOptional(relPath) {
  try {
    return require(relPath);
  } catch (err) {
    const modName = relPath.replace(/^\.\//, '');
    if (err && err.code === 'MODULE_NOT_FOUND' && err.message && err.message.includes(modName)) {
      return null;
    }
    logDebug(`[OPTIONAL MODULE ERROR] ${relPath}: ${err && err.message ? err.message : err}`);
    return null;
  }
}

const MiniAstrolabeManager = tryRequireOptional('./miniAstrolabeManager');
const PythonRecorder = tryRequireOptional('./pythonRecorder');
const PythonScheduler = tryRequireOptional('./pythonScheduler');

const CODE_DIR = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

let mainWindow = null;
let tray = null;
let isQuitting = false;
let cleanupExecuted = false;
let hookTriggerBound = false;
let backgroundServicesActive = false;

const configManager = new ConfigManager(ROOT_DIR, CODE_DIR, {
  configPath: customConfigPath || undefined,
  cleanState: isCleanState,
  forceCleanConsent
});
const consentManager = new ConsentManager(configManager);
const startupManager = new StartupManager(ROOT_DIR, CODE_DIR, {
  consentManager,
  configManager
});
const hookBridge = new HookBridge(CODE_DIR);
const actionExecutor = new ActionExecutor(configManager, hookBridge);
const fileOrganizer = new FileOrganizer(ROOT_DIR, CODE_DIR, configManager);

let miniAstrolabeManager = null;
let pythonRecorder = null;
let pythonScheduler = null;

const windowRegistry = new Map();

function registerWindow(name, win) {
  if (!win || win.isDestroyed()) return;
  windowRegistry.set(name, win);
  win.on('closed', () => {
    if (windowRegistry.get(name) === win) {
      windowRegistry.delete(name);
    }
    if (name === 'main' && mainWindow === win) {
      mainWindow = null;
    }
  });
}

function getSourceWindowName(event) {
  const sender = event && event.sender;
  if (!sender) return 'main-process';
  for (const [name, win] of windowRegistry.entries()) {
    if (win && !win.isDestroyed() && win.webContents && win.webContents.id === sender.id) {
      return name;
    }
  }
  return 'unknown';
}

function broadcastToAllWindows(channel, payload) {
  const targets = new Set();
  for (const win of windowRegistry.values()) {
    if (win && !win.isDestroyed()) targets.add(win);
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win && !win.isDestroyed()) targets.add(win);
  }
  for (const win of targets) {
    try {
      if (win.webContents && !win.webContents.isDestroyed()) {
        win.webContents.send(channel, payload);
      }
    } catch (_) {}
  }
}

function broadcastConfigUpdated(savedConfig, sourceEvent = null) {
  broadcastToAllWindows('mpe:config-updated', {
    config: savedConfig,
    sourceWindow: getSourceWindowName(sourceEvent)
  });
}

function getConsentBlockedResponse() {
  if (typeof consentManager.getBlockedResponse === 'function') {
    return consentManager.getBlockedResponse();
  }
  return {
    ok: false,
    blockedByConsent: true,
    message: 'Aceite de primeiro acesso necessario.'
  };
}

function cleanupSubsystems(reason = 'quit') {
  if (cleanupExecuted) return;
  cleanupExecuted = true;
  isQuitting = true;
  backgroundServicesActive = false;
  logDebug(`[SHUTDOWN CLEANUP] reason=${reason}`);
  try { globalShortcut.unregisterAll(); } catch (_) {}
  try {
    if (pythonRecorder && typeof pythonRecorder.stop === 'function') {
      pythonRecorder.stop();
    }
  } catch (_) {}
  try {
    if (pythonScheduler && typeof pythonScheduler.stop === 'function') {
      pythonScheduler.stop();
    }
  } catch (_) {}
  try {
    if (miniAstrolabeManager && typeof miniAstrolabeManager.destroy === 'function') {
      miniAstrolabeManager.destroy();
    }
  } catch (_) {}
  try {
    if (hookBridge && typeof hookBridge.stop === 'function') {
      hookBridge.stop();
    }
  } catch (_) {}
  try {
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
    }
  } catch (_) {}
}

function handleProcessSignal(signal) {
  logDebug(`[SIGNAL] Received ${signal}`);
  cleanupSubsystems(signal);
  try { app.quit(); } catch (_) {}
  const forceTimer = setTimeout(() => {
    try { app.exit(0); } catch (_) {}
  }, 500);
  if (forceTimer.unref) forceTimer.unref();
}

process.on('SIGINT', () => handleProcessSignal('SIGINT'));
process.on('SIGTERM', () => handleProcessSignal('SIGTERM'));

app.on('before-quit', () => {
  logDebug(`[APP BEFORE-QUIT]`);
  cleanupSubsystems('before-quit');
});

app.on('will-quit', () => {
  logDebug(`[APP WILL-QUIT]`);
  cleanupSubsystems('will-quit');
});

app.on('second-instance', () => {
  logDebug(`[SECOND INSTANCE] Second instance launched`);
  // Quando o usuario clica novamente no icone executavel MPE.exe, abre imediatamente no Modo Edicao Completo
  summonHud({ playIntro: false, mode: 'executable-editor', source: 'executable' });
});

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.bounds;

  const iconPath = path.join(CODE_DIR, 'assets', 'icon.ico');

  mainWindow = new BrowserWindow({
    title: 'M.P.E - Mouse Performatico Estrelado',
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

  if (process.platform === 'win32' && typeof mainWindow.setAppDetails === 'function') {
    const launcherExe = path.join(ROOT_DIR, 'MPE.exe');
    const relaunchCmd = fs.existsSync(launcherExe)
      ? `"${launcherExe}" --launch-ui`
      : `"${process.execPath}" "${CODE_DIR}" --launch-ui`;
    mainWindow.setAppDetails({
      appId: APP_USER_MODEL_ID,
      appIconPath: fs.existsSync(iconPath) ? iconPath : launcherExe,
      appIconIndex: 0,
      relaunchCommand: relaunchCmd,
      relaunchDisplayName: 'M.P.E - Mouse Performatico Estrelado'
    });
  }

  const indexHtmlPath = path.join(__dirname, '..', 'renderer', 'index.html');
  mainWindow.loadFile(indexHtmlPath);
  registerWindow('main', mainWindow);

  mainWindow.webContents.once('did-finish-load', async () => {
    logDebug(`[DID-FINISH-LOAD] isSilentStartup=${process.argv.includes('--startup')} isSelfTest=${isSelfTest}`);
    const isSilentStartup = process.argv.includes('--startup');
    if (!isSilentStartup || !consentManager.isActionAllowed('backgroundExecution')) {
      // Ao abrir pelo executavel MPE.exe, inicia com Intro e Modo de Edicao habilitado
      summonHud({ playIntro: true, mode: 'executable-editor', source: 'startup' });
    } else {
      // Quando iniciado silenciosamente com o Windows via --startup:
      // Exibe notificacao discreta no System Tray para confirmar status ativo
      if (tray && typeof tray.displayBalloon === 'function') {
        try {
          tray.displayBalloon({
            title: 'M.P.E - Mouse Performatico Estrelado',
            content: 'Ativo em segundo plano. Use Shift+Ctrl+Alt+Botao Direito para invocar o Astrolabio.',
            iconType: 'info'
          });
        } catch (_) {}
      }
    }

    if (process.argv.includes('--self-test')) {
      try {
        const outDir = path.join(ROOT_DIR, 'prints', 'Verificacao');
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
          document.getElementById('btn-mode-3d').click();
        `);
        await new Promise((r) => setTimeout(r, 600));
        const imgAstrolabe3D = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_3_astrolabe3d.png'), imgAstrolabe3D.toPNG());

        // Testa o Modo 2D (base da imagem) e aciona a Acao 2D com animacoes
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('btn-action-2d').click();
        `);
        await new Promise((r) => setTimeout(r, 550));
        const imgAstrolabe2D = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_4_astrolabe2d.png'), imgAstrolabe2D.toPNG());

        // Teste do fluxo Adicionar Ponto: clicar no circulo -> Forjador abre com posicao preenchida
        const addResult = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.getElementById('btn-dock-add-point').click();
            await new Promise(r => setTimeout(r, 200));
            const cv = document.getElementById('astrolabe-canvas');
            const r = cv.getBoundingClientRect();
            const x = r.left + r.width / 2 + 180;
            const y = r.top + r.height / 2 - 120;
            cv.dispatchEvent(new MouseEvent('mousedown', { clientX: x, clientY: y, button: 0, bubbles: true }));
            window.dispatchEvent(new MouseEvent('mouseup', { clientX: x, clientY: y, button: 0, bubbles: true }));
            await new Promise(r => setTimeout(r, 250));
            return {
              modalOpen: !document.getElementById('modal-point').classList.contains('hidden'),
              angle: document.getElementById('pt-angle').value,
              orbit: document.getElementById('pt-orbit').value
            };
          })()
        `);
        console.log('MPE_ADD_POINT_FLOW:', JSON.stringify(addResult));
        await new Promise((r) => setTimeout(r, 200));
        const imgAdd = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_5_add_point.png'), imgAdd.toPNG());

        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('modal-point').classList.add('hidden');
          document.getElementById('btn-toggle-move-points').click();
        `);
        await new Promise((r) => setTimeout(r, 300));
        const imgMove = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_6_move_points.png'), imgMove.toPNG());
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('btn-cancel-placement').click();
        `);

        // Teste do Modal de Selecao de Texto e Envio para Sistema
        await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const txtModal = document.getElementById('modal-text-selection');
            const txtArea = document.getElementById('captured-text-area');
            const targetInput = document.getElementById('captured-target-system');
            txtArea.value = 'M.P.E - Teste de Integracao e Transferencia de Texto';
            targetInput.value = 'Bloco de Notas';
            txtModal.classList.remove('hidden');
          })()
        `);
        await new Promise((r) => setTimeout(r, 350));
        const imgText = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_7_text_selection.png'), imgText.toPNG());
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById('modal-text-selection').classList.add('hidden');
        `);

        // Teste 8: Painel Organizador (Arquithon M.P.E)
        mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
        const orgRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const tabOrg = document.getElementById('btn-tab-organizer');
            if (tabOrg) tabOrg.click();
            await new Promise(r => setTimeout(r, 450));
            const ws = document.getElementById('organizer-workspace');
            const printsBtn = document.querySelector('.org-scope-btn[data-scope="prints"]');
            if (printsBtn) printsBtn.click();
            await new Promise(r => setTimeout(r, 350));
            return {
              workspaceVisible: ws && !ws.classList.contains('hidden'),
              treeCount: document.querySelectorAll('#org-tree-list .org-cat-header').length
            };
          })()
        `);
        console.log('MPE_ORGANIZER_TEST:', JSON.stringify(orgRes));
        await new Promise((r) => setTimeout(r, 350));
        const imgOrg = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_8_organizer.png'), imgOrg.toPNG());

        // Teste 9: Guia Rapido & Atalhos do M.P.E
        const guideRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const backBtn = document.getElementById('btn-org-back-astrolabe');
            if (backBtn) backBtn.click();
            await new Promise(r => setTimeout(r, 200));
            const openGuide = document.getElementById('btn-open-guide');
            if (openGuide) openGuide.click();
            await new Promise(r => setTimeout(r, 350));
            return {
              guideOpen: !document.getElementById('modal-guide').classList.contains('hidden')
            };
          })()
        `);
        console.log('MPE_GUIDE_TEST:', JSON.stringify(guideRes));
        await new Promise((r) => setTimeout(r, 250));
        const imgGuide = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_9_guide.png'), imgGuide.toPNG());

        console.log('MPE_SELF_TEST_PASSED');
        cleanupSubsystems('self-test-pass');
        app.quit();
      } catch (err) {
        console.error('MPE_SELF_TEST_FAILED:', err);
        cleanupSubsystems('self-test-fail');
        app.exit(1);
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (!isQuitting && consentManager.isActionAllowed('backgroundExecution')) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
    isQuitting = true;
  });

  // Garante em nivel nativo que a tecla ESC sempre minimize/oculte o HUD sem encerrar o projeto
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape') {
      mainWindow.webContents.send('mpe:escape-pressed');
    }
  });
}

// Impede encerramento do processo apenas quando consentido e rodando em segundo plano
app.on('window-all-closed', (e) => {
  if (!isQuitting && consentManager.isActionAllowed('backgroundExecution')) {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    return;
  }
  cleanupSubsystems('window-all-closed');
  app.quit();
});

async function summonHud({ x, y, playIntro = false, mode = 'hud-only', source = 'shortcut' } = {}) {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Se nao foi acionado pelo hook de mouse que ja capturou o hwnd,
  // captura o foreground atual antes do mainWindow.show() roubar o foco
  if (
    consentManager.isActionAllowed('backgroundExecution') &&
    source !== 'mouse-hook' &&
    !(mainWindow.isVisible && mainWindow.isVisible())
  ) {
    // Sempre: a janela de origem e a que estava ativa ao abrir o HUD (antes so quando vazia)
    await hookBridge.refreshForegroundWindow();
  }

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
  const pngPath = path.join(CODE_DIR, 'assets', 'icon.png');

  let trayIcon = fs.existsSync(pngPath)
    ? nativeImage.createFromPath(pngPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(trayIcon);
  tray.setToolTip('M.P.E - Mouse Performatico Estrelado (Shift+Ctrl+Alt+Botao Direito)');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Modo Edicao e Organizador (MPE.exe)',
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
      label: 'Abrir Pasta de Arquivos Organizados',
      click: () => {
        fileOrganizer.openInExplorer({ scope: 'arquivos' });
      }
    },
    {
      label: 'Abrir Pasta de Prints',
      click: () => {
        fileOrganizer.openInExplorer({ scope: 'prints' });
      }
    },
    { type: 'separator' },
    {
      label: 'Encerrar M.P.E Completamente',
      click: () => {
        cleanupSubsystems('tray-quit');
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

function ensureTrayCreated() {
  if (tray && !tray.isDestroyed()) return;
  createSystemTray();
}

function setupHooksAndShortcuts() {
  if (!hookTriggerBound) {
    hookTriggerBound = true;
    hookBridge.on('trigger', ({ x, y }) => {
      if (!consentManager.isActionAllowed('backgroundExecution')) return;
      // Quando acionado via Shift + Ctrl + Alt + Botao Direito do Mouse:
      // Abre o Circulo 3D/2D Astrolabio Estrelado com animacao de pulso estelar reforcada
      summonHud({ x, y, playIntro: false, mode: 'hud-only', source: 'mouse-hook' });
    });
  }

  hookBridge.start();

  const cfg = configManager.get();
  const fallbackKey =
    (cfg.system && cfg.system.fallbackKeyboardShortcut) || 'CommandOrControl+Shift+Alt+M';
  try {
    globalShortcut.register(fallbackKey, () => {
      if (!consentManager.isActionAllowed('backgroundExecution')) return;
      summonHud({ playIntro: false, mode: 'hud-only', source: 'keyboard-shortcut' });
    });
  } catch (err) {
    console.warn('[M.P.E Shortcut] Atalho complementar nao pode ser registrado:', err.message);
  }
}

function activateBackgroundServices() {
  if (!consentManager.isActionAllowed('backgroundExecution')) return;
  ensureTrayCreated();
  if (!backgroundServicesActive) {
    backgroundServicesActive = true;
    setupHooksAndShortcuts();
  }
  if (pythonScheduler && typeof pythonScheduler.start === 'function') {
    pythonScheduler.start();
  }
  if (miniAstrolabeManager && typeof miniAstrolabeManager.syncWithConsent === 'function') {
    miniAstrolabeManager.syncWithConsent(true);
  }
}

async function deactivateBackgroundServices() {
  backgroundServicesActive = false;
  try { globalShortcut.unregisterAll(); } catch (_) {}
  try {
    if (hookBridge && typeof hookBridge.stop === 'function') {
      await hookBridge.stop();
    }
  } catch (_) {}
  try {
    if (pythonRecorder && typeof pythonRecorder.stop === 'function') {
      pythonRecorder.stop();
    }
  } catch (_) {}
  try {
    if (pythonScheduler && typeof pythonScheduler.stop === 'function') {
      pythonScheduler.stop();
    }
  } catch (_) {}
  try {
    if (miniAstrolabeManager && typeof miniAstrolabeManager.syncWithConsent === 'function') {
      miniAstrolabeManager.syncWithConsent(false);
    }
  } catch (_) {}
  try {
    if (tray && !tray.isDestroyed()) {
      tray.destroy();
      tray = null;
    }
  } catch (_) {}
}

function setupIpcHandlers() {
  ipcMain.handle('mpe:get-config', async () => {
    const cfg = configManager.get();
    const consentStatus = consentManager.getConsentStatus();
    if (!isIsolatedConfig && consentManager.isActionAllowed('backgroundExecution')) {
      const isStartupEnabled = await startupManager.checkStartup();
      cfg.system.startWithWindows = isStartupEnabled;
    } else if (!isIsolatedConfig) {
      cfg.system.startWithWindows = false;
    }
    cfg.consent = consentStatus;
    cfg.originSystem = hookBridge.getOriginSystemInfo();
    return cfg;
  });

  ipcMain.handle('mpe:save-config', async (event, newConfig) => {
    const safeNewConfig = newConfig && typeof newConfig === 'object' ? Object.assign({}, newConfig) : {};
    // Protege estado de consentimento contra sobrescrita acidental via mpe:save-config
    delete safeNewConfig.consent;

    if (
      safeNewConfig.system &&
      typeof safeNewConfig.system.startWithWindows === 'boolean'
    ) {
      if (safeNewConfig.system.startWithWindows === true) {
        if (!consentManager.isActionAllowed('backgroundExecution')) {
          safeNewConfig.system = Object.assign({}, safeNewConfig.system, {
            startWithWindows: false
          });
        } else if (!isIsolatedConfig) {
          const startupRes = await startupManager.setStartup(true);
          if (!startupRes || !startupRes.ok || startupRes.blockedByConsent) {
            safeNewConfig.system = Object.assign({}, safeNewConfig.system, {
              startWithWindows: false
            });
          }
        }
      } else if (!isIsolatedConfig) {
        await startupManager.setStartup(false);
      }
    }

    const saved = configManager.save(safeNewConfig);
    broadcastConfigUpdated(saved, event);
    return saved;
  });

  ipcMain.handle('mpe:reorder-point', async (event, payload = {}) => {
    const res = configManager.reorderPoint(payload.fromIndex, payload.toIndex);
    if (res && res.ok) {
      broadcastConfigUpdated(res.config || configManager.get(), event);
    }
    return res;
  });

  ipcMain.handle('mpe:get-consent', async () => {
    return consentManager.getConsentStatus();
  });

  ipcMain.handle('mpe:set-consent', async (event, payload = {}) => {
    const accepted = Boolean(payload && payload.accepted);
    const permissions = payload && payload.permissions ? payload.permissions : {};
    const decision = consentManager.setConsentDecision(accepted, permissions);
    const consent = decision.consent;

    if (consent.accepted && consentManager.isActionAllowed('backgroundExecution')) {
      await deactivateBackgroundServices();
      activateBackgroundServices();
      const cfg = configManager.get();
      if (!isIsolatedConfig && !isSelfTest && cfg.system && cfg.system.startWithWindows) {
        await startupManager.setStartup(true);
      }
    } else {
      await deactivateBackgroundServices();
      if (!isIsolatedConfig && !isSelfTest) {
        await startupManager.setStartup(false);
      }
    }

    broadcastToAllWindows('mpe:consent-updated', consent);
    broadcastConfigUpdated(configManager.get(), event);
    return { ok: true, consent };
  });

  const HUD_UI_RESULT_TYPES = new Set([
    'request_area_crop',
    'request_named_print',
    'text_selection',
    'open_organizer',
    'organize_files_quick',
    'open_settings',
    'toggle_2d_3d'
  ]);
  const CAPTURE_ACTION_TYPES = new Set([
    'print',
    'named_print',
    'system_to_system_print',
    'print_telegram',
    'area_print',
    'area_print_telegram',
    'area_print_system',
    'action_2d_scan'
  ]);

  ipcMain.handle('mpe:execute-point', async (event, point) => {
    if (!consentManager.isActionAllowed('launchAppsAndLinks')) {
      return getConsentBlockedResponse();
    }
    const sourceWindow = getSourceWindowName(event);
    const actionType = point && point.actionType ? String(point.actionType) : '';

    // Ao disparar captura de tela pelo Mini Astrolabio, recolhe o leque antes do print
    // para que o leque nao apareca na imagem capturada. Para outras acoes (ex: texto/pasta),
    // mantem o Mini aberto para exibir o feedback sem fechar o leque abruptamente.
    if (
      sourceWindow === 'mini-astrolabe' &&
      CAPTURE_ACTION_TYPES.has(actionType) &&
      miniAstrolabeManager &&
      miniAstrolabeManager.expanded &&
      typeof miniAstrolabeManager.setExpanded === 'function'
    ) {
      try {
        miniAstrolabeManager.setExpanded(false);
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 80));
    }

    const res = await actionExecutor.executePoint(point, mainWindow);

    if (
      sourceWindow !== 'main' &&
      res &&
      res.ok !== false &&
      HUD_UI_RESULT_TYPES.has(res.type) &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      try {
        if (
          sourceWindow === 'mini-astrolabe' &&
          miniAstrolabeManager &&
          miniAstrolabeManager.expanded &&
          typeof miniAstrolabeManager.setExpanded === 'function'
        ) {
          miniAstrolabeManager.setExpanded(false);
        }
        const cursor = screen.getCursorScreenPoint();
        const currentDisplay = screen.getDisplayNearestPoint({ x: cursor.x, y: cursor.y });
        mainWindow.setBounds(currentDisplay.bounds);
        mainWindow.show();
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(true, 'screen-saver');
        if (mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('mpe:hud-action-result', {
            point,
            result: res,
            source: sourceWindow
          });
        }
        return Object.assign({}, res, { forwardedToHud: true });
      } catch (_) {}
    }

    return res;
  });

  ipcMain.handle('mpe:complete-area-crop', async (_event, payload) => {
    if (!consentManager.isActionAllowed('launchAppsAndLinks')) {
      return getConsentBlockedResponse();
    }
    return await actionExecutor.completeAreaCrop(
      Object.assign({}, payload, { mainWindow })
    );
  });

  ipcMain.handle('mpe:save-named-print', async (_event, payload) => {
    return actionExecutor.saveNamedPrint(payload || {});
  });

  ipcMain.handle('mpe:send-text-telegram', async (_event, { text, target, keepOpen }) => {
    if (!consentManager.isActionAllowed('launchAppsAndLinks')) {
      return getConsentBlockedResponse();
    }
    const wasVisible = mainWindow && mainWindow.isVisible();
    if (wasVisible) {
      mainWindow.hide();
    }
    const res = await actionExecutor.dispatchToTelegram({
      textMessage: text,
      customTarget: target
    });
    if (keepOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return res;
  });

  ipcMain.handle('mpe:send-to-system', async (_event, { text, targetSystem, autoSendEnter, keepOpen }) => {
    if (!consentManager.isActionAllowed('launchAppsAndLinks')) {
      return getConsentBlockedResponse();
    }
    const wasVisible = mainWindow && mainWindow.isVisible();
    if (wasVisible) {
      mainWindow.hide();
    }
    const res = await actionExecutor.dispatchToTargetSystem({
      targetSystem,
      autoSendEnter: autoSendEnter !== false,
      isTelegram: false,
      textMessage: text
    });
    if (keepOpen && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.showInactive();
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
    }
    return res;
  });

  // Visibilidade real da janela principal (document.hidden nao serve: backgroundThrottling=false
  // faz a pagina sempre se declarar visivel).
  ipcMain.handle('mpe:main-window-visible', () =>
    Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
  );

  ipcMain.handle('mpe:list-open-windows', async () => {
    return await hookBridge.listOpenWindows();
  });

  ipcMain.handle('mpe:copy-text', (_event, text) => {
    clipboard.writeText(text || '');
    return { ok: true };
  });

  ipcMain.handle('mpe:ensure-shortcuts', async () => {
    return await startupManager.createAppShortcuts();
  });

  ipcMain.handle('mpe:open-path', async (_event, targetPath) => {
    if (!consentManager.isActionAllowed('launchAppsAndLinks')) {
      return getConsentBlockedResponse();
    }
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
    cleanupSubsystems('ipc-quit');
    app.quit();
    return { ok: true };
  });

  // Mini Astrolabio (M1 stub / M4 delegate)
  ipcMain.handle('mpe:mini-toggle', async (event, payload = {}) => {
    if (!consentManager.isActionAllowed('backgroundExecution')) {
      return Object.assign(getConsentBlockedResponse(), { enabled: false });
    }
    if (miniAstrolabeManager && typeof miniAstrolabeManager.toggle === 'function') {
      return await miniAstrolabeManager.toggle(payload.enabled);
    }
    const cfg = configManager.get();
    const cur = (cfg && cfg.miniAstrolabe) || {};
    const nextEnabled =
      typeof payload.enabled === 'boolean' ? payload.enabled : !Boolean(cur.enabled);
    const saved = configManager.save({
      miniAstrolabe: Object.assign({}, cur, { enabled: nextEnabled })
    });
    broadcastConfigUpdated(saved, event);
    broadcastToAllWindows('mpe:mini-state-changed', saved.miniAstrolabe);
    return { ok: true, enabled: nextEnabled, miniAstrolabe: saved.miniAstrolabe, stub: true };
  });

  ipcMain.handle('mpe:mini-get-state', async () => {
    if (miniAstrolabeManager && typeof miniAstrolabeManager.getState === 'function') {
      return await miniAstrolabeManager.getState();
    }
    const cfg = configManager.get();
    return Object.assign(
      {
        ok: true,
        windowOpen: false,
        blockedByConsent: !consentManager.isActionAllowed('backgroundExecution'),
        stub: true
      },
      (cfg && cfg.miniAstrolabe) || {}
    );
  });

  ipcMain.handle('mpe:mini-update-layout', async (event, payload = {}) => {
    if (!consentManager.isActionAllowed('backgroundExecution')) {
      return getConsentBlockedResponse();
    }
    if (miniAstrolabeManager && typeof miniAstrolabeManager.updateLayout === 'function') {
      return await miniAstrolabeManager.updateLayout(payload || {});
    }
    const cfg = configManager.get();
    const cur = (cfg && cfg.miniAstrolabe) || {};
    const allowedKeys = ['x', 'y', 'size', 'scale', 'fanRadius', 'enabled'];
    const patch = {};
    for (const k of allowedKeys) {
      if (k in payload && payload[k] !== undefined) {
        patch[k] = payload[k];
      }
    }
    const saved = configManager.save({
      miniAstrolabe: Object.assign({}, cur, patch)
    });
    broadcastConfigUpdated(saved, event);
    broadcastToAllWindows('mpe:mini-state-changed', saved.miniAstrolabe);
    return { ok: true, miniAstrolabe: saved.miniAstrolabe, stub: true };
  });

  ipcMain.on('mpe:mini-ignore-mouse', (_event, payload = {}) => {
    if (miniAstrolabeManager && typeof miniAstrolabeManager.setIgnoreMouse === 'function') {
      miniAstrolabeManager.setIgnoreMouse(Boolean(payload.ignore), Boolean(payload.forward));
    }
  });

  ipcMain.handle('mpe:mini-set-expanded', async (_event, payload = {}) => {
    if (!consentManager.isActionAllowed('backgroundExecution')) {
      return getConsentBlockedResponse();
    }
    if (miniAstrolabeManager && typeof miniAstrolabeManager.setExpanded === 'function') {
      return await miniAstrolabeManager.setExpanded(Boolean(payload.expanded));
    }
    return { ok: true, expanded: Boolean(payload.expanded), stub: true };
  });

  // Auto-Script Python (M1 stub / M5 delegate)
  ipcMain.handle('mpe:py-record-start', async (_event, options = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonRecorder && typeof pythonRecorder.startRecording === 'function') {
      return await pythonRecorder.startRecording(options);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  ipcMain.handle('mpe:py-record-stop', async (_event, options = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonRecorder && typeof pythonRecorder.stopRecording === 'function') {
      return await pythonRecorder.stopRecording(options);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  ipcMain.handle('mpe:py-save-script', async (_event, payload = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonRecorder && typeof pythonRecorder.saveScript === 'function') {
      return await pythonRecorder.saveScript(payload);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  ipcMain.handle('mpe:py-run-script', async (_event, payload = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonScheduler && typeof pythonScheduler.runScript === 'function') {
      return await pythonScheduler.runScript(payload);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  ipcMain.handle('mpe:py-schedule-script', async (_event, payload = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonScheduler && typeof pythonScheduler.scheduleScript === 'function') {
      return await pythonScheduler.scheduleScript(payload.scriptId, payload.schedule);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  ipcMain.handle('mpe:py-delete-script', async (_event, payload = {}) => {
    if (!consentManager.isActionAllowed('pythonAutomation')) {
      return getConsentBlockedResponse();
    }
    if (pythonScheduler && typeof pythonScheduler.deleteScript === 'function') {
      return await pythonScheduler.deleteScript(payload.scriptId);
    }
    return {
      ok: false,
      unavailable: true,
      message: 'Modulo Python Auto-Script ainda nao carregado.'
    };
  });

  // Organizador de Arquivos & Prints (Estilo Arquithon)
  ipcMain.handle('mpe:org-select-files', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivos para Organizar (M.P.E)',
      properties: ['openFile', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return [];
    return res.filePaths;
  });

  ipcMain.handle('mpe:org-select-folder', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Pasta para Organizar Recursivamente (M.P.E)',
      properties: ['openDirectory', 'multiSelections']
    });
    if (res.canceled || !res.filePaths.length) return [];
    return res.filePaths;
  });

  ipcMain.handle('mpe:org-organize', async (event, payload = {}) => {
    const sender = event.sender;
    const result = fileOrganizer.organizePaths({
      paths: payload.paths || [],
      criterion: payload.criterion || 'type',
      moveInsteadOfCopy: Boolean(payload.moveInsteadOfCopy),
      targetScope: payload.targetScope || 'arquivos',
      onProgress: (prog) => {
        if (!sender.isDestroyed()) {
          sender.send('mpe:org-progress', prog);
        }
      }
    });
    if (result && result.ok && Array.isArray(result.results)) {
      const cfg = configManager.get();
      if (cfg.organizer) {
        cfg.organizer.criterion = payload.criterion || cfg.organizer.criterion;
        cfg.organizer.defaultTarget = payload.targetScope || cfg.organizer.defaultTarget;
        const saved = configManager.save(cfg);
        broadcastConfigUpdated(saved, event);
      }
    }
    return result;
  });

  ipcMain.handle('mpe:org-revert', async () => {
    return fileOrganizer.revertLastBatch();
  });

  ipcMain.handle('mpe:org-undo-info', async () => {
    return fileOrganizer.getUndoInfo();
  });

  ipcMain.handle('mpe:org-scan', async (_event, { scope = 'arquivos' } = {}) => {
    return fileOrganizer.scanScope(scope);
  });

  ipcMain.handle('mpe:org-search', async (_event, { scope = 'arquivos', query = '', searchInContent = true } = {}) => {
    return fileOrganizer.searchScope({ scope, query, searchInContent });
  });

  ipcMain.handle('mpe:org-delete-file', async (_event, { scope = 'arquivos', relPath = '' } = {}) => {
    return fileOrganizer.deleteOrganizedFile({ scope, relPath });
  });

  ipcMain.handle('mpe:org-open-explorer', async (_event, { scope = 'arquivos', relPath = '', select = false } = {}) => {
    return fileOrganizer.openInExplorer({ scope, relPath, select });
  });

  ipcMain.handle('mpe:org-open-file', async (_event, { scope = 'arquivos', relPath = '' } = {}) => {
    const baseDir = fileOrganizer.ensureScopeDir(scope);
    const fullPath = path.resolve(baseDir, relPath || '');
    if (!fullPath.toLowerCase().startsWith(baseDir.toLowerCase() + path.sep) || !fs.existsSync(fullPath)) {
      return { ok: false, error: 'Arquivo nao encontrado.' };
    }
    await shell.openPath(fullPath);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  logDebug(`[APP WHEN-READY] Initializing subsystems`);
  fileOrganizer.ensureScopeDir('arquivos');
  fileOrganizer.ensureScopeDir('prints');
  const cfg = configManager.load();

  const managerCtx = {
    configManager,
    consentManager,
    actionExecutor,
    hookBridge,
    registerWindow,
    broadcastToAllWindows,
    broadcastConfigUpdated,
    codeDir: CODE_DIR,
    rootDir: ROOT_DIR,
    // Antes de um auto-script real: esconde o HUD (sempre por cima) para os cliques chegarem
    // nos aplicativos de baixo. Devolve a funcao que restaura o HUD ao terminar.
    onBeforeRealReplay: async () => {
      const wasVisible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible());
      if (wasVisible) {
        mainWindow.hide();
        await new Promise((r) => setTimeout(r, 180));
      }
      logDebug(`[PY REPLAY] HUD ${wasVisible ? 'escondido' : 'ja oculto'} antes da execucao real`);
      return () => {
        if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.showInactive();
        }
      };
    }
  };
  if (typeof MiniAstrolabeManager === 'function') {
    miniAstrolabeManager = new MiniAstrolabeManager(managerCtx);
  }
  if (typeof PythonRecorder === 'function') {
    pythonRecorder = new PythonRecorder(managerCtx);
  }
  if (typeof PythonScheduler === 'function') {
    pythonScheduler = new PythonScheduler(managerCtx);
    // Atalhos (Mini e HUD) que rodam script usam o mesmo agendador: evento de execucao,
    // HUD escondido na execucao real e mesma politica de timeout.
    if (actionExecutor && typeof actionExecutor.setPythonScheduler === 'function') {
      actionExecutor.setPythonScheduler(pythonScheduler);
    }
  }

  if (!isIsolatedConfig && !isSelfTest) {
    if (
      consentManager.isActionAllowed('backgroundExecution') &&
      cfg.system &&
      cfg.system.startWithWindows
    ) {
      await startupManager.setStartup(true);
    } else {
      await startupManager.createAppShortcuts();
    }
  }

  setupIpcHandlers();
  createWindow();
  if (consentManager.isActionAllowed('backgroundExecution')) {
    activateBackgroundServices();
  }
  logDebug(`[APP WHEN-READY DONE] All subsystems loaded consentAccepted=${consentManager.isAccepted()}`);
});
