const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execSync, spawn } = require('child_process');

const CODE_DIR = path.resolve(__dirname, '..');
const RENDERER_DIR = path.join(CODE_DIR, 'src', 'renderer');

const results = [];

async function runCase(id, name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const durationMs = Date.now() - start;
    results.push({ id, name, status: 'PASS', durationMs, detail: detail || 'OK' });
    console.log(`[PASS] ${id} (${durationMs}ms) - ${name}: ${detail || 'OK'}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    results.push({ id, name, status: 'FAIL', durationMs, detail: err.message });
    console.error(`[FAIL] ${id} (${durationMs}ms) - ${name}:`, err.stack || err.message);
  }
}

function hexToRgb(hex) {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean.slice(0, 6);
  const num = parseInt(full, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(hex1, hex2) {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseRootCssVars(cssText) {
  const rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\}/);
  const vars = {};
  if (!rootMatch) return vars;
  const re = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(rootMatch[1])) !== null) {
    vars[m[1].trim()] = m[2].trim();
  }
  return vars;
}

function createFakeDomHarness(htmlText, initialHidden = false) {
  const elementsById = new Map();
  const windowListeners = new Map();
  const documentListeners = new Map();
  const mutationObservers = [];

  class FakeClassList {
    constructor(el, initial = '') {
      this.el = el;
      this.set = new Set(String(initial).split(/\s+/).filter(Boolean));
    }
    add(...tokens) {
      tokens.forEach((t) => t && this.set.add(t));
      this.el._notifyMutation('attributes', 'class');
    }
    remove(...tokens) {
      tokens.forEach((t) => this.set.delete(t));
      this.el._notifyMutation('attributes', 'class');
    }
    toggle(token, force) {
      if (force === true) this.set.add(token);
      else if (force === false) this.set.delete(token);
      else if (this.set.has(token)) this.set.delete(token);
      else this.set.add(token);
      this.el._notifyMutation('attributes', 'class');
      return this.set.has(token);
    }
    contains(token) {
      return this.set.has(token);
    }
    toString() {
      return Array.from(this.set).join(' ');
    }
  }

  class FakeStyle {
    constructor() {
      this.props = {};
    }
    setProperty(k, v) {
      this.props[k] = v;
    }
    removeProperty(k) {
      delete this.props[k];
    }
  }

  function makeCanvasCtx(counters) {
    return {
      save() {},
      restore() {},
      scale() {},
      clearRect() {},
      fillRect() {
        counters.fillRectCount++;
      },
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      arc() {},
      rect() {},
      roundRect() {},
      fill() {},
      stroke() {},
      setLineDash() {},
      translate() {},
      rotate() {},
      fillText() {},
      measureText(txt) {
        return { width: String(txt || '').length * 7 };
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      }
    };
  }

  class FakeElement {
    constructor(tagName, attrs = {}) {
      this.tagName = String(tagName || 'DIV').toUpperCase();
      this._id = attrs.id || '';
      if (this._id) elementsById.set(this._id, this);
      this.dataset = Object.assign({}, attrs.dataset || {});
      this.attributes = Object.assign({}, attrs);
      this.style = new FakeStyle();
      this.classList = new FakeClassList(this, attrs.class || '');
      this.listeners = new Map();
      this.children = [];
      this.parentNode = null;
      this._textContent = attrs.textContent || '';
      this._innerHTML = '';
      this.value = attrs.value !== undefined ? attrs.value : '';
      this.checked = Boolean(attrs.checked);
      this.disabled = false;
      this.options = [];
      this.selectedIndex = 0;
      this.width = Number(attrs.width) || 1280;
      this.height = Number(attrs.height) || 720;
      this.offsetWidth = 204;
      this._canvasCounters = { fillRectCount: 0 };
      this._ctx = makeCanvasCtx(this._canvasCounters);
    }
    get id() {
      return this._id;
    }
    set id(v) {
      if (this._id && elementsById.get(this._id) === this) {
        elementsById.delete(this._id);
      }
      this._id = String(v == null ? '' : v);
      if (this._id) elementsById.set(this._id, this);
    }
    get textContent() {
      return this._textContent;
    }
    set textContent(v) {
      this._textContent = String(v == null ? '' : v);
      this._notifyMutation('characterData');
    }
    get innerHTML() {
      return this._innerHTML;
    }
    set innerHTML(v) {
      this._innerHTML = String(v == null ? '' : v);
      if (this._innerHTML === '') {
        this.children = [];
        if (this.tagName === 'SELECT') this.options = [];
      }
    }
    _notifyMutation(type, attrName) {
      for (const obs of mutationObservers) {
        obs._maybeTrigger(this, type, attrName);
      }
    }
    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(fn);
    }
    removeEventListener(type, fn) {
      const arr = this.listeners.get(type);
      if (!arr) return;
      this.listeners.set(
        type,
        arr.filter((f) => f !== fn)
      );
    }
    dispatchEvent(evt) {
      const e = Object.assign({ preventDefault() {}, stopPropagation() {}, target: this }, evt);
      const arr = this.listeners.get(e.type) || [];
      arr.forEach((fn) => fn(e));
    }
    click() {
      this.dispatchEvent({ type: 'click', button: 0 });
    }
    focus() {}
    select() {}
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      if (this.tagName === 'SELECT' && child.tagName === 'OPTION') {
        this.options.push(child);
      }
      return child;
    }
    contains(node) {
      return node === this || this.children.includes(node);
    }
    getBoundingClientRect() {
      return { left: 0, top: 0, width: this.width, height: this.height, right: this.width, bottom: this.height };
    }
    getContext() {
      return this._ctx;
    }
    querySelector(sel) {
      return queryAllIn(this, sel)[0] || null;
    }
    querySelectorAll(sel) {
      return queryAllIn(this, sel);
    }
  }

  function matchSingleSelector(el, sel) {
    if (!sel) return false;
    if (sel.startsWith('#')) {
      return el.id === sel.slice(1);
    }
    const parts = sel.split(':not(');
    const base = parts[0];
    if (base.startsWith('.')) {
      const clsMatch = base.match(/^\.([a-zA-Z0-9_-]+)/);
      if (!clsMatch || !el.classList.contains(clsMatch[1])) return false;
    }
    const attrMatches = [...base.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)];
    for (const m of attrMatches) {
      const attr = m[1];
      const expected = m[2];
      const actual = attr.startsWith('data-') ? el.dataset[attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] : el.attributes[attr];
      if (expected !== undefined && String(actual) !== expected) return false;
      if (expected === undefined && actual === undefined) return false;
    }
    for (let i = 1; i < parts.length; i++) {
      const inner = parts[i].replace(/\)$/, '');
      if (matchSingleSelector(el, inner)) return false;
    }
    return true;
  }

  function collectAllElements(root, out = []) {
    out.push(root);
    for (const c of root.children) collectAllElements(c, out);
    return out;
  }

  function queryAllIn(root, sel) {
    const all = root === documentElement ? Array.from(allElementsSet) : collectAllElements(root, []);
    return all.filter((el) => matchSingleSelector(el, sel));
  }

  const allElementsSet = new Set();
  const documentElement = new FakeElement('html', {});
  const bodyElement = new FakeElement('body', {});
  allElementsSet.add(documentElement);
  allElementsSet.add(bodyElement);

  // Parse all elements with id/class/data-* from index.html
  const tagRe = /<([a-zA-Z0-9-]+)([^>]*)>/g;
  let tm;
  while ((tm = tagRe.exec(htmlText)) !== null) {
    const tag = tm[1].toLowerCase();
    const rawAttrs = tm[2] || '';
    if (tag.startsWith('/') || ['html', 'head', 'meta', 'title', 'link', 'script'].includes(tag)) continue;
    const attrs = { dataset: {} };
    const attrRe = /([a-zA-Z0-9-]+)(?:="([^"]*)")?/g;
    let am;
    while ((am = attrRe.exec(rawAttrs)) !== null) {
      const k = am[1];
      const v = am[2] !== undefined ? am[2] : 'true';
      if (k === 'id') attrs.id = v;
      else if (k === 'class') attrs.class = v;
      else if (k === 'value') attrs.value = v;
      else if (k === 'checked') attrs.checked = true;
      else if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        attrs.dataset[camel] = v;
      } else {
        attrs[k] = v;
      }
    }
    const el = new FakeElement(tag, attrs);
    if (el.id) elementsById.set(el.id, el);
    allElementsSet.add(el);
  }

  // Parse <option> inside <select> for pt-action-type and pt-chat-channel etc.
  const selectRe = /<select[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
  let sm;
  while ((sm = selectRe.exec(htmlText)) !== null) {
    const selEl = elementsById.get(sm[1]);
    if (!selEl) continue;
    const optRe = /<option\s+value="([^"]*)"(?:\s+selected)?[^>]*>([^<]*)<\/option>/g;
    let om;
    while ((om = optRe.exec(sm[2])) !== null) {
      const opt = new FakeElement('option', { value: om[1], textContent: om[2] });
      selEl.appendChild(opt);
      if (om[0].includes('selected') || selEl.options.length === 1) {
        selEl.value = om[1];
        selEl.selectedIndex = selEl.options.length - 1;
      }
    }
  }

  class FakeMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.targets = [];
      mutationObservers.push(this);
    }
    observe(target, opts) {
      this.targets.push({ target, opts });
    }
    disconnect() {
      this.targets = [];
    }
    _maybeTrigger(el, type, attrName) {
      for (const entry of this.targets) {
        if (entry.target === el) {
          if (type === 'attributes' && entry.opts && entry.opts.attributes) {
            this.cb([{ type, target: el, attributeName: attrName }]);
          } else if (type === 'characterData' && entry.opts && (entry.opts.characterData || entry.opts.childList)) {
            this.cb([{ type, target: el }]);
          }
        }
      }
    }
  }

  const documentObj = {
    hidden: initialHidden,
    activeElement: bodyElement,
    documentElement,
    body: bodyElement,
    getElementById(id) {
      return elementsById.get(id) || null;
    },
    querySelector(sel) {
      if (sel.startsWith('#')) return elementsById.get(sel.slice(1)) || null;
      return Array.from(allElementsSet).find((el) => matchSingleSelector(el, sel)) || null;
    },
    querySelectorAll(sel) {
      return Array.from(allElementsSet).filter((el) => matchSingleSelector(el, sel));
    },
    createElement(tag) {
      const el = new FakeElement(tag, {});
      allElementsSet.add(el);
      return el;
    },
    createDocumentFragment() {
      return new FakeElement('fragment', {});
    },
    addEventListener(type, fn) {
      if (!documentListeners.has(type)) documentListeners.set(type, []);
      documentListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = documentListeners.get(type);
      if (!arr) return;
      documentListeners.set(
        type,
        arr.filter((f) => f !== fn)
      );
    },
    dispatchEvent(evt) {
      const arr = documentListeners.get(evt.type) || [];
      arr.forEach((fn) => fn(evt));
    }
  };

  const windowObj = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 1,
    location: { search: '' },
    document: documentObj,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = windowListeners.get(type);
      if (!arr) return;
      windowListeners.set(
        type,
        arr.filter((f) => f !== fn)
      );
    },
    dispatchEvent(evt) {
      const e = Object.assign({ preventDefault() {}, stopPropagation() {} }, evt);
      const arr = windowListeners.get(e.type) || [];
      arr.forEach((fn) => fn(e));
    },
    getListenerCount(type) {
      return (windowListeners.get(type) || []).length;
    }
  };

  return { windowObj, documentObj, FakeMutationObserver, elementsById };
}

function makeBaseConfig(overrides = {}) {
  return Object.assign(
    {
      profile: { userName: 'DevFLeo', isRegistered: true, languageTone: 'amigavel' },
      theme: {
        bgPrimary: '#040406',
        bgSecondary: '#171206',
        goldPrimary: '#E5B84B',
        goldSecondary: '#FFE08A',
        goldDim: '#C89D3C',
        vectorAccent: '#8FA8FF',
        nexusRed: '#9E2A2B'
      },
      system: { startWithWindows: false, autoOrbit: true, sensitivity3D: 1.0, projectionMode: '3d' },
      telegram: { savedChatPath: 'Eu | Voce', savedScreenshotsFolder: './prints', botToken: '', chatId: '' },
      captures: { organizationMode: 'system_date', namingPattern: '{prefix}_{system}', defaultPrefix: 'MPE', documentsFolder: './arquivos' },
      organizer: { fontSize: 'medium', uiMode: 'dark', criterion: 'type', moveInsteadOfCopy: false, searchInContent: true, rememberWindowState: false, lastActiveTab: 'astrolabe' },
      consent: {
        accepted: false,
        decidedAt: null,
        version: '1.0',
        permissions: { backgroundExecution: false, launchAppsAndLinks: false, pythonAutomation: false }
      },
      miniAstrolabe: { enabled: false, x: null, y: null, size: 68, scale: 1.0, fanRadius: 140 },
      autoScripts: [
        {
          id: 'script-1',
          name: 'Rotina Teste',
          filePath: 'codigo/data/scripts/rotina_teste.py',
          steps: [{ x: 100, y: 200, button: 'left', waitMs: 300 }],
          schedule: { enabled: false, timeHHMM: '09:30', mode: 'daily' }
        }
      ],
      points: [
        {
          id: 'star-01-1',
          code: '01 1',
          title: 'Bloco de Notas',
          description: 'Abre Bloco de Notas',
          actionType: 'launch_app_project',
          orbit: 2,
          angle: 20,
          elevation: 10,
          vectorStyle: 'gold',
          glyph: 'h',
          params: { appName: 'notepad', targetPath: 'notepad.exe', projectPath: '' }
        },
        {
          id: 'star-02-2',
          code: '02 2',
          title: 'Projeto VS Code',
          description: 'Abre projeto no VS Code',
          actionType: 'launch_app_project',
          orbit: 3,
          angle: 110,
          elevation: 15,
          vectorStyle: 'blue',
          glyph: 'C',
          params: { appName: 'vscode', targetPath: 'code', projectPath: 'c:\\Projetos\\MousePerformaticoEstrelado' }
        }
      ]
    },
    overrides
  );
}

function bootRendererApp({ initialConfig, initialHidden = false, mpeApiOverrides = {} } = {}) {
  const htmlText = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
  const i18nCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'i18n-tones.js'), 'utf8');
  const astrolabeCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'astrolabe3d.js'), 'utf8');
  const organizerCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'organizer.js'), 'utf8');
  const appCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'app.js'), 'utf8');

  const { windowObj, documentObj, FakeMutationObserver } = createFakeDomHarness(htmlText, initialHidden);

  const calls = {
    executePoint: [],
    setConsentDecision: [],
    reorderPoint: [],
    toggleMiniAstrolabe: [],
    updateMiniAstrolabeLayout: [],
    startPythonRecording: [],
    stopPythonRecording: [],
    savePythonScript: [],
    runPythonScript: [],
    schedulePythonScript: [],
    deletePythonScript: [],
    saveConfig: []
  };
  const listeners = {
    hudSummoned: [],
    configUpdated: [],
    consentUpdated: [],
    miniStateChanged: [],
    pyRecordingState: [],
    pyScriptExecuted: []
  };
  let liveConfig = JSON.parse(JSON.stringify(initialConfig || makeBaseConfig()));
  let rafIdSeq = 0;
  let rafCount = 0;
  let cancelCount = 0;
  const activeRafs = new Set();

  const mpeApi = Object.assign(
    {
      getConfig: async () => liveConfig,
      saveConfig: async (cfg) => {
        calls.saveConfig.push(cfg);
        liveConfig = JSON.parse(JSON.stringify(cfg));
        return liveConfig;
      },
      executePoint: async (pt) => {
        calls.executePoint.push(pt);
        if (!liveConfig.consent.accepted) {
          return { ok: false, blockedByConsent: true, message: 'Aceite de primeiro acesso necessario.' };
        }
        return { ok: true, type: pt.actionType, message: 'Executado' };
      },
      completeAreaCrop: async () => ({ ok: true }),
      saveNamedPrint: async () => ({ ok: true }),
      sendTextToTelegram: async () => ({ ok: true }),
      sendToTargetSystem: async () => ({ ok: true }),
      listOpenWindows: async () => [],
      copyToClipboard: async () => ({ ok: true }),
      openExternalPath: async () => ({ ok: true }),
      selectFolder: async () => 'c:\\Projetos\\MousePerformaticoEstrelado',
      selectFile: async () => 'c:\\Windows\\notepad.exe',
      hideHud: async () => ({ ok: true }),
      quitApp: async () => ({ ok: true }),
      ensureShortcuts: async () => ({ ok: true }),
      onHudSummoned: (cb) => listeners.hudSummoned.push(cb),
      onConfigUpdated: (cb) => {
        listeners.configUpdated.push(cb);
        return () => {};
      },
      onEscapePressed: () => {},
      reorderPoint: async (fromIndex, toIndex) => {
        calls.reorderPoint.push({ fromIndex, toIndex });
        const pts = [...liveConfig.points];
        const [moved] = pts.splice(fromIndex, 1);
        pts.splice(toIndex, 0, moved);
        liveConfig.points = pts.map((p, i) => Object.assign({}, p, { slotIndex: i, slotNumber: i + 1 }));
        return { ok: true, fromIndex, toIndex, points: liveConfig.points, config: liveConfig };
      },
      getConsentStatus: async () => liveConfig.consent,
      setConsentDecision: async (accepted, permissions) => {
        calls.setConsentDecision.push({ accepted, permissions });
        liveConfig.consent = {
          accepted: Boolean(accepted),
          decidedAt: new Date().toISOString(),
          version: '1.0',
          permissions: permissions || { backgroundExecution: false, launchAppsAndLinks: false, pythonAutomation: false }
        };
        return { ok: true, consent: liveConfig.consent };
      },
      onConsentUpdated: (cb) => {
        listeners.consentUpdated.push(cb);
        return () => {};
      },
      toggleMiniAstrolabe: async (enabled) => {
        calls.toggleMiniAstrolabe.push(enabled);
        if (!liveConfig.consent.accepted) {
          return { ok: false, enabled: false, blockedByConsent: true, message: 'Aceite de primeiro acesso necessario.' };
        }
        liveConfig.miniAstrolabe.enabled = typeof enabled === 'boolean' ? enabled : !liveConfig.miniAstrolabe.enabled;
        return { ok: true, enabled: liveConfig.miniAstrolabe.enabled, miniAstrolabe: liveConfig.miniAstrolabe };
      },
      getMiniAstrolabeState: async () =>
        Object.assign({ ok: true, windowOpen: false, blockedByConsent: !liveConfig.consent.accepted }, liveConfig.miniAstrolabe),
      updateMiniAstrolabeLayout: async (payload) => {
        calls.updateMiniAstrolabeLayout.push(payload);
        if (!liveConfig.consent.accepted) {
          return { ok: false, blockedByConsent: true, message: 'Aceite de primeiro acesso necessario.' };
        }
        Object.assign(liveConfig.miniAstrolabe, payload);
        return { ok: true, miniAstrolabe: liveConfig.miniAstrolabe };
      },
      setMiniIgnoreMouse: () => {},
      setMiniExpandedBounds: async () => ({ ok: true }),
      onMiniStateChanged: (cb) => {
        listeners.miniStateChanged.push(cb);
        return () => {};
      },
      startPythonRecording: async (opts) => {
        calls.startPythonRecording.push(opts);
        if (!liveConfig.consent.accepted) {
          return { ok: false, blockedByConsent: true, message: 'Aceite de primeiro acesso necessario.' };
        }
        return { ok: true };
      },
      stopPythonRecording: async (opts) => {
        calls.stopPythonRecording.push(opts);
        if (!liveConfig.consent.accepted) {
          return { ok: false, blockedByConsent: true, message: 'Aceite de primeiro acesso necessario.' };
        }
        return { ok: true, steps: [{ x: 320, y: 240, button: 'left', waitMs: 400 }] };
      },
      savePythonScript: async (payload) => {
        calls.savePythonScript.push(payload);
        const sc = {
          id: `script-${Date.now()}`,
          name: payload.name,
          filePath: 'codigo/data/scripts/test.py',
          steps: payload.steps || [],
          schedule: { enabled: false, timeHHMM: '09:00', mode: 'daily' }
        };
        liveConfig.autoScripts.push(sc);
        return { ok: true, script: sc };
      },
      runPythonScript: async (id, opts) => {
        calls.runPythonScript.push({ id, opts });
        return { ok: true, exitCode: 0 };
      },
      schedulePythonScript: async (id, schedule) => {
        calls.schedulePythonScript.push({ id, schedule });
        return { ok: true };
      },
      deletePythonScript: async (id) => {
        calls.deletePythonScript.push(id);
        liveConfig.autoScripts = liveConfig.autoScripts.filter((s) => s.id !== id);
        return { ok: true };
      },
      onPythonRecordingState: (cb) => {
        listeners.pyRecordingState.push(cb);
        return () => {};
      },
      onPythonScriptExecuted: (cb) => {
        listeners.pyScriptExecuted.push(cb);
        return () => {};
      },
      orgSelectFiles: async () => [],
      orgSelectFolder: async () => [],
      orgOrganize: async () => ({ ok: true, organizedCount: 0, results: [] }),
      orgRevert: async () => ({ ok: true, revertedCount: 0 }),
      orgUndoInfo: async () => ({ available: false, count: 0 }),
      orgScan: async () => ({ ok: true, totalFiles: 0, categories: [] }),
      orgSearch: async () => ({ ok: true, totalFiles: 0, searchResults: [] }),
      orgDeleteFile: async () => ({ ok: true }),
      orgOpenExplorer: async () => ({ ok: true }),
      orgOpenFile: async () => ({ ok: true }),
      onOrgProgress: () => {}
    },
    mpeApiOverrides
  );

  windowObj.mpeApi = mpeApi;

  const timers = [];
  const context = {
    window: windowObj,
    document: documentObj,
    MutationObserver: FakeMutationObserver,
    URLSearchParams,
    localStorage: {
      _data: {},
      getItem(k) {
        return this._data[k] || null;
      },
      setItem(k, v) {
        this._data[k] = String(v);
      }
    },
    requestAnimationFrame: () => {
      rafCount++;
      const id = ++rafIdSeq;
      activeRafs.add(id);
      return id;
    },
    cancelAnimationFrame: (id) => {
      cancelCount++;
      activeRafs.delete(id);
    },
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.cleared = true;
    },
    setInterval: (fn, ms) => {
      const t = { fn, ms, cleared: false, interval: true };
      timers.push(t);
      return t;
    },
    clearInterval: (t) => {
      if (t) t.cleared = true;
    },
    console
  };

  windowObj.MutationObserver = FakeMutationObserver;
  windowObj.URLSearchParams = URLSearchParams;
  windowObj.requestAnimationFrame = context.requestAnimationFrame;
  windowObj.cancelAnimationFrame = context.cancelAnimationFrame;

  class AreaSelectorStub {
    constructor() {
      this.isActive = false;
    }
    open() {}
    cancel() {}
  }
  windowObj.AreaSelector = AreaSelectorStub;

  vm.createContext(context);
  vm.runInContext(i18nCode, context, { filename: 'i18n-tones.js' });
  vm.runInContext(astrolabeCode, context, { filename: 'astrolabe3d.js' });
  vm.runInContext(organizerCode, context, { filename: 'organizer.js' });
  vm.runInContext(appCode, context, { filename: 'app.js' });

  return {
    windowObj,
    documentObj,
    context,
    calls,
    listeners,
    timers,
    getRafStats: () => ({ rafCount, cancelCount, activeCount: activeRafs.size }),
    triggerDomReady: async () => {
      windowObj.dispatchEvent({ type: 'DOMContentLoaded' });
      // Flush microtasks for async init()
      for (let i = 0; i < 12; i++) {
        await Promise.resolve();
      }
    }
  };
}

async function flushAsync() {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

async function main() {
  const m2Files = [
    path.join(RENDERER_DIR, 'index.html'),
    path.join(RENDERER_DIR, 'styles', 'main.css'),
    path.join(RENDERER_DIR, 'js', 'app.js'),
    path.join(RENDERER_DIR, 'js', 'astrolabe3d.js'),
    path.join(RENDERER_DIR, 'js', 'organizer.js'),
    path.join(RENDERER_DIR, 'js', 'i18n-tones.js'),
    path.join(CODE_DIR, 'scripts', 'm2-tests.js')
  ];

  await runCase('M2-01', 'Zero emojis em todos os arquivos M2', () => {
    const emojiRe = /\p{Extended_Pictographic}/gu;
    for (const f of m2Files) {
      const txt = fs.readFileSync(f, 'utf8');
      assert.strictEqual(emojiRe.test(txt), false, `Emoji detectado em ${f}`);
    }
    return `${m2Files.length} arquivos auditados com 0 emojis`;
  });

  await runCase('M2-02', 'Sintaxe Node valida em todos os JS M2', () => {
    const jsFiles = m2Files.filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      execSync(`node -c "${f}"`, { stdio: 'pipe' });
    }
    return `${jsFiles.length} arquivos JS validados`;
  });

  await runCase('M2-03', 'Estrutura DOM completa (SYS-04 + M2 + Organizer)', () => {
    const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
    const requiredIds = [
      // SYS-04 (18)
      'btn-tab-astrolabe',
      'btn-tab-organizer',
      'btn-dock-organizer',
      'btn-open-guide',
      'btn-guide-repair-shortcut',
      'modal-guide',
      'btn-org-back-astrolabe',
      'btn-add-star',
      'btn-dock-add-point',
      'modal-point',
      'wiz-pane-1',
      'wiz-pane-2',
      'wiz-pane-3',
      'pt-live-summary',
      'btn-test-point',
      'pt-angle',
      'pt-orbit',
      'pt-action-type',
      // M2 new controls
      'central-black-dot-hub',
      'central-black-dot-core',
      'central-primary-actions',
      'btn-main-organize-1click',
      'btn-main-organize-quick',
      'btn-open-python-scripts',
      'central-slots-panel',
      'slots-list',
      'mini-astrolabe-controls',
      'btn-toggle-mini-astrolabe',
      'mini-size-range',
      'mini-scale-range',
      'modal-consent',
      'consent-toggle-bg',
      'consent-toggle-apps',
      'consent-toggle-python',
      'btn-consent-accept',
      'btn-consent-decline',
      'consent-blocked-banner',
      'modal-python-scripts',
      'btn-py-record-start',
      'btn-py-record-stop',
      'py-recording-indicator',
      'btn-py-save-script',
      'py-scripts-list',
      'group-send-link-chat',
      'group-launch-app',
      'group-python-script'
    ];
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `ID obrigatorio ausente: ${id}`);
    }
    assert.ok(!html.includes('mini-assistant-overlay'), 'mini-assistant-overlay nao deve existir');
    return `${requiredIds.length} IDs obrigatorios presentes`;
  });

  await runCase('M2-04', 'CSS morto do Katharos removido e tema Ponto Preto presente', () => {
    const css = fs.readFileSync(path.join(RENDERER_DIR, 'styles', 'main.css'), 'utf8');
    const forbidden = [
      '.mini-assistant-overlay',
      '.kataros-mascot-canvas',
      '.side-chat-drawer',
      '.side-cmds-panel',
      '.boost-pill',
      '.kit-card',
      'body.mode-mini-assistant'
    ];
    for (const sel of forbidden) {
      assert.ok(!css.includes(sel), `CSS morto ainda presente: ${sel}`);
    }
    assert.ok(css.includes('#040406') && css.includes('#050508'));
    assert.ok(css.includes('#E5B84B') && css.includes('#FFE08A'));
    assert.ok(css.includes('#9E2A2B'));
    assert.ok(css.includes('.central-black-dot-core'));
    return '0 seletores Katharos mortos; tokens Ponto Preto presentes';
  });

  await runCase('M2-05', 'Calculo programatico WCAG (>= 7:1 primario, >= 4.5:1 secundario)', () => {
    const css = fs.readFileSync(path.join(RENDERER_DIR, 'styles', 'main.css'), 'utf8');
    const astrolabeCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'astrolabe3d.js'), 'utf8');
    const vars = parseRootCssVars(css);
    const bgCore = vars['--bg-core'] || '#050508';
    const bgPrim = vars['--bg-primary'] || '#040406';

    const primaryChecks = [
      ['slot-num-badge (#FFFFFF on #040406)', '#FFFFFF', bgPrim],
      ['--text-light on --bg-core', vars['--text-light'], bgCore],
      ['--gold-primary on --bg-core', vars['--gold-primary'], bgCore],
      ['--gold-secondary on --bg-core', vars['--gold-secondary'], bgCore],
      ['--gold-dim on --bg-core', vars['--gold-dim'], bgCore],
      ['--vector-accent on --bg-core', vars['--vector-accent'], bgCore],
      ['--text-muted on --bg-core', vars['--text-muted'], bgCore],
      ['.hud-btn.primary (#050508 on #C99A2E)', '#050508', '#C99A2E'],
      ['.hud-btn.danger (#FFD6D6 on #2B0B0C)', '#FFD6D6', '#2B0B0C'],
      ['#btn-consent-status (#FFFFFF on #9E2A2B)', '#FFFFFF', vars['--nexus-red']]
    ];

    const summary = [];
    for (const [label, fg, bg] of primaryChecks) {
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= 7.0, `Contraste primario < 7.0 para ${label}: ${ratio.toFixed(2)}:1`);
      summary.push(`${label}=${ratio.toFixed(2)}:1`);
    }
    assert.ok(!/\.topbar-kbd\s*\{[^}]*opacity\s*:\s*0\.[0-8]/.test(css), '.topbar-kbd nao deve ter opacity reduzida');
    assert.ok(astrolabeCode.includes("ctx.fillStyle = '#050508'") && astrolabeCode.includes("ctx.fillStyle = '#FFFFFF'"));
    return summary.slice(0, 4).join(', ');
  });

  await runCase('M2-06', 'Astrolabe3D inicia pausado quando solicitado e limpa listeners no destroy()', () => {
    const html = fs.readFileSync(path.join(RENDERER_DIR, 'index.html'), 'utf8');
    const astrolabeCode = fs.readFileSync(path.join(RENDERER_DIR, 'js', 'astrolabe3d.js'), 'utf8');
    const { windowObj, documentObj, context } = (() => {
      const h = createFakeDomHarness(html, true);
      let rafCount = 0;
      let cancelCount = 0;
      let rid = 0;
      const ctx = {
        window: h.windowObj,
        document: h.documentObj,
        localStorage: { getItem: () => null, setItem: () => {} },
        requestAnimationFrame: () => {
          rafCount++;
          return ++rid;
        },
        cancelAnimationFrame: () => {
          cancelCount++;
        },
        getCounts: () => ({ rafCount, cancelCount }),
        console
      };
      h.windowObj.requestAnimationFrame = ctx.requestAnimationFrame;
      h.windowObj.cancelAnimationFrame = ctx.cancelAnimationFrame;
      vm.createContext(ctx);
      vm.runInContext(astrolabeCode, ctx, { filename: 'astrolabe3d.js' });
      return { windowObj: h.windowObj, documentObj: h.documentObj, context: ctx };
    })();

    const canvas = documentObj.getElementById('astrolabe-canvas');
    const instance = new windowObj.Astrolabe3D(canvas, { startPaused: true });
    assert.strictEqual(instance.isPaused, true);
    assert.strictEqual(instance.rafId, null);
    assert.strictEqual(context.getCounts().rafCount, 0);

    const beforeRenderCalls = canvas._canvasCounters.fillRectCount;
    instance.setConfig(makeBaseConfig());
    assert.ok(canvas._canvasCounters.fillRectCount > beforeRenderCalls, 'Deve renderizar quadro estatico quando pausado');
    assert.strictEqual(context.getCounts().rafCount, 0, 'Nao deve iniciar loop RAF em setConfig enquanto pausado');

    instance.start();
    assert.strictEqual(instance.isPaused, false);
    assert.ok(instance.rafId !== null && context.getCounts().rafCount > 0);

    instance.stop();
    assert.strictEqual(instance.isPaused, true);
    assert.strictEqual(instance.rafId, null);
    assert.ok(context.getCounts().cancelCount >= 1);

    const resizeBefore = windowObj.getListenerCount('resize');
    instance.destroy();
    const resizeAfter = windowObj.getListenerCount('resize');
    assert.strictEqual(resizeAfter, Math.max(0, resizeBefore - 1), 'destroy() deve remover listeners da window');
    return 'startPaused=true, static render ok, start/stop ok, destroy() limpou listeners';
  });

  await runCase('M2-07', '#modal-consent abre no estado limpo e NAO bloqueia --self-test', async () => {
    // Cenario A: Estado limpo (nao --self-test)
    const cleanBoot = bootRendererApp({ initialConfig: makeBaseConfig({ consent: { accepted: false, permissions: {} } }) });
    await cleanBoot.triggerDomReady();
    const consentModal = cleanBoot.documentObj.getElementById('modal-consent');
    assert.ok(consentModal.classList.contains('hidden'), 'Nao deve abrir modal-consent antes do fim do splash');

    // Simula clique no splash -> libera astrolabio e abre consentimento
    cleanBoot.documentObj.getElementById('splash-screen').click();
    assert.strictEqual(consentModal.classList.contains('hidden'), false, 'Deve abrir #modal-consent apos splash quando nao aceito');

    cleanBoot.documentObj.getElementById('btn-consent-decline').click();
    await flushAsync();
    assert.strictEqual(cleanBoot.calls.setConsentDecision.length, 1);
    assert.strictEqual(cleanBoot.calls.setConsentDecision[0].accepted, false);
    assert.strictEqual(cleanBoot.documentObj.getElementById('consent-blocked-banner').classList.contains('hidden'), false);

    cleanBoot.documentObj.getElementById('btn-reopen-consent').click();
    assert.strictEqual(consentModal.classList.contains('hidden'), false);
    cleanBoot.documentObj.getElementById('btn-consent-accept').click();
    await flushAsync();
    assert.strictEqual(cleanBoot.calls.setConsentDecision[1].accepted, true);
    assert.strictEqual(consentModal.classList.contains('hidden'), true);

    // Cenario B: Simulacao de --self-test (main.js:338,345)
    const selfTestBoot = bootRendererApp({ initialConfig: makeBaseConfig({ consent: { accepted: false, permissions: {} } }) });
    await selfTestBoot.triggerDomReady();
    selfTestBoot.documentObj.getElementById('splash-welcome-sub').textContent =
      'Sistema M.P.E sincronizado e pronto para integracao entre sistemas.';
    selfTestBoot.documentObj.getElementById('splash-screen').classList.add('hidden');
    assert.strictEqual(
      selfTestBoot.documentObj.getElementById('modal-consent').classList.contains('hidden'),
      true,
      '--self-test nao pode ter #modal-consent bloqueando a tela'
    );
    selfTestBoot.documentObj.getElementById('btn-tab-organizer').click();
    assert.strictEqual(
      selfTestBoot.documentObj.getElementById('organizer-workspace').classList.contains('hidden'),
      false,
      'Organizador deve continuar navegavel durante --self-test'
    );
    return 'Estado limpo (Recusar/Aceitar) ok; --self-test manteve #modal-consent oculto';
  });

  await runCase('M2-08', 'onConfigUpdated, reorderPoint, Mini Astrolabio, Organizador 1-Clique e guarda de hotkey', async () => {
    const boot = bootRendererApp({
      initialConfig: makeBaseConfig({
        consent: {
          accepted: true,
          permissions: { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true }
        }
      })
    });
    await boot.triggerDomReady();
    boot.documentObj.getElementById('splash-screen').click();

    // 1. onConfigUpdated
    const updated = makeBaseConfig({
      consent: {
        accepted: true,
        permissions: { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true }
      }
    });
    updated.points.push({
      id: 'star-03-3',
      code: '03 3',
      title: 'Site Favorito',
      actionType: 'open_url',
      orbit: 3,
      angle: 200,
      params: { url: 'https://example.com' }
    });
    boot.listeners.configUpdated.forEach((cb) => cb({ config: updated, sourceWindow: 'mini' }));
    const slotsList = boot.documentObj.getElementById('slots-list');
    assert.strictEqual(slotsList.children.length, 3, 'slots-list deve refletir 3 slots via onConfigUpdated');

    // 2. Reorder point
    const downBtns = slotsList.querySelectorAll('[data-reorder-dir="down"]');
    assert.ok(downBtns.length >= 1);
    downBtns[0].click();
    await Promise.resolve();
    await Promise.resolve();
    assert.deepStrictEqual(boot.calls.reorderPoint[0], { fromIndex: 0, toIndex: 1 });

    // 3. Mini Astrolabio controls
    boot.documentObj.getElementById('btn-toggle-mini-astrolabe').click();
    await Promise.resolve();
    assert.strictEqual(boot.calls.toggleMiniAstrolabe.length, 1);

    const sizeRange = boot.documentObj.getElementById('mini-size-range');
    sizeRange.value = '84';
    sizeRange.dispatchEvent({ type: 'change' });
    await Promise.resolve();
    assert.strictEqual(boot.calls.updateMiniAstrolabeLayout[0].size, 84);

    // 4. 1-Click Organizer pauses Astrolabe3D and back resumes it
    boot.documentObj.getElementById('btn-main-organize-1click').click();
    assert.strictEqual(boot.documentObj.getElementById('organizer-workspace').classList.contains('hidden'), false);
    const rafAfterOrg = boot.getRafStats().activeCount;
    assert.strictEqual(rafAfterOrg, 0, 'Astrolabe3D deve pausar quando Organizador abre');

    boot.documentObj.getElementById('btn-org-back-astrolabe').click();
    assert.strictEqual(boot.documentObj.getElementById('organizer-workspace').classList.contains('hidden'), true);
    assert.ok(boot.getRafStats().activeCount > 0, 'Astrolabe3D deve retomar ao voltar');

    // 5. Hotkey guard when typing in an INPUT
    const searchInput = boot.documentObj.getElementById('org-search-input');
    boot.documentObj.activeElement = searchInput;
    const beforeExec = boot.calls.executePoint.length;
    boot.windowObj.dispatchEvent({ type: 'keydown', key: '1' });
    assert.strictEqual(boot.calls.executePoint.length, beforeExec, 'Tecla 1 em campo de texto nao deve disparar slot');

    return 'Sync, reorderPoint(0->1), Mini controls, 1-Click Organizer pause/resume e hotkey guard OK';
  });

  await runCase('M2-09', 'Wizard estendido (links, chat/bot, Notepad/VS Code, Python) & UI Python Auto-Script', async () => {
    const boot = bootRendererApp({
      initialConfig: makeBaseConfig({
        consent: {
          accepted: true,
          permissions: { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true }
        }
      })
    });
    await boot.triggerDomReady();
    boot.documentObj.getElementById('splash-screen').click();

    // Test launch_app_project VS Code preset serialization
    boot.documentObj.getElementById('btn-add-star').click();
    // Simulate preset click for vscode_slot
    const vscodePreset = boot.documentObj.querySelector('.wiz-preset-chip[data-preset="vscode_slot"]');
    assert.ok(vscodePreset, 'Preset vscode_slot deve existir');
    vscodePreset.click();
    boot.documentObj.getElementById('btn-save-point').click();
    await Promise.resolve();
    await Promise.resolve();
    const lastSavedCfg = boot.calls.saveConfig[boot.calls.saveConfig.length - 1];
    const savedVscode = lastSavedCfg.points[lastSavedCfg.points.length - 1];
    assert.strictEqual(savedVscode.actionType, 'launch_app_project');
    assert.strictEqual(savedVscode.params.appName, 'vscode');
    assert.strictEqual(savedVscode.params.targetPath, 'code');
    assert.ok(savedVscode.params.projectPath.includes('MousePerformaticoEstrelado'));

    // Test send_link_chat serialization
    const sendLinkPreset = boot.documentObj.querySelector('.wiz-preset-chip[data-preset="send_link_preset"]');
    assert.ok(sendLinkPreset, 'Preset send_link_preset deve existir');
    sendLinkPreset.click();
    boot.documentObj.getElementById('pt-chat-channel').value = 'telegram_bot';
    boot.documentObj.getElementById('pt-chat-link-url').value = 'https://mpe.test/link';
    boot.documentObj.getElementById('btn-save-point').click();
    await Promise.resolve();
    await Promise.resolve();
    const savedChatCfg = boot.calls.saveConfig[boot.calls.saveConfig.length - 1];
    const savedChat = savedChatCfg.points[savedChatCfg.points.length - 1];
    assert.strictEqual(savedChat.actionType, 'send_link_chat');
    assert.strictEqual(savedChat.params.linkUrl, 'https://mpe.test/link');
    assert.strictEqual(savedChat.params.deliveryChannel, 'telegram_bot');

    // Test Python Auto-Script UI IPCs
    boot.documentObj.getElementById('btn-open-python-scripts').click();
    assert.strictEqual(boot.documentObj.getElementById('modal-python-scripts').classList.contains('hidden'), false);
    boot.documentObj.getElementById('py-script-name').value = 'Fluxo E2E';
    boot.documentObj.getElementById('btn-py-record-start').click();
    await Promise.resolve();
    assert.strictEqual(boot.calls.startPythonRecording.length, 1);

    boot.listeners.pyRecordingState.forEach((cb) =>
      cb({ active: true, stepCount: 2, lastStep: { x: 400, y: 300, button: 'left', waitMs: 250 } })
    );
    assert.strictEqual(boot.documentObj.getElementById('py-recording-count').textContent, '2 clique(s)');

    boot.documentObj.getElementById('btn-py-record-stop').click();
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(boot.calls.stopPythonRecording.length, 1);

    boot.documentObj.getElementById('btn-py-save-script').click();
    await Promise.resolve();
    await Promise.resolve();
    assert.strictEqual(boot.calls.savePythonScript.length, 1);

    // Run, schedule, delete on existing script-1
    await flushAsync();
    boot.documentObj.getElementById('btn-py-run-script-1').click();
    await flushAsync();
    assert.strictEqual(boot.calls.runPythonScript.length, 1);

    boot.documentObj.getElementById('btn-py-schedule-script-1').click();
    await flushAsync();
    assert.strictEqual(boot.calls.schedulePythonScript.length, 1);

    boot.documentObj.getElementById('btn-py-delete-script-1').click();
    await flushAsync();
    assert.strictEqual(boot.calls.deletePythonScript.length, 1);

    // Unavailable fallback must not throw
    const unavailBoot = bootRendererApp({
      initialConfig: makeBaseConfig({ consent: { accepted: true, permissions: { pythonAutomation: true } } }),
      mpeApiOverrides: {
        startPythonRecording: async () => ({ ok: false, unavailable: true, message: 'Indisponivel M5' })
      }
    });
    await unavailBoot.triggerDomReady();
    unavailBoot.documentObj.getElementById('btn-py-record-start').click();
    await flushAsync();
    assert.ok(unavailBoot.documentObj.getElementById('hud-toast-text').textContent.includes('Indisponivel'));

    return 'Wizard presets + 6 Python IPCs + recording indicator + unavailable fallback OK';
  });

  if (process.env.MPE_RUN_ELECTRON === '1') {
    await runCase('M2-10', 'Electron --self-test isolado com MPE_CONFIG_PATH temporario', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mpe-m2-selftest-'));
      const tmpCfg = path.join(tmpDir, 'mpe.config.json');
      const tmpUserData = path.join(tmpDir, 'userdata');
      fs.copyFileSync(path.join(CODE_DIR, 'mpe.config.json'), tmpCfg);
      const electronBin = path.join(CODE_DIR, 'node_modules', '.bin', 'electron.cmd');
      try {
        const out = await new Promise((resolve, reject) => {
          const child = spawn(electronBin, ['.', '--self-test', `--user-data-dir=${tmpUserData}`], {
            cwd: CODE_DIR,
            env: Object.assign({}, process.env, { MPE_CONFIG_PATH: tmpCfg }),
            shell: true
          });
          let buf = '';
          child.stdout.on('data', (d) => (buf += d.toString()));
          child.stderr.on('data', (d) => (buf += d.toString()));
          child.on('exit', (code) => {
            if (code === 0 && buf.includes('MPE_SELF_TEST_PASSED')) resolve(buf);
            else reject(new Error(`Electron exit=${code}: ${buf}`));
          });
        });
        assert.ok(out.includes('MPE_SELF_TEST_PASSED'));
        return 'MPE_SELF_TEST_PASSED exit 0';
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch (_) {}
      }
    });
  }

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  console.log('\n=== RESUMO DA BATERIA M2 ===');
  console.log(`Total: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
