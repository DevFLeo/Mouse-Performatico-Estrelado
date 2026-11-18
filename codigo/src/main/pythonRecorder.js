const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RESERVED_WINDOWS_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EMOJI_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[\uFE0E\uFE0F\u200D\u20E3]|[\u{E0020}-\u{E007F}])/gu;
const CONTROL_CHARS_RE = /[\x00-\x1F\x7F]/g;

function getElectronApi() {
  try {
    return require('electron') || {};
  } catch (_) {
    return {};
  }
}

function resolveRealPath(targetPath) {
  if (typeof targetPath !== 'string' || !targetPath || targetPath.includes('\0')) {
    return null;
  }
  const resolved = path.resolve(targetPath);
  const pendingSegments = [];
  let cursor = resolved;
  while (cursor) {
    let lstat = null;
    try {
      lstat = fs.lstatSync(cursor);
    } catch (_) {
      lstat = null;
    }
    if (lstat) {
      try {
        const real =
          typeof fs.realpathSync.native === 'function'
            ? fs.realpathSync.native(cursor)
            : fs.realpathSync(cursor);
        return pendingSegments.length > 0
          ? path.join(real, ...pendingSegments.reverse())
          : real;
      } catch (_) {
        return null;
      }
    }
    const parent = path.dirname(cursor);
    if (!parent || parent === cursor) break;
    pendingSegments.push(path.basename(cursor));
    cursor = parent;
  }
  return resolved;
}

function isPathInsideDir(targetPath, baseDir) {
  if (
    typeof targetPath !== 'string' ||
    typeof baseDir !== 'string' ||
    !targetPath ||
    !baseDir ||
    targetPath.includes('\0') ||
    baseDir.includes('\0')
  ) {
    return false;
  }
  const resolvedTarget = resolveRealPath(targetPath);
  const resolvedBase = resolveRealPath(baseDir);
  if (!resolvedTarget || !resolvedBase) {
    return false;
  }
  if (process.platform === 'win32') {
    const t = resolvedTarget.toLowerCase();
    const b = resolvedBase.toLowerCase();
    return t.startsWith(b.endsWith(path.sep) ? b : b + path.sep);
  }
  return resolvedTarget.startsWith(resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep);
}

