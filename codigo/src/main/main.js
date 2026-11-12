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

app.on('before-quit', () => {
  logDebug(`[APP BEFORE-QUIT]`);
  // Encerra o servidor llamafile para liberar a RAM do modelo
  try {
    localAiService.shutdown();
  } catch (_) {}
});

app.on('will-quit', () => {
  logDebug(`[APP WILL-QUIT]`);
});

// Identificador unico do aplicativo no Windows para agrupar e fixar na Barra de Tarefas com o icone do M.P.E
const APP_USER_MODEL_ID = 'DevFLeo.MousePerformaticoEstrelado';
app.setAppUserModelId(APP_USER_MODEL_ID);
app.name = 'M.P.E - Mouse Performatico Estrelado';

const ConfigManager = require('./configManager');
const StartupManager = require('./startupManager');
const HookBridge = require('./hookBridge');
const ActionExecutor = require('./actionExecutor');
const LocalAiService = require('./localAiService');
const FileOrganizer = require('./fileOrganizer');

const CODE_DIR = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

// Otimizacoes de GPU e memoria para maxima fluidez do motor 2D e 3D
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('disable-http-cache');

let mainWindow = null;
let tray = null;
let isQuitting = false;

const configManager = new ConfigManager(ROOT_DIR, CODE_DIR);
const startupManager = new StartupManager(ROOT_DIR, CODE_DIR);
const hookBridge = new HookBridge(CODE_DIR);
const actionExecutor = new ActionExecutor(configManager, hookBridge);
const localAiService = new LocalAiService(ROOT_DIR, configManager, CODE_DIR);
const fileOrganizer = new FileOrganizer(ROOT_DIR, CODE_DIR, configManager);

