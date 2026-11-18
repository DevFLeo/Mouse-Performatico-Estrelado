const path = require('path');
const { BrowserWindow, screen } = require('electron');

function createDefaultMiniConfig() {
  return {
    enabled: true,
    x: null,
    y: null,
    size: 68,
    scale: 1.0,
    fanRadius: 140
  };
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function toEvenInt(val) {
  const n = Math.round(Number(val) || 0);
  return n % 2 === 0 ? n : n + 1;
}

class MiniAstrolabeManager {
  constructor(ctx = {}) {
    this.configManager = ctx.configManager || null;
    this.consentManager = ctx.consentManager || null;
    this.actionExecutor = ctx.actionExecutor || null;
    this.hookBridge = ctx.hookBridge || null;
    this.registerWindow = typeof ctx.registerWindow === 'function' ? ctx.registerWindow : () => {};
    this.broadcastToAllWindows =
      typeof ctx.broadcastToAllWindows === 'function' ? ctx.broadcastToAllWindows : () => {};
    this.broadcastConfigUpdated =
      typeof ctx.broadcastConfigUpdated === 'function' ? ctx.broadcastConfigUpdated : () => {};
    this.codeDir = ctx.codeDir || path.resolve(__dirname, '..', '..');
    this.rootDir = ctx.rootDir || path.resolve(this.codeDir, '..');
    this.isSelfTest = Array.isArray(process.argv) && process.argv.includes('--self-test');

    this.win = null;
    this.expanded = false;
    this.dragging = false;
    this.destroyed = false;
    this.watchdogTimer = null;
    this.lastIgnoreMouse = null;

    this.transientLayout = null;
    this.expandCursorAnchor = null;
    this.wasCursorInsideDuringExpand = false;
  }

  isBackgroundAllowed() {
    return Boolean(
      this.consentManager &&
        typeof this.consentManager.isActionAllowed === 'function' &&
        this.consentManager.isActionAllowed('backgroundExecution')
    );
  }

  readMiniConfig() {
    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const raw = cfg && cfg.miniAstrolabe && typeof cfg.miniAstrolabe === 'object'
      ? cfg.miniAstrolabe
      : {};
    const merged = Object.assign({}, createDefaultMiniConfig(), raw);
    return this.normalizeMiniConfig(merged);
  }

  readPointsCount() {
    const cfg = this.configManager && typeof this.configManager.get === 'function'
      ? this.configManager.get()
      : null;
    const pts = cfg && Array.isArray(cfg.points) ? cfg.points : [];
    // Mesma regra do leque: favoritos (showInMini) se houver, limitado a 12 (layout validado sem sobreposicao).
    const favCount = pts.filter((p) => p && p.showInMini === true).length;
    return Math.min(12, favCount > 0 ? favCount : pts.length);
  }

  normalizeMiniConfig(raw = {}) {
    const defaults = createDefaultMiniConfig();
    const sizeRaw = Number(raw.size);
    const scaleRaw = Number(raw.scale);
    const fanRadiusRaw = Number(raw.fanRadius);
    const xRaw = raw.x;
    const yRaw = raw.y;

    return {
      enabled: raw.enabled !== false,
      x: typeof xRaw === 'number' && Number.isFinite(xRaw) ? Math.round(xRaw) : null,
      y: typeof yRaw === 'number' && Number.isFinite(yRaw) ? Math.round(yRaw) : null,
      size: Number.isFinite(sizeRaw) ? clamp(Math.round(sizeRaw), 44, 120) : defaults.size,
      scale: Number.isFinite(scaleRaw)
        ? Math.round(clamp(scaleRaw, 0.75, 1.5) * 100) / 100
        : defaults.scale,
      fanRadius: Number.isFinite(fanRadiusRaw)
        ? clamp(Math.round(fanRadiusRaw), 90, 260)
        : defaults.fanRadius
    };
  }

  getWorkAreaForPoint(x, y) {
    let display = null;
    try {
      if (
        typeof x === 'number' &&
        Number.isFinite(x) &&
        typeof y === 'number' &&
        Number.isFinite(y) &&
        screen &&
        typeof screen.getDisplayNearestPoint === 'function'
      ) {
        display = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) });
      }
    } catch (_) {}
    if (!display) {
      try {
        if (screen && typeof screen.getPrimaryDisplay === 'function') {
          display = screen.getPrimaryDisplay();
        }
      } catch (_) {}
    }
    const wa = (display && (display.workArea || display.bounds)) || {
      x: 0,
      y: 0,
      width: 1280,
      height: 720
    };
    return {
      x: Math.round(wa.x || 0),
      y: Math.round(wa.y || 0),
      width: Math.max(320, Math.round(wa.width || 1280)),
      height: Math.max(240, Math.round(wa.height || 720))
    };
  }

  computeAnchoredGeometry(miniCfg, expanded, pointsCount) {
    const hubDia = clamp(Math.round(miniCfg.size * miniCfg.scale), 40, 132);
    const collapsedSize = toEvenInt(hubDia + 36);
    const halfMargin = Math.round(hubDia / 2) + 8;

    const initialWa = this.getWorkAreaForPoint(miniCfg.x, miniCfg.y);
    const defaultHubX = initialWa.x + initialWa.width - Math.max(68, halfMargin + 16);
    const defaultHubY = initialWa.y + initialWa.height - Math.max(68, halfMargin + 16);

    const rawHubX = miniCfg.x !== null ? miniCfg.x : defaultHubX;
    const rawHubY = miniCfg.y !== null ? miniCfg.y : defaultHubY;

    const wa = this.getWorkAreaForPoint(rawHubX, rawHubY);
    const minHubX = wa.x + halfMargin;
    const maxHubX = Math.max(minHubX, wa.x + wa.width - halfMargin);
    const minHubY = wa.y + halfMargin;
    const maxHubY = Math.max(minHubY, wa.y + wa.height - halfMargin);

    const hubX = Math.round(clamp(rawHubX, minHubX, maxHubX));
    const hubY = Math.round(clamp(rawHubY, minHubY, maxHubY));

    let bounds;
    if (!expanded) {
      const halfWin = Math.round(collapsedSize / 2);
      const winX = Math.round(clamp(hubX - halfWin, wa.x, Math.max(wa.x, wa.x + wa.width - collapsedSize)));
      const winY = Math.round(clamp(hubY - halfWin, wa.y, Math.max(wa.y, wa.y + wa.height - collapsedSize)));
      bounds = {
        x: winX,
        y: winY,
        width: Math.min(collapsedSize, wa.width),
        height: Math.min(collapsedSize, wa.height)
      };
    } else {
      const btnDia = clamp(Math.round(48 * miniCfg.scale), 40, 64);
      const r1 = Math.max(
        Math.round(hubDia / 2 + btnDia / 2 + 24 * miniCfg.scale),
        Math.round(miniCfg.fanRadius * 0.78 * miniCfg.scale),
        Math.round(108 * miniCfg.scale)
      );
      const radialStep = btnDia + Math.max(26, Math.round(28 * miniCfg.scale));
      const ringsNeeded = pointsCount > 15 ? 4 : pointsCount > 8 ? 3 : pointsCount > 3 ? 2 : 1;
      const outerRing = r1 + (ringsNeeded - 1) * radialStep;
      const reach = Math.round(outerRing + btnDia / 2 + 64);

      const left = Math.max(wa.x, Math.round(hubX - reach));
      const top = Math.max(wa.y, Math.round(hubY - reach));
      const right = Math.min(wa.x + wa.width, Math.round(hubX + reach));
      const bottom = Math.min(wa.y + wa.height, Math.round(hubY + reach));

      bounds = {
        x: left,
        y: top,
        width: Math.max(collapsedSize, right - left),
        height: Math.max(collapsedSize, bottom - top)
      };
    }

    return {
      hubDia,
      collapsedSize,
      hubX,
      hubY,
      workArea: wa,
      bounds,
      hubLocalX: Math.round(hubX - bounds.x),
      hubLocalY: Math.round(hubY - bounds.y)
    };
  }

  getActiveMiniConfig() {
    const persisted = this.readMiniConfig();
    if (this.transientLayout) {
      return this.normalizeMiniConfig(Object.assign({}, persisted, this.transientLayout));
    }
    return persisted;
  }

  applyWindowGeometry(expanded = this.expanded) {
    const miniCfg = this.getActiveMiniConfig();
    const geom = this.computeAnchoredGeometry(miniCfg, Boolean(expanded), this.readPointsCount());
    if (!this.win || (typeof this.win.isDestroyed === 'function' && this.win.isDestroyed())) {
      return geom;
    }

    if (typeof this.win.setBounds === 'function') {
      try {
        this.win.setBounds({
          x: Math.round(geom.bounds.x),
          y: Math.round(geom.bounds.y),
          width: Math.round(geom.bounds.width),
          height: Math.round(geom.bounds.height)
        });
      } catch (_) {}
    }

    if (typeof this.win.getBounds === 'function') {
      try {
        const actual = this.win.getBounds();
        if (actual && typeof actual.x === 'number' && typeof actual.y === 'number') {
          geom.bounds = {
            x: Math.round(actual.x),
            y: Math.round(actual.y),
            width: Math.round(actual.width),
            height: Math.round(actual.height)
          };
          geom.hubLocalX = Math.round(geom.hubX - geom.bounds.x);
          geom.hubLocalY = Math.round(geom.hubY - geom.bounds.y);
        }
      } catch (_) {}
    }

    return geom;
  }

  ensureWindow() {
    if (this.destroyed || this.isSelfTest || !this.isBackgroundAllowed()) {
      return null;
    }
    const miniCfg = this.readMiniConfig();
    if (miniCfg.enabled === false) {
      return null;
    }
    if (this.win && (typeof this.win.isDestroyed !== 'function' || !this.win.isDestroyed())) {
      return this.win;
    }

    const geom = this.computeAnchoredGeometry(miniCfg, false, this.readPointsCount());
    const preloadPath = path.join(__dirname, '..', 'preload', 'preload.js');
    const htmlPath = path.join(__dirname, '..', 'renderer', 'mini-astrolabe.html');

    const win = new BrowserWindow({
      width: geom.bounds.width,
      height: geom.bounds.height,
      x: geom.bounds.x,
      y: geom.bounds.y,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false
      }
    });

    this.win = win;
    this.expanded = false;
    this.dragging = false;
    this.lastIgnoreMouse = null;

    if (typeof win.setMinimumSize === 'function') {
      try { win.setMinimumSize(1, 1); } catch (_) {}
    }
    if (typeof win.setAlwaysOnTop === 'function') {
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
    }
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) {}
    }

    this.setIgnoreMouse(true, true);
    this.registerWindow('mini-astrolabe', win);

    if (typeof win.on === 'function') {
      win.on('closed', () => {
        this.stopWatchdog();
        if (this.win === win) {
          this.win = null;
          this.expanded = false;
          this.dragging = false;
          this.lastIgnoreMouse = null;
        }
      });
    }

    if (win.webContents && typeof win.webContents.once === 'function') {
      win.webContents.once('did-finish-load', () => {
        if (!win.isDestroyed() && win.webContents && !win.webContents.isDestroyed()) {
          const state = this.getState();
          try {
            win.webContents.send('mpe:mini-state-changed', state);
            if (this.configManager && typeof this.configManager.get === 'function') {
              win.webContents.send('mpe:config-updated', {
                config: this.configManager.get(),
                sourceWindow: 'main-process'
              });
            }
          } catch (_) {}
        }
      });
    }

    if (typeof win.loadFile === 'function') {
      win.loadFile(htmlPath);
    }

    if (typeof win.showInactive === 'function') {
      win.showInactive();
    } else if (typeof win.show === 'function') {
      win.show();
    }

    if (typeof win.setAlwaysOnTop === 'function') {
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
    }

    return win;
  }

  closeWindow(forceDestroy = false) {
    this.stopWatchdog();
    this.expanded = false;
    this.dragging = false;
    this.transientLayout = null;
    this.lastIgnoreMouse = null;

    const win = this.win;
    this.win = null;
    if (!win) return;

    try {
      const destroyed = typeof win.isDestroyed === 'function' ? win.isDestroyed() : false;
      if (!destroyed) {
        if (forceDestroy && typeof win.destroy === 'function') {
          win.destroy();
        } else if (typeof win.close === 'function') {
          win.close();
        } else if (typeof win.hide === 'function') {
          win.hide();
        } else if (typeof win.destroy === 'function') {
          win.destroy();
        }
      }
    } catch (_) {}
  }

  startWatchdog() {
    this.stopWatchdog();
    if (this.destroyed || !this.expanded || this.dragging) return;

    let initialCursor = null;
    try {
      if (screen && typeof screen.getCursorScreenPoint === 'function') {
        initialCursor = screen.getCursorScreenPoint();
      }
    } catch (_) {}
    this.expandCursorAnchor = initialCursor;
    this.wasCursorInsideDuringExpand = false;

    if (initialCursor && this.win && typeof this.win.getBounds === 'function') {
      try {
        const b = this.win.getBounds();
        if (
          b &&
          initialCursor.x >= b.x - 8 &&
          initialCursor.x <= b.x + b.width + 8 &&
          initialCursor.y >= b.y - 8 &&
          initialCursor.y <= b.y + b.height + 8
        ) {
          this.wasCursorInsideDuringExpand = true;
        }
      } catch (_) {}
    }

    this.watchdogTimer = setInterval(() => {
      if (this.destroyed || !this.expanded || this.dragging) {
        this.stopWatchdog();
        return;
      }
      if (!this.win || (typeof this.win.isDestroyed === 'function' && this.win.isDestroyed())) {
        this.stopWatchdog();
        return;
      }
      if (!screen || typeof screen.getCursorScreenPoint !== 'function' || typeof this.win.getBounds !== 'function') {
        return;
      }

      try {
        const pt = screen.getCursorScreenPoint();
        const b = this.win.getBounds();
        if (!pt || !b) return;

        const margin = 10;
        const inside =
          pt.x >= b.x - margin &&
          pt.x <= b.x + b.width + margin &&
          pt.y >= b.y - margin &&
          pt.y <= b.y + b.height + margin;

        if (inside) {
          this.wasCursorInsideDuringExpand = true;
          return;
        }

        const physicalMoved =
          this.expandCursorAnchor &&
          Math.hypot(pt.x - this.expandCursorAnchor.x, pt.y - this.expandCursorAnchor.y) > 14;

        if (this.wasCursorInsideDuringExpand || physicalMoved) {
          this.setExpanded(false);
        }
      } catch (_) {}
    }, 90);

    if (this.watchdogTimer && typeof this.watchdogTimer.unref === 'function') {
      this.watchdogTimer.unref();
    }
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  syncWithConsent(allowed) {
    if (this.destroyed) return this.getState();
    const canRun = Boolean(allowed) && this.isBackgroundAllowed();
    const miniCfg = this.readMiniConfig();
    const shouldBeVisible = canRun && miniCfg.enabled !== false && !this.isSelfTest;

    if (shouldBeVisible) {
      this.ensureWindow();
      this.applyWindowGeometry(this.expanded);
    } else {
      // Never mutate cfg.miniAstrolabe.enabled here
      this.closeWindow(false);
    }

    const state = this.getState();
    this.broadcastToAllWindows('mpe:mini-state-changed', state);
    return state;
  }

  toggle(enabled) {
    if (!this.isBackgroundAllowed()) {
      return {
        ok: false,
        blockedByConsent: true,
        enabled: false,
        message: 'Aceite de primeiro acesso necessario.'
      };
    }
    const cur = this.readMiniConfig();
    const nextEnabled = typeof enabled === 'boolean' ? enabled : !Boolean(cur.enabled);
    const merged = Object.assign({}, cur, { enabled: nextEnabled });
    const saved = this.configManager.save({ miniAstrolabe: merged });

    if (nextEnabled && !this.isSelfTest) {
      this.ensureWindow();
      this.applyWindowGeometry(false);
    } else {
      this.closeWindow(false);
    }

    const state = this.getState();
    this.broadcastConfigUpdated(saved);
    this.broadcastToAllWindows('mpe:mini-state-changed', state);
    return {
      ok: true,
      enabled: nextEnabled,
      windowOpen: state.windowOpen,
      miniAstrolabe: saved ? saved.miniAstrolabe : merged,
      state
    };
  }

  getState() {
    const miniCfg = this.getActiveMiniConfig();
    const windowOpen = Boolean(
      this.win && (typeof this.win.isDestroyed !== 'function' || !this.win.isDestroyed())
    );
    const expanded = Boolean(this.expanded && windowOpen);
    const geom = this.computeAnchoredGeometry(miniCfg, expanded, this.readPointsCount());

    let actualBounds = geom.bounds;
    let hubLocalX = geom.hubLocalX;
    let hubLocalY = geom.hubLocalY;

    if (windowOpen && typeof this.win.getBounds === 'function') {
      try {
        const b = this.win.getBounds();
        if (b && typeof b.x === 'number' && typeof b.y === 'number') {
          actualBounds = {
            x: Math.round(b.x),
            y: Math.round(b.y),
            width: Math.round(b.width),
            height: Math.round(b.height)
          };
          hubLocalX = Math.round(geom.hubX - actualBounds.x);
          hubLocalY = Math.round(geom.hubY - actualBounds.y);
        }
      } catch (_) {}
    }

    return {
      ok: true,
      windowOpen,
      blockedByConsent: !this.isBackgroundAllowed(),
      expanded,
      dragging: Boolean(this.dragging),
      // enabled = estado efetivo (preferencia + aceite); a preferencia salva fica em preferenceEnabled
      // para o Mini voltar sozinho quando o aceite for concedido de novo.
      enabled: miniCfg.enabled !== false && this.isBackgroundAllowed(),
      preferenceEnabled: miniCfg.enabled !== false,
      x: miniCfg.x,
      y: miniCfg.y,
      size: miniCfg.size,
      scale: miniCfg.scale,
      fanRadius: miniCfg.fanRadius,
      hubDia: geom.hubDia,
      hubX: geom.hubX,
      hubY: geom.hubY,
      hubLocalX,
      hubLocalY,
      workArea: geom.workArea,
      bounds: actualBounds
    };
  }

  updateLayout(payload = {}) {
    if (!this.isBackgroundAllowed()) {
      return {
        ok: false,
        blockedByConsent: true,
        message: 'Aceite de primeiro acesso necessario.'
      };
    }

    const cur = this.readMiniConfig();
    const allowedKeys = ['x', 'y', 'size', 'scale', 'fanRadius', 'enabled'];
    const patch = {};
    for (const k of allowedKeys) {
      if (k in payload && payload[k] !== undefined) {
        patch[k] = payload[k];
      }
    }

    const nextMini = this.normalizeMiniConfig(Object.assign({}, cur, patch));
    if (nextMini.x !== null && nextMini.y !== null) {
      const clampedGeom = this.computeAnchoredGeometry(nextMini, false, this.readPointsCount());
      nextMini.x = clampedGeom.hubX;
      nextMini.y = clampedGeom.hubY;
    }

    if (payload.transient === true) {
      this.dragging = payload.dragging !== undefined ? Boolean(payload.dragging) : true;
      if (this.dragging) {
        this.stopWatchdog();
      }
      this.transientLayout = nextMini;
      this.applyWindowGeometry(false);
      return {
        ok: true,
        transient: true,
        miniAstrolabe: nextMini,
        state: this.getState()
      };
    }

    this.dragging = false;
    this.transientLayout = null;
    const saved = this.configManager.save({ miniAstrolabe: nextMini });

    if (nextMini.enabled === false) {
      this.closeWindow(false);
    } else if (!this.isSelfTest) {
      this.ensureWindow();
      this.applyWindowGeometry(this.expanded);
    }

    const state = this.getState();
    this.broadcastConfigUpdated(saved);
    this.broadcastToAllWindows('mpe:mini-state-changed', state);
    return {
      ok: true,
      miniAstrolabe: saved ? saved.miniAstrolabe : nextMini,
      state
    };
  }

  setIgnoreMouse(ignore, forward) {
    if (!this.win || (typeof this.win.isDestroyed === 'function' && this.win.isDestroyed())) {
      return;
    }
    const nextIgnore = Boolean(ignore);
    const nextForward = nextIgnore ? Boolean(forward) : false;
    if (
      this.lastIgnoreMouse &&
      this.lastIgnoreMouse.ignore === nextIgnore &&
      this.lastIgnoreMouse.forward === nextForward
    ) {
      return;
    }
    this.lastIgnoreMouse = { ignore: nextIgnore, forward: nextForward };
    if (typeof this.win.setIgnoreMouseEvents === 'function') {
      try {
        if (nextIgnore) {
          this.win.setIgnoreMouseEvents(true, { forward: nextForward });
        } else {
          this.win.setIgnoreMouseEvents(false);
        }
      } catch (_) {}
    }
  }

  setExpanded(expanded) {
    if (!this.isBackgroundAllowed()) {
      this.stopWatchdog();
      this.expanded = false;
      return {
        ok: false,
        blockedByConsent: true,
        expanded: false,
        message: 'Aceite de primeiro acesso necessario.'
      };
    }

    const nextExpanded = Boolean(expanded);
    this.expanded = nextExpanded;
    if (this.win && (typeof this.win.isDestroyed !== 'function' || !this.win.isDestroyed())) {
      this.applyWindowGeometry(nextExpanded);
      if (nextExpanded) {
        if (typeof this.win.setAlwaysOnTop === 'function') {
          try { this.win.setAlwaysOnTop(true, 'screen-saver'); } catch (_) {}
        }
        this.setIgnoreMouse(false, false);
        this.startWatchdog();
      } else {
        this.stopWatchdog();
        this.setIgnoreMouse(true, true);
      }
    } else {
      this.stopWatchdog();
    }

    const state = this.getState();
    this.broadcastToAllWindows('mpe:mini-state-changed', state);
    return state;
  }

  destroy() {
    this.destroyed = true;
    this.stopWatchdog();
    this.closeWindow(true);
  }
}

module.exports = MiniAstrolabeManager;
