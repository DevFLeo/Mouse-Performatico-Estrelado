'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const isolation = require('./isolation');
const { launchElectronWithCdp, sleep } = require('./cdpClient');

async function launchIsolatedApp(ctx, testId, options = {}) {
  isolation.assertCodeIsolationReady();

  const undoSnap = isolation.snapshotFileState(isolation.PROD_UNDO_PATH);
  const ws = isolation.createIsolatedWorkspace(ctx.runId, testId, options);
  ctx.processManager.registerToken(ws.runToken);
  ctx.processManager.registerCleanup(() => {
    isolation.restoreFileState(isolation.PROD_UNDO_PATH, undoSnap);
    ws.cleanup();
  });

  const args = ws.buildElectronArgs(options.extraArgs || []);
  const env = ws.buildElectronEnv(options.extraEnv || {});

  const session = await launchElectronWithCdp({
    electronExe: isolation.ELECTRON_EXE,
    args,
    env,
    cwd: isolation.CODE_DIR,
    userDataDir: ws.userDataDir,
    processManager: ctx.processManager,
    timeoutMs: options.launchTimeoutMs || 15000,
    verbose: ctx.verbose
  });

  const mainPage = await session.connectTarget('index.html', 12000);
  await mainPage.waitForFunction(() => Boolean(window.mpeApi), [], 8000);

  if (!options.keepSplash && !options.startup) {
    await mainPage.waitForFunction(() => {
      const splash = document.getElementById('splash-screen');
      if (!splash || splash.classList.contains('hidden')) return true;
      splash.click();
      return splash.classList.contains('hidden');
    }, [], 6000).catch(() => {});
    await sleep(150);
  }

  const close = async () => {
    try {
      await mainPage.eval(() => window.mpeApi && window.mpeApi.quitApp && window.mpeApi.quitApp()).catch(() => {});
      await session.waitForExit(3500).catch(() => {});
    } catch (_) {}
    await session.close();
    isolation.restoreFileState(isolation.PROD_UNDO_PATH, undoSnap);
    ws.cleanup();
  };

  return { ws, session, mainPage, close };
}

async function connectMiniPage(session, timeoutMs = 8000) {
  const page = await session.connectTarget('mini-astrolabe.html', timeoutMs);
  await page.waitForFunction(() => Boolean(window.mpeApi), [], 6000);
  return page;
}

async function connectRecorderPage(session, timeoutMs = 8000) {
  const page = await session.connectTarget('recorder-overlay.html', timeoutMs);
  await page.waitForFunction(() => Boolean(window.mpeApi), [], 6000);
  return page;
}