function stripEmojis(text) {
  if (text === undefined || text === null) return '';
  return String(text)
    .replace(EMOJI_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseStrictFiniteNumber(val) {
  if (typeof val === 'number') {
    return Number.isFinite(val) ? val : null;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

function sanitizeSteps(rawSteps) {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    return { ok: false, error: 'Nenhum passo valido para salvar.' };
  }

  const clean = [];
  for (let i = 0; i < rawSteps.length; i += 1) {
    const item = rawSteps[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `Passo ${i + 1} invalido.` };
    }
    const x = parseStrictFiniteNumber(item.x);
    const y = parseStrictFiniteNumber(item.y);
    if (x === null || y === null) {
      return { ok: false, error: `Coordenadas invalidas no passo ${i + 1}.` };
    }

    let button = 'left';
    if (item.button !== undefined && item.button !== null) {
      if (typeof item.button !== 'string') {
        return { ok: false, error: `Botao nao suportado no passo ${i + 1}.` };
      }
      const btnNorm = item.button.trim().toLowerCase();
      if (btnNorm !== 'left' && btnNorm !== 'right') {
        return { ok: false, error: `Botao nao suportado no passo ${i + 1}: ${btnNorm}` };
      }
      button = btnNorm;
    }

    let waitRaw = 0;
    if (item.waitMs !== undefined) {
      const parsedWait = parseStrictFiniteNumber(item.waitMs);
      if (parsedWait === null || parsedWait < 0) {
        return { ok: false, error: `Tempo de espera invalido no passo ${i + 1}.` };
      }
      waitRaw = parsedWait;
    }

    clean.push({
      x: Math.round(x),
      y: Math.round(y),
      button,
      waitMs: Math.round(waitRaw)
    });
  }

  return { ok: true, steps: clean };
}

function sanitizeScriptBaseName(rawName) {
  let slug = String(rawName || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(EMOJI_RE, '')
    .replace(CONTROL_CHARS_RE, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .toLowerCase();

  if (!slug) {
    slug = 'auto_script';
  }
  if (RESERVED_WINDOWS_NAMES.test(slug)) {
    slug = `script_${slug}`;
  }
  if (slug.length > 48) {
    slug = slug.slice(0, 48).replace(/^[_-]+|[_-]+$/g, '');
  }
  if (!slug) {
    slug = 'auto_script';
  }
  if (RESERVED_WINDOWS_NAMES.test(slug)) {
    slug = `script_${slug}`;
  }
  return slug;
}

function buildUniqueScriptPath(rawName, scriptsDir, existingFilePaths = []) {
  const base = sanitizeScriptBaseName(rawName);
  const resolvedDir = path.resolve(scriptsDir);
  const usedLower = new Set(
    existingFilePaths
      .filter((p) => typeof p === 'string' && p.length > 0)
      .map((p) => path.basename(p).toLowerCase())
  );

  let counter = 1;
  while (counter < 10000) {
    const fileName = counter === 1 ? `${base}.py` : `${base}_${counter}.py`;
    const candidate = path.resolve(resolvedDir, fileName);
    if (!isPathInsideDir(candidate, resolvedDir)) {
      throw new Error('Caminho de script fora da pasta permitida.');
    }
    if (!fs.existsSync(candidate) && !usedLower.has(fileName.toLowerCase())) {
      return { fileName, absPath: candidate, base };
    }
    counter += 1;
  }
  const fallbackName = `${base}_${Date.now()}.py`;
  const fallbackPath = path.resolve(resolvedDir, fallbackName);
  if (!isPathInsideDir(fallbackPath, resolvedDir)) {
    throw new Error('Caminho de script fora da pasta permitida.');
  }
  return { fileName: fallbackName, absPath: fallbackPath, base };
}

function generatePythonSource(steps) {
  const stepLines = steps.map(
    (s) => `    (${s.x}, ${s.y}, "${s.button}", ${s.waitMs}),`
  );

  return [
    '# -*- coding: utf-8 -*-',
    '"""Auto-script gerado pelo M.P.E (Mouse Performatico Estrelado)."""',
    '',
    'import argparse',
    'import ctypes',
    'import sys',
    'import time',
    '',
    'MOUSEEVENTF_LEFTDOWN = 0x0002',
    'MOUSEEVENTF_LEFTUP = 0x0004',
    'MOUSEEVENTF_RIGHTDOWN = 0x0008',
    'MOUSEEVENTF_RIGHTUP = 0x0010',
    'VK_ESCAPE = 0x1B',
    'EXIT_ABORTED_BY_ESC = 2',
    '',
    '',
    'class AbortedByEsc(Exception):',
    '    pass',
    '',
    '',
    'def check_abort(user32):',
    '    if user32 is not None and (user32.GetAsyncKeyState(VK_ESCAPE) & 0x8000):',
    '        raise AbortedByEsc()',
    '',
    '',
    'def wait_with_abort(user32, wait_ms):',
    '    remaining = wait_ms / 1000.0',
    '    while remaining > 0:',
    '        check_abort(user32)',
    '        chunk = 0.05 if remaining > 0.05 else remaining',
    '        time.sleep(chunk)',
    '        remaining -= chunk',
    '',
    '# (x, y, button, wait_ms)',
    'STEPS = [',
    ...stepLines,
    ']',
    '',
    '',
    'def replay(dry_run=False):',
    '    if not dry_run:',
    '        user32 = ctypes.windll.user32',
    '        try:',
    '            user32.SetProcessDPIAware()',
    '        except Exception:',
    '            pass',
    '    else:',
    '        user32 = getattr(ctypes, "windll", None)',
    '        if user32 is not None:',
    '            user32 = user32.user32',
    '',
    '    for idx, step in enumerate(STEPS, start=1):',
    '        if len(step) != 4:',
    '            raise ValueError(f"Invalid step at index {idx}: {step}")',
    '        x, y, button, wait_ms = step',
    '        x = int(x)',
    '        y = int(y)',
    '        wait_ms = int(wait_ms)',
    '        if button not in ("left", "right"):',
    '            raise ValueError(f"Unsupported mouse button at step {idx}: {button}")',
    '        if wait_ms < 0:',
    '            raise ValueError(f"Negative wait_ms at step {idx}: {wait_ms}")',
    '',
    '        if dry_run:',
    '            print(f"[DRY-RUN] step={idx} button={button} x={x} y={y} wait_ms={wait_ms}")',
    '            continue',
    '',
    '        if wait_ms > 0:',
    '            wait_with_abort(user32, wait_ms)',
    '        check_abort(user32)',
    '',
    '        if not user32.SetCursorPos(x, y):',
    '            raise OSError(f"SetCursorPos failed at step {idx} ({x}, {y})")',
    '        time.sleep(0.02)',
    '',
    '        if button == "right":',
    '            user32.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0)',
    '            time.sleep(0.02)',
    '            user32.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0)',
    '        else:',
    '            user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)',
    '            time.sleep(0.02)',
    '            user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)',
    '',
    '        print(f"[EXEC] step={idx} button={button} x={x} y={y} wait_ms={wait_ms}")',
    '',
    '    sys.stdout.flush()',
    '    return 0',
    '',
    '',
    'def main():',
    '    parser = argparse.ArgumentParser(description="M.P.E Python Auto-Script Runner")',
    '    parser.add_argument(',
    '        "--dry-run",',
    '        action="store_true",',
    '        help="Validate and print steps without moving the cursor or clicking",',
    '    )',
    '    args = parser.parse_args()',
    '    try:',
    '        return replay(dry_run=args.dry_run)',
    '    except AbortedByEsc:',
    '        print("[ABORT] Execucao interrompida pela tecla ESC")',
    '        sys.stdout.flush()',
    '        return EXIT_ABORTED_BY_ESC',
    '',
    '',
    'if __name__ == "__main__":',
    '    sys.exit(main())',
    ''
  ].join('\n');
}

function normalizeScheduleForSave(rawSchedule) {
  const src = rawSchedule && typeof rawSchedule === 'object' ? rawSchedule : {};
  const rawTime = typeof src.timeHHMM === 'string' ? src.timeHHMM.trim() : '09:00';
  const match = rawTime.match(/^(\d{1,2}):(\d{2})$/);
  let timeHHMM = '09:00';
  if (match) {
    const h = Number(match[1]);
    const m = Number(match[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      timeHHMM = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }
  const normalized = {
    enabled: Boolean(src.enabled),
    timeHHMM,
    mode: src.mode === 'once' ? 'once' : 'daily',
    lastRunKey: null
  };
  if (src.dryRun !== undefined) {
    normalized.dryRun = Boolean(src.dryRun);
  }
  return normalized;
}

function isPointInsideRect(x, y, rect, pad = 2) {
  if (!rect || typeof rect !== 'object') return false;
  const rx = Number(rect.x);
  const ry = Number(rect.y);
  const rw = Number(rect.width);
  const rh = Number(rect.height);
  if (!Number.isFinite(rx) || !Number.isFinite(ry) || !Number.isFinite(rw) || !Number.isFinite(rh)) {
    return false;
  }
  return (
    x >= rx - pad &&
    x <= rx + rw + pad &&
    y >= ry - pad &&
    y <= ry + rh + pad
  );
}

class PythonRecorder {
  constructor(ctx = {}) {
    this.configManager = ctx.configManager || null;
    this.consentManager = ctx.consentManager || null;
    this.actionExecutor = ctx.actionExecutor || null;
    this.hookBridge = ctx.hookBridge || null;
    this.registerWindow = typeof ctx.registerWindow === 'function' ? ctx.registerWindow : null;
    this.broadcastToAllWindows =
      typeof ctx.broadcastToAllWindows === 'function' ? ctx.broadcastToAllWindows : null;
    this.broadcastConfigUpdated =
      typeof ctx.broadcastConfigUpdated === 'function' ? ctx.broadcastConfigUpdated : null;

    this.codeDir = ctx.codeDir ? path.resolve(ctx.codeDir) : path.resolve(__dirname, '..', '..');
    this.rootDir = ctx.rootDir ? path.resolve(ctx.rootDir) : path.resolve(this.codeDir, '..');
    this.explicitScriptsDir = ctx.scriptsDir ? path.resolve(ctx.scriptsDir) : null;
    this._overlayFactory = typeof ctx.overlayFactory === 'function' ? ctx.overlayFactory : null;
    this._BrowserWindow = ctx.BrowserWindow || null;
    this._screen = ctx.screen || null;
    this._globalShortcut = ctx.globalShortcut || null;
    this._waitForHookReadyMs =
      Number.isFinite(Number(ctx.waitForHookReadyMs)) && Number(ctx.waitForHookReadyMs) >= 0
        ? Number(ctx.waitForHookReadyMs)
        : 1500;

    this.isRecording = false;
    this.steps = [];
    this._lastClickTs = 0;
    this._startedAt = 0;
    this.overlayWindow = null;
    this._recClickHandler = null;
    this._startedHookTemp = false;
    this._escRegistered = false;
    this._hidMainWindow = null;
    this._isStoppingRecording = false;
    this._isStoppingAll = false;
    this._defaultExclusionRect = ctx.exclusionRect || null;
    this._customExclusionRect = null;
    this._idSeq = 0;
  }

  _getBrowserWindowCtor() {
    if (this._BrowserWindow) return this._BrowserWindow;
    const electron = getElectronApi();
    return typeof electron.BrowserWindow === 'function' ? electron.BrowserWindow : null;
  }

  _getScreenApi() {
    if (this._screen) return this._screen;
    const electron = getElectronApi();
    return electron.screen || null;
  }

  _getGlobalShortcutApi() {
    if (this._globalShortcut) return this._globalShortcut;
    const electron = getElectronApi();
    return electron.globalShortcut || null;
  }

  _checkConsent() {
    if (!this.consentManager || typeof this.consentManager.isActionAllowed !== 'function') {
      return null;
    }
    if (!this.consentManager.isActionAllowed('pythonAutomation')) {
      if (typeof this.consentManager.gateResult === 'function') {
        return this.consentManager.gateResult();
      }
      return {
        ok: false,
        blockedByConsent: true,
        message: 'Aceite de primeiro acesso necessario.'
      };
    }
    return null;
  }

  getScriptsDir() {
    if (this.explicitScriptsDir) {
      return this.explicitScriptsDir;
    }
    if (process.env.MPE_SCRIPTS_DIR && String(process.env.MPE_SCRIPTS_DIR).trim()) {
      return path.resolve(String(process.env.MPE_SCRIPTS_DIR).trim());
    }
    if (process.env.MPE_DATA_DIR && String(process.env.MPE_DATA_DIR).trim()) {
      return path.join(path.resolve(String(process.env.MPE_DATA_DIR).trim()), 'scripts');
    }
    if (this.configManager && this.configManager.dataDir) {
      return path.join(path.resolve(this.configManager.dataDir), 'scripts');
    }
    return path.join(this.codeDir, 'data', 'scripts');
  }

  getStatePayload() {
    const lastStep = this.steps.length > 0 ? Object.assign({}, this.steps[this.steps.length - 1]) : null;
    return {
      active: this.isRecording,
      stepCount: this.steps.length,
      lastStep,
      startedAt: this._startedAt || null,
      elapsedMs: this.isRecording && this._startedAt ? Math.max(0, Date.now() - this._startedAt) : 0
    };
  }

  _broadcastState() {
    const payload = this.getStatePayload();
    if (this.broadcastToAllWindows) {
      try {
        this.broadcastToAllWindows('mpe:py-recording-state', payload);
      } catch (_) {}
    }
    if (
      this.overlayWindow &&
      (typeof this.overlayWindow.isDestroyed !== 'function' || !this.overlayWindow.isDestroyed()) &&
      this.overlayWindow.webContents &&
      (typeof this.overlayWindow.webContents.isDestroyed !== 'function' ||
        !this.overlayWindow.webContents.isDestroyed()) &&
      typeof this.overlayWindow.webContents.send === 'function' &&
      !this.broadcastToAllWindows
    ) {
      try {
        this.overlayWindow.webContents.send('mpe:py-recording-state', payload);
      } catch (_) {}
    }
  }

  getOverlayScreenBounds() {
    const screenApi = this._getScreenApi();
    if (this.overlayWindow && typeof this.overlayWindow.getBounds === 'function') {
      try {
        if (typeof this.overlayWindow.isDestroyed === 'function' && this.overlayWindow.isDestroyed()) {
          return this._customExclusionRect || null;
        }
        const dipBounds = this.overlayWindow.getBounds();
        if (dipBounds && typeof dipBounds === 'object') {
          if (screenApi && typeof screenApi.dipToScreenRect === 'function') {
            try {
              const converted = screenApi.dipToScreenRect(this.overlayWindow, dipBounds);
              if (converted && Number.isFinite(converted.x) && Number.isFinite(converted.width)) {
                return converted;
              }
            } catch (_) {}
          }
          let scaleFactor = 1;
          if (screenApi) {
            try {
              if (typeof screenApi.getDisplayMatching === 'function') {
                const disp = screenApi.getDisplayMatching(dipBounds);
                if (disp && Number.isFinite(disp.scaleFactor) && disp.scaleFactor > 0) {
                  scaleFactor = disp.scaleFactor;
                }
              } else if (typeof screenApi.getPrimaryDisplay === 'function') {
                const prim = screenApi.getPrimaryDisplay();
                if (prim && Number.isFinite(prim.scaleFactor) && prim.scaleFactor > 0) {
                  scaleFactor = prim.scaleFactor;
                }
              }
            } catch (_) {}
          }
          return {
            x: Math.round(dipBounds.x * scaleFactor),
            y: Math.round(dipBounds.y * scaleFactor),
            width: Math.round(dipBounds.width * scaleFactor),
            height: Math.round(dipBounds.height * scaleFactor)
          };
        }
      } catch (_) {}
    }
    return this._customExclusionRect || null;
  }

  _isClickInsideOverlay(x, y) {
    const rect = this.getOverlayScreenBounds();
    if (rect && isPointInsideRect(x, y, rect, 2)) {
      return true;
    }
    if (this._customExclusionRect && this._customExclusionRect !== rect) {
      return isPointInsideRect(x, y, this._customExclusionRect, 2);
    }
    return false;
  }

  _handleRecClick(click) {
    if (!this.isRecording || !click || typeof click !== 'object') return;
    const rawX = parseStrictFiniteNumber(click.x);
    const rawY = parseStrictFiniteNumber(click.y);
    if (rawX === null || rawY === null) return;
    const x = Math.round(rawX);
    const y = Math.round(rawY);

    if (this._isClickInsideOverlay(x, y)) {
      return;
    }

    const rawButton = click.rawButton ? String(click.rawButton).trim().toUpperCase() : '';
    const button =
      click.button === 'right' || rawButton === 'R' || rawButton === 'RIGHT' ? 'right' : 'left';
    const parsedTs = parseStrictFiniteNumber(click.timestampMs);
    const ts = parsedTs !== null ? parsedTs : Date.now();
    const waitMs = this.steps.length === 0 ? 0 : Math.max(0, Math.round(ts - this._lastClickTs));
    this._lastClickTs = ts;

    this.steps.push({ x, y, button, waitMs });
    this._broadcastState();
  }

  _detachRecClickListener() {
    if (this.hookBridge && this._recClickHandler) {
      try {
        if (typeof this.hookBridge.off === 'function') {
          this.hookBridge.off('rec-click', this._recClickHandler);
        } else if (typeof this.hookBridge.removeListener === 'function') {
          this.hookBridge.removeListener('rec-click', this._recClickHandler);
        }
      } catch (_) {}
    }
    this._recClickHandler = null;
  }

  _unregisterEscapeShortcut() {
    const gs = this._getGlobalShortcutApi();
    if (this._escRegistered && gs && typeof gs.unregister === 'function') {
      try {
        gs.unregister('Escape');
      } catch (_) {}
    }
    this._escRegistered = false;
  }

  _closeOverlayWindow(destroy = false) {
    const win = this.overlayWindow;
    this.overlayWindow = null;
    if (!win) return;
    try {
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
      if (destroy && typeof win.destroy === 'function') {
        win.destroy();
      } else if (typeof win.close === 'function') {
        win.close();
      } else if (typeof win.destroy === 'function') {
        win.destroy();
      }
    } catch (_) {}
  }

  _createOverlayWindow(options = {}) {
    if (options.showOverlay === false || options.headless === true) {
      return null;
    }

    const screenApi = this._getScreenApi();
    let workArea = { x: 0, y: 0, width: 1280, height: 720 };
    if (screenApi && typeof screenApi.getPrimaryDisplay === 'function') {
      try {
        const disp = screenApi.getPrimaryDisplay();
        if (disp && (disp.workArea || disp.bounds)) {
          workArea = disp.workArea || disp.bounds;
        }
      } catch (_) {}
    }

    const width = 344;
    const height = 58;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + 14);

    let win = null;
    if (this._overlayFactory) {
      win = this._overlayFactory({ width, height, x, y, options });
    } else {
      const BrowserWindow = this._getBrowserWindowCtor();
      if (!BrowserWindow) return null;
      win = new BrowserWindow({
        title: 'M.P.E - Gravacao Ativa',
        width,
        height,
        x,
        y,
        frame: false,
        transparent: true,
        backgroundColor: '#00000000',
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        focusable: false,
        hasShadow: false,
        show: false,
        webPreferences: {
          preload: path.join(this.codeDir, 'src', 'preload', 'preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
          devTools: true,
          backgroundThrottling: false
        }
      });
    }

    if (!win) return null;
    this.overlayWindow = win;

    if (typeof win.setAlwaysOnTop === 'function') {
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
      } catch (_) {}
    }
    if (this.registerWindow) {
      try {
        this.registerWindow('recorder-overlay', win);
      } catch (_) {}
    }

    if (win.webContents && typeof win.webContents.once === 'function') {
      win.webContents.once('did-finish-load', () => {
        if (!this.isRecording || this.overlayWindow !== win) return;
        try {
          if (typeof win.webContents.send === 'function') {
            win.webContents.send('mpe:py-recording-state', this.getStatePayload());
          }
        } catch (_) {}
        try {
          if (typeof win.showInactive === 'function') {
            win.showInactive();
          } else if (typeof win.show === 'function') {
            win.show();
          }
        } catch (_) {}
      });
    }

    if (typeof win.on === 'function') {
      win.on('closed', () => {
        if (this.overlayWindow === win) {
          this.overlayWindow = null;
        }
        if (this.isRecording && !this._isStoppingRecording && !this._isStoppingAll) {
          this.stopRecording({
            reason: 'overlay-closed',
            cancel: this.steps.length === 0
          }).catch(() => {});
        }
      });
    }

    if (typeof win.loadFile === 'function') {
      const htmlPath = path.join(this.codeDir, 'src', 'renderer', 'recorder-overlay.html');
      try {
        const res = win.loadFile(htmlPath);
        if (res && typeof res.catch === 'function') {
          res.catch(() => {});
        }
      } catch (_) {}
    }

    return win;
  }

  _hideMainWindowIfVisible(options = {}) {
    this._hidMainWindow = null;
    if (options.keepMainVisible === true || options.headless === true || options.showOverlay === false) {
      return;
    }
    const BrowserWindow = this._getBrowserWindowCtor();
    if (!BrowserWindow || typeof BrowserWindow.getAllWindows !== 'function') return;
    try {
      const wins = BrowserWindow.getAllWindows();
      const target = wins.find(
        (w) =>
          w &&
          w !== this.overlayWindow &&
          (typeof w.isDestroyed !== 'function' || !w.isDestroyed()) &&
          typeof w.isVisible === 'function' &&
          w.isVisible() &&
          typeof w.getTitle === 'function' &&
          String(w.getTitle() || '').includes('Mouse Performatico Estrelado')
      );
      if (target && typeof target.hide === 'function') {
        target.hide();
        this._hidMainWindow = target;
      }
    } catch (_) {}
  }

  _restoreMainWindowIfHidden(suppress = false) {
    const win = this._hidMainWindow;
    this._hidMainWindow = null;
    if (!win || suppress || this._isStoppingAll) return;
    try {
      if (typeof win.isDestroyed === 'function' && win.isDestroyed()) return;
      if (typeof win.show === 'function') {
        win.show();
      }
      if (typeof win.focus === 'function') {
        win.focus();
      }
    } catch (_) {}
  }

  async _waitForHookReady() {
    if (!this.hookBridge || this.hookBridge.isReady || typeof this.hookBridge.once !== 'function') {
      return;
    }
    if (this._waitForHookReadyMs <= 0) return;

    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          if (typeof this.hookBridge.off === 'function') {
            this.hookBridge.off('ready', onReady);
          } else if (typeof this.hookBridge.removeListener === 'function') {
            this.hookBridge.removeListener('ready', onReady);
          }
        } catch (_) {}
        resolve();
      };
      const onReady = () => finish();
      const timer = setTimeout(finish, this._waitForHookReadyMs);
      this.hookBridge.once('ready', onReady);
    });
  }

  async startRecording(options = {}) {
    const gate = this._checkConsent();
    if (gate) return gate;

    if (this.isRecording) {
      return {
        ok: false,
        active: true,
        stepCount: this.steps.length,
        message: 'Gravacao ja esta ativa.'
      };
    }

    const opts = options && typeof options === 'object' ? options : {};
    this.steps = [];
    this._lastClickTs = 0;
    this._startedAt = Date.now();
    this.isRecording = true;
    this._isStoppingRecording = false;
    this._customExclusionRect = opts.exclusionRect || this._defaultExclusionRect || null;

    this._hideMainWindowIfVisible(opts);
    this._createOverlayWindow(opts);

    if (opts.headless !== true) {
      const gs = this._getGlobalShortcutApi();
      if (gs && typeof gs.register === 'function') {
        try {
          this._escRegistered = Boolean(
            gs.register('Escape', () => {
              this.stopRecording({ reason: 'escape' }).catch(() => {});
            })
          );
        } catch (_) {
          this._escRegistered = false;
        }
      }
    }

    this._detachRecClickListener();
    this._recClickHandler = (click) => this._handleRecClick(click);
    if (this.hookBridge && typeof this.hookBridge.on === 'function') {
      this.hookBridge.on('rec-click', this._recClickHandler);
    }

    this._startedHookTemp = Boolean(this.hookBridge && !this.hookBridge.proc);
    if (this.hookBridge && typeof this.hookBridge.startRecording === 'function') {
      this.hookBridge.startRecording();
      if (this._startedHookTemp && !this.hookBridge.isReady) {
        await this._waitForHookReady();
      }
    }

    if (!this.isRecording) {
      return {
        ok: false,
        active: false,
        cancelled: true,
        stepCount: 0,
        message: 'Gravacao encerrada durante inicializacao.'
      };
    }

    this._broadcastState();
    return {
      ok: true,
      active: true,
      stepCount: 0
    };
  }

  async stopRecording(options = {}) {
    const opts = options && typeof options === 'object' ? options : {};
    const gate = this._checkConsent();
    if (gate && !this.isRecording) {
      return gate;
    }

    if (!this.isRecording) {
      return {
        ok: true,
        active: false,
        cancelled: Boolean(opts.cancel),
        steps: []
      };
    }

    this._isStoppingRecording = true;
    const isCancel = Boolean(opts.cancel);
    const finalSteps = isCancel ? [] : this.steps.map((s) => Object.assign({}, s));

    try {
      this.isRecording = false;
      this._detachRecClickListener();

      if (this.hookBridge && typeof this.hookBridge.stopRecording === 'function') {
        try {
          this.hookBridge.stopRecording();
        } catch (_) {}
      }

      if (
        this._startedHookTemp &&
        this.hookBridge &&
        typeof this.hookBridge.stop === 'function' &&
        (!this.consentManager || !this.consentManager.isActionAllowed('backgroundExecution'))
      ) {
        try {
          await this.hookBridge.stop();
        } catch (_) {}
      }
      this._startedHookTemp = false;

      this._unregisterEscapeShortcut();
      this._closeOverlayWindow(false);
      this._restoreMainWindowIfHidden(Boolean(opts.suppressMainRestore));
      this._customExclusionRect = null;
    } finally {
      this.isRecording = false;
      this._isStoppingRecording = false;
      const lastStep = finalSteps.length > 0 ? Object.assign({}, finalSteps[finalSteps.length - 1]) : null;
      const stoppedPayload = {
        active: false,
        stepCount: finalSteps.length,
        lastStep,
        startedAt: this._startedAt || null,
        elapsedMs: this._startedAt ? Math.max(0, Date.now() - this._startedAt) : 0
      };
      if (this.broadcastToAllWindows) {
        try {
          this.broadcastToAllWindows('mpe:py-recording-state', stoppedPayload);
        } catch (_) {}
      }
    }

    if (gate) {
      return gate;
    }

    if (isCancel) {
      return {
        ok: true,
        active: false,
        cancelled: true,
        steps: []
      };
    }

    if (finalSteps.length === 0) {
      return {
        ok: true,
        active: false,
        cancelled: false,
        steps: []
      };
    }

    if (opts.autoSave || opts.name) {
      const savedRes = await this.saveScript({
        name: opts.name,
        steps: finalSteps,
        schedule: opts.schedule,
        dryRunDefault: opts.dryRunDefault
      });
      if (!savedRes || !savedRes.ok) {
        return savedRes;
      }
      return {
        ok: true,
        active: false,
        steps: finalSteps,
        script: savedRes.script
      };
    }

    return {
      ok: true,
      active: false,
      steps: finalSteps
    };
  }

  _writeFileAtomic(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, content, 'utf8');
      try {
        fs.renameSync(tmpPath, filePath);
      } catch (_) {
        fs.writeFileSync(filePath, content, 'utf8');
      }
    } finally {
      try {
        if (fs.existsSync(tmpPath)) {
          fs.unlinkSync(tmpPath);
        }
      } catch (_) {}
    }
  }

  async saveScript(payload = {}) {
    const gate = this._checkConsent();
    if (gate) return gate;

    const opts = payload && typeof payload === 'object' ? payload : {};
    const stepValidation = sanitizeSteps(opts.steps);
    if (!stepValidation.ok) {
      return { ok: false, error: stepValidation.error };
    }
    const cleanSteps = stepValidation.steps;

    const scriptsDir = this.getScriptsDir();
    if (!fs.existsSync(scriptsDir)) {
      fs.mkdirSync(scriptsDir, { recursive: true });
    }

    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const currentScripts = Array.isArray(cfg && cfg.autoScripts) ? cfg.autoScripts.slice() : [];
    const existingPaths = currentScripts.map((s) => s && s.filePath).filter(Boolean);

    const { absPath } = buildUniqueScriptPath(opts.name, scriptsDir, existingPaths);
    const pySource = generatePythonSource(cleanSteps);
    this._writeFileAtomic(absPath, pySource);

    let storedFilePath = absPath;
    if (this.rootDir && isPathInsideDir(absPath, this.rootDir)) {
      storedFilePath = path.relative(this.rootDir, absPath).replace(/\\/g, '/');
    }

    this._idSeq += 1;
    const rawDisplay = stripEmojis(opts.name);
    const displayName = rawDisplay || 'Auto Script';
    const entry = {
      id: `script-${Date.now()}-${this._idSeq}-${crypto.randomBytes(2).toString('hex')}`,
      name: displayName,
      filePath: storedFilePath,
      steps: cleanSteps,
      schedule: normalizeScheduleForSave(opts.schedule),
      dryRunDefault: Boolean(opts.dryRunDefault),
      lastRunAt: null,
      lastExitCode: null
    };

    const nextAutoScripts = currentScripts.concat([entry]);
    if (this.configManager && typeof this.configManager.save === 'function') {
      const saved = this.configManager.save({ autoScripts: nextAutoScripts });
      if (this.broadcastConfigUpdated) {
        try {
          this.broadcastConfigUpdated(saved);
        } catch (_) {}
      }
    }

    return {
      ok: true,
      script: entry
    };
  }

  stop() {
    this._isStoppingAll = true;
    this.isRecording = false;
    try {
      this._detachRecClickListener();
    } catch (_) {}
    try {
      if (this.hookBridge && typeof this.hookBridge.stopRecording === 'function') {
        this.hookBridge.stopRecording();
      }
    } catch (_) {}
    try {
      this._unregisterEscapeShortcut();
    } catch (_) {}
    try {
      this._closeOverlayWindow(true);
    } catch (_) {}
    this._hidMainWindow = null;
    this._customExclusionRect = null;
    this._startedHookTemp = false;
    try {
      if (this.broadcastToAllWindows) {
        this.broadcastToAllWindows('mpe:py-recording-state', {
          active: false,
          stepCount: this.steps.length,
          lastStep: null,
          startedAt: this._startedAt || null,
          elapsedMs: 0
        });
      }
    } catch (_) {}
    this._isStoppingAll = false;
  }
}

PythonRecorder.sanitizeScriptBaseName = sanitizeScriptBaseName;
PythonRecorder.sanitizeSteps = sanitizeSteps;
PythonRecorder.generatePythonSource = generatePythonSource;
PythonRecorder.isPathInsideDir = isPathInsideDir;
PythonRecorder.isPointInsideRect = isPointInsideRect;
PythonRecorder.parseStrictFiniteNumber = parseStrictFiniteNumber;
PythonRecorder.stripEmojis = stripEmojis;
PythonRecorder.resolveRealPath = resolveRealPath;

module.exports = PythonRecorder;