const gotTheLock = app.requestSingleInstanceLock();
logDebug(`[LOCK] gotTheLock=${gotTheLock}`);
if (!gotTheLock) {
  logDebug(`[LOCK FAILED] Exiting because another instance has the lock`);
  app.quit();
} else {
  app.on('second-instance', () => {
    logDebug(`[SECOND INSTANCE] Second instance launched`);
    // Quando o usuario clica novamente no icone executavel MPE.exe, abre imediatamente no Modo Edicao Completo
    summonHud({ playIntro: false, mode: 'executable-editor', source: 'executable' });
  });
}

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

  mainWindow.webContents.once('did-finish-load', async () => {
    logDebug(`[DID-FINISH-LOAD] isSilentStartup=${process.argv.includes('--startup')} isSelfTest=${process.argv.includes('--self-test')}`);
    const isSilentStartup = process.argv.includes('--startup');
    if (!isSilentStartup) {
      // Ao abrir pelo executavel MPE.exe, inicia com Intro e Modo de Edicao habilitado
      summonHud({ playIntro: true, mode: 'executable-editor', source: 'startup' });
    } else {
      // Quando iniciado silenciosamente com o Windows via --startup:
      // Exibe notificacao discreta no System Tray para confirmar status ativo
      if (tray && typeof tray.displayBalloon === 'function') {
        try {
          tray.displayBalloon({
            title: 'M.P.E - Mouse Performático Estrelado',
            content: 'Ativo em segundo plano. Shift+Ctrl+Alt+Botão Direito para Astrolábio ou Shift+Ctrl+Botão Direito para Mini Assistente.',
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

        // Teste 8: Mini Assistente Flutuante (AI Kataros 3D) com I.A Local & Onde Enviar
        const miniRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.body.classList.add('mode-mini-assistant');
            const overlay = document.getElementById('mini-assistant-overlay');
            overlay.classList.remove('hidden');
            const txtArea = document.getElementById('mini-ai-textarea');
            txtArea.value = 'este e um texto de teste para revisar com a ai kataros do mpe e salvar no obsidian';
            document.getElementById('mini-note-title').value = 'Nota Teste MPE AI';
            document.getElementById('mini-send-target').value = 'obsidian';
            document.getElementById('btn-mini-review').click();
            await new Promise(r => setTimeout(r, 350));
            document.getElementById('btn-mini-send').click();
            await new Promise(r => setTimeout(r, 250));
            const statusDuring = document.getElementById('kataros-node-status').textContent;
            await new Promise(r => setTimeout(r, 1600));
            const statusAfter = document.getElementById('kataros-node-status').textContent;
            return {
              previewOpen: !document.getElementById('mini-review-preview').classList.contains('hidden'),
              reviewText: document.getElementById('mini-review-text').textContent,
              statusDuring,
              statusAfter
            };
          })()
        `);
        console.log('MPE_MINI_AI_TEST:', JSON.stringify(miniRes));
        await new Promise((r) => setTimeout(r, 300));
        const imgMini = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_8_mini_assistant.png'), imgMini.toPNG());

        // Teste 9: Chat Lateral com AI Kataros (Drawer)
        const chatRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.getElementById('side-chat-drawer').classList.remove('hidden');
            const chatInput = document.getElementById('side-chat-input');
            chatInput.value = 'Como estruturar minhas notas de projetos no Obsidian?';
            document.getElementById('btn-side-chat-send').click();
            await new Promise(r => setTimeout(r, 300));
            const statusDuring = document.getElementById('kataros-node-status').textContent;
            await new Promise(r => setTimeout(r, 1600));
            const statusAfter = document.getElementById('kataros-node-status').textContent;
            const msgs = Array.from(document.querySelectorAll('#side-chat-messages .side-msg-content')).map(el => el.textContent);
            return { statusDuring, statusAfter, lastReply: msgs[msgs.length - 1] };
          })()
        `);
        console.log('MPE_CHAT_AI_TEST:', JSON.stringify(chatRes));
        await new Promise((r) => setTimeout(r, 350));
        const imgChat = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_9_side_chat.png'), imgChat.toPNG());

        // Teste 10: Painel Organizador (Arquithon M.P.E)
        mainWindow.setBounds(screen.getPrimaryDisplay().bounds);
        const orgRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            document.body.classList.remove('mode-mini-assistant');
            document.getElementById('mini-assistant-overlay').classList.add('hidden');
            document.getElementById('side-chat-drawer').classList.add('hidden');
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
        fs.writeFileSync(path.join(outDir, 'verify_10_organizer.png'), imgOrg.toPNG());

        // Teste 11: Guia Rapido, /boost & Kits Minimos
        const guideRes = await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const backBtn = document.getElementById('btn-org-back-astrolabe');
            if (backBtn) backBtn.click();
            await new Promise(r => setTimeout(r, 200));
            const openGuide = document.getElementById('btn-open-guide');
            if (openGuide) openGuide.click();
            await new Promise(r => setTimeout(r, 350));
            return {
              guideOpen: !document.getElementById('modal-guide').classList.contains('hidden'),
              kitsCount: document.querySelectorAll('#guide-kits-grid .kit-card').length,
              perfTextLen: (document.getElementById('guide-perf-metrics').textContent || '').length
            };
          })()
        `);
        console.log('MPE_GUIDE_BOOST_TEST:', JSON.stringify(guideRes));
        await new Promise((r) => setTimeout(r, 250));
        const imgGuide = await mainWindow.webContents.capturePage();
        fs.writeFileSync(path.join(outDir, 'verify_11_guide_boost.png'), imgGuide.toPNG());

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

// Impede encerramento do processo quando a janela estiver minimizada em segundo plano
app.on('window-all-closed', (e) => {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }
});

async function summonHud({ x, y, playIntro = false, mode = 'hud-only', source = 'shortcut' } = {}) {
  if (!mainWindow) return;

  // Se nao foi acionado pelo hook de mouse que ja capturou o hwnd,
  // captura o foreground atual antes do mainWindow.show() roubar o foco
  if (source !== 'mouse-hook' && (!hookBridge.lastHwnd || hookBridge.lastHwnd === '0')) {
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

const MINI_DEFAULT_SIZE = { width: 576, height: 215 };
let miniDragTimer = null;

function stopMiniDrag() {
  if (miniDragTimer) {
    clearInterval(miniDragTimer);
    miniDragTimer = null;
  }
}

// Arrasto da janela compacta: segue o cursor nativo enquanto o botao estiver pressionado
function startMiniDrag() {
  if (!mainWindow) return;
  stopMiniDrag();
  const start = screen.getCursorScreenPoint();
  const [wx, wy] = mainWindow.getPosition();
  const offX = start.x - wx;
  const offY = start.y - wy;
  miniDragTimer = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible()) {
      stopMiniDrag();
      return;
    }
    const p = screen.getCursorScreenPoint();
    const [w, h] = mainWindow.getSize();
    mainWindow.setBounds({ x: p.x - offX, y: p.y - offY, width: w, height: h });
  }, 8);
  // Salvaguarda caso o evento de soltura se perca
  const timerRef = miniDragTimer;
  setTimeout(() => {
    if (miniDragTimer === timerRef) stopMiniDrag();
  }, 30000);
}

function resizeMiniWindow({ width, height } = {}) {
  if (!mainWindow || typeof width !== 'number' || typeof height !== 'number') return;
  const b = mainWindow.getBounds();
  const display = screen.getDisplayMatching(b);
  const wa = display.workArea;
  const w = Math.max(260, Math.min(Math.round(width), wa.width));
  const h = Math.max(120, Math.min(Math.round(height), wa.height));
  const x = Math.max(wa.x, Math.min(b.x, wa.x + wa.width - w));
  const y = Math.max(wa.y, Math.min(b.y, wa.y + wa.height - h));
  mainWindow.setBounds({ x, y, width: w, height: h });
}

async function summonMiniAssistant({ x, y, source = 'mouse-hook', openChat = false } = {}) {
  if (!mainWindow) return;

  if (source !== 'mouse-hook' && (!hookBridge.lastHwnd || hookBridge.lastHwnd === '0')) {
    await hookBridge.refreshForegroundWindow();
  }

  const cursor = screen.getCursorScreenPoint();
  const targetX = typeof x === 'number' ? x : cursor.x;
  const targetY = typeof y === 'number' ? y : cursor.y;

  // Janela compacta e flutuante proxima ao cursor (nao ocupa a tela inteira)
  stopMiniDrag();
  const currentDisplay = screen.getDisplayNearestPoint({ x: targetX, y: targetY });
  const wa = currentDisplay.workArea;
  const w = MINI_DEFAULT_SIZE.width;
  const h = MINI_DEFAULT_SIZE.height;
  let winX = targetX + 18;
  let winY = targetY + 18;
  if (winX + w > wa.x + wa.width) winX = targetX - w - 18;
  if (winY + h > wa.y + wa.height) winY = targetY - h - 18;
  winX = Math.max(wa.x, Math.min(winX, wa.x + wa.width - w));
  winY = Math.max(wa.y, Math.min(winY, wa.y + wa.height - h));
  mainWindow.setBounds({ x: Math.round(winX), y: Math.round(winY), width: w, height: h });

  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.webContents.send('mpe:mini-assistant-summoned', {
    x: targetX - winX,
    y: targetY - winY,
    source,
    openChat: Boolean(openChat),
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
      label: 'Abrir AI Kataros (Mini Assistente)',
      click: () => summonMiniAssistant({ source: 'tray-mini' })
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
    // Abre o Circulo 3D/2D Astrolabio Estrelado com animacao de pulso estelar reforçada
    summonHud({ x, y, playIntro: false, mode: 'hud-only', source: 'mouse-hook' });
  });

  hookBridge.on('trigger-mini', ({ x, y }) => {
    // Quando acionado via Shift + Ctrl + Botao Direito do Mouse:
    // Abre o Mini Assistente Flutuante (Lower Third Sci-Fi) com revisao e acoes ageis
    summonMiniAssistant({ x, y, source: 'mouse-hook' });
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

  try {
    globalShortcut.register('CommandOrControl+Shift+J', () => {
      summonMiniAssistant({ source: 'keyboard-shortcut' });
    });
  } catch (err) {
    console.warn('[M.P.E Shortcut] Atalho Mini Assistente nao pode ser registrado:', err.message);
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

  ipcMain.handle('mpe:save-named-print', async (_event, payload) => {
    return actionExecutor.saveNamedPrint(
      Object.assign({}, payload, { localAiService })
    );
  });

  ipcMain.handle('mpe:send-text-telegram', async (_event, { text, target, keepOpen }) => {
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

  ipcMain.handle('mpe:list-open-windows', async () => {
    return await hookBridge.listOpenWindows();
  });

  ipcMain.handle('mpe:copy-text', (_event, text) => {
    clipboard.writeText(text || '');
    return { ok: true };
  });

  // I.A Local & Obsidian Handlers
  ipcMain.handle('mpe:ai-review', async (_event, { text }) => {
    return await localAiService.reviewText(text);
  });

  ipcMain.handle('mpe:ai-draft', async (_event, { prompt, context }) => {
    return await localAiService.draftText(prompt, context);
  });

  ipcMain.handle('mpe:ai-classify-obsidian', async (_event, { text, title }) => {
    return await localAiService.classifyForObsidian(text, title);
  });

  ipcMain.handle('mpe:save-to-obsidian', async (_event, { title, text, folder, tags }) => {
    return await localAiService.saveToObsidian({ title, text, folder, tags });
  });

  ipcMain.handle('mpe:ai-save-document', async (_event, payload) => {
    return localAiService.saveDocumentFile(payload);
  });

  ipcMain.handle('mpe:ai-list-documents', async (_event, { category } = {}) => {
    return {
      ok: true,
      documents: localAiService.listDocuments(category || ''),
      documentsDir: localAiService.documents.getDocumentsFolder()
    };
  });

  ipcMain.handle('mpe:ai-remove-document', async (_event, { idOrIndex } = {}) => {
    return {
      ok: true,
      removed: localAiService.removeDocument(idOrIndex)
    };
  });

  ipcMain.handle('mpe:select-document-file', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: 'Selecionar Arquivo ou Extrato para I.A Local (M.P.E)',
      filters: [
        {
          name: 'Documentos e Extratos',
          extensions: ['ofx', 'qfx', 'csv', 'txt', 'md', 'json', 'log', 'tsv', 'html', 'pdf']
        },
        { name: 'Todos os Arquivos', extensions: ['*'] }
      ],
      properties: ['openFile']
    });
    if (res.canceled || !res.filePaths.length) return null;
    return res.filePaths[0];
  });

  // Chat lateral: comandos, memoria, treino e geracao com streaming
  ipcMain.handle('mpe:ai-chat', async (event, { message, mode, tone, requestId } = {}) => {
    const sender = event.sender;
    const send = (channel, data) => {
      if (!sender.isDestroyed()) sender.send(channel, Object.assign({ requestId }, data));
    };
    return await localAiService.chat(
      { message, mode, tone },
      {
        onChunk: (delta) => send('mpe:ai-chat-chunk', { delta }),
        onStatus: (status) => send('mpe:ai-chat-status', { status })
      }
    );
  });

  ipcMain.handle('mpe:ai-status', async (_event, { warmUp } = {}) => {
    if (warmUp) localAiService.warmUp();
    return await localAiService.getStatus();
  });

  ipcMain.handle('mpe:get-perf-profile', async () => {
    return localAiService.getPerformanceProfile();
  });

  ipcMain.handle('mpe:set-boost-mode', async (_event, mode) => {
    const profile = await localAiService.setBoostMode(mode, { restartIfOnline: true });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('mpe:config-updated', configManager.get());
    }
    return profile;
  });

  ipcMain.handle('mpe:open-mini-assistant', async (_event, payload = {}) => {
    await summonMiniAssistant({ source: 'ui-button', openChat: Boolean(payload && payload.openChat) });
    return { ok: true };
  });

  ipcMain.handle('mpe:ensure-shortcuts', async () => {
    return await startupManager.createAppShortcuts();
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

  ipcMain.on('mpe:mini-drag-start', () => startMiniDrag());
  ipcMain.on('mpe:mini-drag-end', () => stopMiniDrag());
  ipcMain.on('mpe:mini-resize', (_e, size) => resizeMiniWindow(size));

  ipcMain.handle('mpe:hide-hud', () => {
    stopMiniDrag();
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
        configManager.save(cfg);
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
  if (cfg.system && cfg.system.startWithWindows) {
    await startupManager.setStartup(true);
  } else {
    await startupManager.createAppShortcuts();
  }

  setupIpcHandlers();
  createWindow();
  createSystemTray();
  setupHooksAndShortcuts();
  logDebug(`[APP WHEN-READY DONE] All subsystems loaded`);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  hookBridge.stop();
});