async function launchClickTargetWindow(ctx, mockServer, bounds = { x: 120, y: 120, width: 260, height: 260 }) {
  const token = `mpe_e2e_${ctx.runId}_clicktarget_${Date.now()}`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${token}_`));
  const userDataDir = path.join(dir, 'ud');
  fs.mkdirSync(userDataDir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'mpe-e2e-click-target', version: '1.0.0', main: 'main.js' }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(dir, 'main.js'),
    [
      "const { app, BrowserWindow } = require('electron');",
      'app.whenReady().then(() => {',
      `  const w = new BrowserWindow({ x: ${bounds.x}, y: ${bounds.y}, width: ${bounds.width}, height: ${bounds.height}, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false });`,
      `  w.loadURL(${JSON.stringify(mockServer.url('/click-target'))});`,
      '});',
      "app.on('window-all-closed', () => app.quit());"
    ].join('\n'),
    'utf8'
  );

  ctx.processManager.registerToken(token);
  ctx.processManager.registerCleanup(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  });

  const session = await launchElectronWithCdp({
    electronExe: isolation.ELECTRON_EXE,
    args: [dir, `--user-data-dir=${userDataDir}`, '--remote-debugging-port=0', `--mpe-e2e-token=${token}`],
    env: process.env,
    cwd: dir,
    userDataDir,
    processManager: ctx.processManager,
    timeoutMs: 12000
  });

  const page = await session.connectTarget('click-target', 8000);
  await page.waitForSelector('#target', 5000);
  await sleep(200);

  return {
    session,
    page,
    bounds,
    close: async () => {
      await session.close();
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (_) {}
    }
  };
}

function spawnHookDaemon(ctx, extraArgs = []) {
  const proc = ctx.processManager.spawnProcess(isolation.MPE_HOOK_EXE, extraArgs, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const lines = [];
  let buffer = '';
  let stderr = '';

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop();
    for (const line of parts) {
      if (line.trim()) lines.push(line.trim());
    }
  });
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  async function waitForLine(regex, timeoutMs = 4000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = lines.find((l) => regex.test(l));
      if (hit) return hit;
      await sleep(30);
    }
    throw new Error(`MpeHook timeout (${timeoutMs}ms) waiting for ${regex}. lines=${JSON.stringify(lines)} stderr=${stderr}`);
  }

  function send(cmd) {
    if (!proc.killed && proc.stdin && proc.stdin.writable) {
      proc.stdin.write(cmd.endsWith('\n') ? cmd : `${cmd}\n`);
    }
  }

  async function quit() {
    send('QUIT');
    await new Promise((resolve) => {
      const t = setTimeout(() => {
        ctx.processManager.killPidTreeSync(proc.pid);
        resolve();
      }, 2000);
      proc.once('close', () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  return { proc, lines, getStderr: () => stderr, waitForLine, send, quit };
}

function runHookCli(args = [], timeoutMs = 6000) {
  const res = spawnSync(isolation.MPE_HOOK_EXE, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: timeoutMs
  });
  return {
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
}

function runPythonCli(args = [], opts = {}) {
  const res = spawnSync('python', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeoutMs || 10000,
    env: opts.env || process.env,
    cwd: opts.cwd
  });
  return {
    code: res.status,
    stdout: (res.stdout || '').trim(),
    stderr: (res.stderr || '').trim()
  };
}

function setOsCursor(x, y) {
  const py = `import ctypes; u=ctypes.windll.user32; u.SetProcessDPIAware(); u.SetCursorPos(${Math.round(x)}, ${Math.round(y)})`;
  const r = runPythonCli(['-c', py], { timeoutMs: 4000 });
  assert.strictEqual(r.code, 0, `SetCursorPos failed: ${r.stderr}`);
}

function performWin32Click(x, y, button = 'left') {
  const down = button === 'right' ? 0x0008 : 0x0002;
  const up = button === 'right' ? 0x0010 : 0x0004;
  const py = [
    'import ctypes, sys, time',
    "u = ctypes.WinDLL('user32', use_last_error=True)",
    'u.SetProcessDPIAware()',
    `ok = u.SetCursorPos(${Math.round(x)}, ${Math.round(y)})`,
    'if not ok:',
    '    sys.stderr.write(f"SetCursorPos failed (err={ctypes.get_last_error()}, desktop locked or restricted)\\n")',
    '    sys.exit(2)',
    'time.sleep(0.03)',
    `u.mouse_event(${down}, 0, 0, 0, 0)`,
    'time.sleep(0.03)',
    `u.mouse_event(${up}, 0, 0, 0, 0)`
  ].join('\n');
  const r = runPythonCli(['-c', py], { timeoutMs: 5000 });
  assert.strictEqual(r.code, 0, `Win32 click failed: ${r.stderr}`);
}

async function getMiniHubAndSlots(miniPage) {
  return miniPage.eval(() => {
    const hub =
      document.querySelector('[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot') ||
      document.body.firstElementChild;
    const slotNodes = Array.from(
      document.querySelectorAll('.fan-slot-btn, [data-slot-number], [data-slot], [data-slot-index], .mini-slot-btn, .mini-fan-slot, .fan-slot, button[data-index]')
    );
    const hubRect = hub ? hub.getBoundingClientRect() : null;
    const isNodeVisible = (node) => {
      let cur = node;
      while (cur && cur.nodeType === 1) {
        const s = getComputedStyle(cur);
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) <= 0.1) {
          return false;
        }
        cur = cur.parentElement;
      }
      return true;
    };
    const slots = slotNodes.map((el, idx) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        idx,
        slotAttr: el.getAttribute('data-slot-number') || el.getAttribute('data-slot') || el.getAttribute('data-slot-index') || el.getAttribute('data-index') || '',
        text: (el.innerText || el.textContent || '').trim(),
        title: el.getAttribute('title') || el.getAttribute('aria-label') || '',
        visible: isNodeVisible(el) && r.width > 0 && r.height > 0,
        opacity: parseFloat(cs.opacity),
        fontSize: parseFloat(cs.fontSize) || 0,
        fontWeight: parseInt(cs.fontWeight, 10) || 400,
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 }
      };
    });
    return {
      hubRect: hubRect
        ? { x: hubRect.x, y: hubRect.y, width: hubRect.width, height: hubRect.height, cx: hubRect.left + hubRect.width / 2, cy: hubRect.top + hubRect.height / 2 }
        : null,
      slots
    };
  });
}

async function getMiniRotorSample(miniPage) {
  return miniPage.eval(() => {
    const el =
      document.querySelector('[data-mini-rotor], .mini-rotor, .mini-rotator, #mini-rotator, .mini-hub-ring') ||
      document.querySelector('[data-mini-hub], #mini-hub, #mini-core, .mini-hub');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      selector: el.id || el.className || el.tagName,
      playState: cs.animationPlayState,
      transform: cs.transform
    };
  });
}

async function clickConsentDecision(mainPage, accept, opts = {}) {
  const allowIpcFallback = Boolean(opts && opts.allowIpcFallback);
  // O modal de aceite aparece apos o carregamento inicial; espera ate 5s em vez de falhar na corrida.
  await mainPage
    .waitForFunction(() => {
      const splash = document.getElementById('splash-screen');
      if (splash && !splash.classList.contains('hidden')) splash.click();
      // Depois de uma recusa o modal so volta pelo botao 'Autorizar Agora' (caminho real do usuario)
      const reopen = document.getElementById('btn-reopen-consent');
      if (reopen && reopen.offsetParent !== null) reopen.click();
      const modal = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
      if (!modal) return false;
      const cs = getComputedStyle(modal);
      return !modal.classList.contains('hidden') && cs.display !== 'none' && cs.visibility !== 'hidden';
    }, [], 5000)
    .catch(() => {});
  const clicked = await mainPage.eval((doAccept) => {
    const modal = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
    if (!modal) return { ok: false, reason: 'Consent modal element not found in DOM' };
    const mcs = getComputedStyle(modal);
    if (modal.classList.contains('hidden') || mcs.display === 'none' || mcs.visibility === 'hidden') {
      return { ok: false, reason: 'Consent modal is hidden' };
    }
    const sel = doAccept
      ? '#btn-consent-accept, [data-consent-accept], button[data-action="accept"]'
      : '#btn-consent-decline, [data-consent-decline], button[data-action="decline"]';
    const btn = modal.querySelector(sel);
    if (!btn) return { ok: false, reason: `Consent decision button not found (${sel})` };
    const bcs = getComputedStyle(btn);
    const r = btn.getBoundingClientRect();
    if (btn.disabled || bcs.display === 'none' || bcs.visibility === 'hidden' || r.width <= 0 || r.height <= 0) {
      return { ok: false, reason: `Consent decision button not clickable (${sel})` };
    }
    btn.click();
    return { ok: true };
  }, accept);

  if (clicked && clicked.ok) {
    await mainPage.waitForFunction(() => {
      const modal = document.querySelector('#modal-consent, [data-consent-modal], .consent-modal');
      if (!modal) return true;
      const cs = getComputedStyle(modal);
      return modal.classList.contains('hidden') || cs.display === 'none' || cs.visibility === 'hidden';
    }, [], 4000);
    return true;
  }

  if (!allowIpcFallback) {
    throw new Error((clicked && clicked.reason) || 'Consent UI modal not available');
  }

  const res = await mainPage.eval((doAccept) => {
    if (!window.mpeApi || !window.mpeApi.setConsentDecision) return null;
    return window.mpeApi.setConsentDecision(doAccept, {
      backgroundExecution: doAccept,
      launchAppsAndLinks: doAccept,
      pythonAutomation: doAccept
    });
  }, accept);
  return res;
}

async function quitAppGracefully(mainPage, session, timeoutMs = 6000) {
  await mainPage.eval(() => {
    if (window.mpeApi && window.mpeApi.quitApp) {
      window.mpeApi.quitApp();
    }
  }).catch((err) => {
    const msg = err && err.message ? err.message : '';
    if (!msg.includes('closed') && !msg.includes('ECONNRESET')) {
      throw err;
    }
  });
  return session.waitForExit(timeoutMs);
}

module.exports = {
  launchIsolatedApp,
  quitAppGracefully,
  connectMiniPage,
  connectRecorderPage,
  launchClickTargetWindow,
  spawnHookDaemon,
  runHookCli,
  runPythonCli,
  setOsCursor,
  performWin32Click,
  getMiniHubAndSlots,
  getMiniRotorSample,
  clickConsentDecision,
  sleep
};
