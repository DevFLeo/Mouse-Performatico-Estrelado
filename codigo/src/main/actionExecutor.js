const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const { exec, execFile, execFileSync, spawn } = require('child_process');
const { desktopCapturer, screen, clipboard, nativeImage, shell } = require('electron');

const BLOCKED_CONSENT_MESSAGE = 'Aceite de primeiro acesso necessario.';

const APP_ALIASES = {
  'bloco de notas': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
  'bloco de nota': { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
  notepad: { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
  notas: { cmd: 'notepad.exe', query: 'notepad', label: 'Bloco de Notas' },
  paint: { cmd: 'mspaint.exe', query: 'paint', label: 'Paint' },
  mspaint: { cmd: 'mspaint.exe', query: 'paint', label: 'Paint' },
  calculadora: { cmd: 'calc.exe', query: 'calcul', label: 'Calculadora' },
  calc: { cmd: 'calc.exe', query: 'calcul', label: 'Calculadora' },
  word: { cmd: 'winword.exe', query: 'word', label: 'Microsoft Word' },
  winword: { cmd: 'winword.exe', query: 'word', label: 'Microsoft Word' },
  excel: { cmd: 'excel.exe', query: 'excel', label: 'Microsoft Excel' },
  powerpoint: { cmd: 'powerpnt.exe', query: 'powerpoint', label: 'PowerPoint' },
  chrome: { cmd: 'chrome.exe', query: 'chrome', label: 'Google Chrome' },
  'google chrome': { cmd: 'chrome.exe', query: 'chrome', label: 'Google Chrome' },
  edge: { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
  msedge: { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
  'microsoft edge': { cmd: 'msedge.exe', query: 'edge', label: 'Microsoft Edge' },
  cmd: { cmd: 'cmd.exe', query: 'cmd', label: 'Prompt de Comando' },
  prompt: { cmd: 'cmd.exe', query: 'cmd', label: 'Prompt de Comando' },
  powershell: { cmd: 'powershell.exe', query: 'powershell', label: 'PowerShell' },
  terminal: { cmd: 'wt.exe', fallbackCmd: 'cmd.exe', query: 'terminal', label: 'Windows Terminal' },
  vscode: { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
  code: { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
  'vs code': { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
  'visual studio code': { cmd: 'code.cmd', fallbackCmd: 'code.exe', query: 'visual studio code', label: 'VS Code' },
  explorer: { cmd: 'explorer.exe', query: 'explorer', label: 'Explorador de Arquivos' },
  telegram: { protocol: 'tg://', cmd: 'Telegram.exe', query: 'telegram', label: 'Telegram' },
  tg: { protocol: 'tg://', cmd: 'Telegram.exe', query: 'telegram', label: 'Telegram' },
  whatsapp: { protocol: 'whatsapp://', query: 'whatsapp', label: 'WhatsApp' },
  discord: { protocol: 'discord://', query: 'discord', label: 'Discord' }
};

const CONSENT_SCOPE_BY_ACTION = {
  run_python_script: 'pythonAutomation',
  open_organizer: null,
  organize_files_quick: null,
  open_settings: null,
  toggle_2d_3d: null,
  open_url: 'launchAppsAndLinks',
  send_link_chat: 'launchAppsAndLinks',
  launch_app_project: 'launchAppsAndLinks',
  open_path: 'launchAppsAndLinks',
  command: 'launchAppsAndLinks',
  print: 'launchAppsAndLinks',
  named_print: 'launchAppsAndLinks',
  system_to_system_print: 'launchAppsAndLinks',
  print_telegram: 'launchAppsAndLinks',
  area_print: 'launchAppsAndLinks',
  area_print_telegram: 'launchAppsAndLinks',
  area_print_system: 'launchAppsAndLinks',
  text_selection: 'launchAppsAndLinks',
  text_telegram: 'launchAppsAndLinks',
  text_to_system: 'launchAppsAndLinks',
  action_2d_scan: 'launchAppsAndLinks'
};

/**
 * Motor de Execucao de Acoes Performaticas e Integracao Entre Sistemas (M.P.E)
 * Suporta:
 *  - Print de um Sistema de Origem e envio automatico para outro Sistema de Destino no Windows
 *  - Print + Envio para Conversa Salva no Telegram (Desktop tg:// e/ou Bot API)
 *  - Recorte de Area Interativo + Envio para Sistema de Destino ou Telegram
 *  - Captura de Selecao de Texto no Sistema de Origem + Transferencia para Outro Sistema
 *  - Abertura de Pastas, Executaveis, Links, Chats/Bots, Projetos e Auto-Scripts Python
 */
class ActionExecutor {
  constructor(configManager, hookBridge, optionsOrConsent = {}) {
    this.configManager = configManager;
    this.hookBridge = hookBridge;

    if (optionsOrConsent && typeof optionsOrConsent.isActionAllowed === 'function') {
      this.consentManager = optionsOrConsent;
      this.pythonScheduler = null;
      this._deps = {};
    } else {
      const opts = optionsOrConsent && typeof optionsOrConsent === 'object' ? optionsOrConsent : {};
      this.consentManager = opts.consentManager || null;
      this.pythonScheduler = opts.pythonScheduler || null;
      this._deps = opts;
    }

    this._spawn = typeof this._deps.spawn === 'function' ? this._deps.spawn : spawn;
    this._exec = typeof this._deps.exec === 'function' ? this._deps.exec : exec;
    this._execFile = typeof this._deps.execFile === 'function' ? this._deps.execFile : execFile;
    this._shell = this._deps.shell || shell;
    this._clipboard = this._deps.clipboard || clipboard;
    this._httpRequest = typeof this._deps.httpRequest === 'function' ? this._deps.httpRequest : null;
    this._pollIntervalMs = typeof this._deps.pollIntervalMs === 'number' ? this._deps.pollIntervalMs : 250;
    this._maxPollAttempts = typeof this._deps.maxPollAttempts === 'number' ? this._deps.maxPollAttempts : 8;
  }

  setConsentManager(consentManager) {
    this.consentManager = consentManager || null;
  }

  setPythonScheduler(pythonScheduler) {
    this.pythonScheduler = pythonScheduler || null;
  }

  _getBlockedResponse() {
    if (this.consentManager) {
      if (typeof this.consentManager.getBlockedResponse === 'function') {
        return this.consentManager.getBlockedResponse();
      }
      if (typeof this.consentManager.gateResult === 'function') {
        return this.consentManager.gateResult();
      }
    }
    return {
      ok: false,
      blockedByConsent: true,
      message: BLOCKED_CONSENT_MESSAGE
    };
  }

  getRequiredConsentScope(actionType) {
    if (Object.prototype.hasOwnProperty.call(CONSENT_SCOPE_BY_ACTION, actionType)) {
      return CONSENT_SCOPE_BY_ACTION[actionType];
    }
    return null;
  }

  _checkConsent(scope, actionType = null) {
    if (!scope) return null;
    if (this.consentManager && typeof this.consentManager.isActionAllowed === 'function') {
      if (!this.consentManager.isActionAllowed(scope)) {
        return this._getBlockedResponse();
      }
      return null;
    }
    // Sem consentManager injetado: mantem compatibilidade retroativa para EXE-01/EXE-02,
    // mas aplica fail-closed em run_python_script caso cfg.consent exista.
    if (actionType === 'run_python_script' && scope === 'pythonAutomation') {
      const cfg =
        this.configManager && typeof this.configManager.get === 'function'
          ? this.configManager.get()
          : null;
      if (cfg && cfg.consent && typeof cfg.consent === 'object') {
        const allowed =
          cfg.consent.accepted === true &&
          Boolean(cfg.consent.permissions && cfg.consent.permissions.pythonAutomation === true);
        if (!allowed) {
          return this._getBlockedResponse();
        }
      }
    }
    return null;
  }

  _normalizeHttpUrl(rawUrl) {
    const raw = String(rawUrl || '').trim();
    if (!raw) {
      return { ok: false, message: 'Nenhuma URL informada.' };
    }
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !/^https?:\/\//i.test(raw)) {
      return { ok: false, message: 'Protocolo nao permitido. Utilize http:// ou https://.' };
    }
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, message: 'Protocolo nao permitido. Utilize http:// ou https://.' };
      }
      if (!parsed.hostname) {
        return { ok: false, message: 'URL invalida: host ausente.' };
      }
      return { ok: true, url: candidate, parsed };
    } catch (_) {
      return { ok: false, message: `URL invalida: ${raw}` };
    }
  }

  _getTelegramApiBase() {
    const base = String(process.env.MPE_TELEGRAM_API_BASE || 'https://api.telegram.org').trim();
    return base.replace(/\/+$/, '') || 'https://api.telegram.org';
  }

  _requestUrl(targetUrl, { method = 'GET', headers = {}, body = null, timeoutMs = 8000 } = {}) {
    return new Promise((resolve, reject) => {
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch (err) {
        return reject(new Error(`URL invalida: ${targetUrl}`));
      }

      const transportFn = this._httpRequest
        ? this._httpRequest
        : parsed.protocol === 'http:'
        ? http.request
        : https.request;

      const reqOpts = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        timeout: timeoutMs
      };

      const req = transportFn(reqOpts, (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d))));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers || {},
            body: text
          });
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Tempo limite excedido (${timeoutMs}ms)`));
      });
      req.on('error', reject);
      if (body !== null && body !== undefined) {
        req.write(body);
      }
      req.end();
    });
  }

  async _postJson(targetUrl, payloadObj, timeoutMs = 8000) {
    try {
      const payload = JSON.stringify(payloadObj || {});
      const resp = await this._requestUrl(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        body: payload,
        timeoutMs
      });

      let parsedJson = null;
      try {
        parsedJson = resp.body ? JSON.parse(resp.body) : null;
      } catch (_) {}

      if (resp.statusCode >= 200 && resp.statusCode < 300) {
        return {
          ok: true,
          statusCode: resp.statusCode,
          body: resp.body,
          json: parsedJson
        };
      }
      return {
        ok: false,
        statusCode: resp.statusCode,
        body: resp.body,
        json: parsedJson,
        message: `HTTP ${resp.statusCode}: ${resp.body || 'Erro na requisicao.'}`
      };
    } catch (err) {
      return {
        ok: false,
        statusCode: 0,
        message: err && err.message ? err.message : String(err)
      };
    }
  }

  _verifyLoopbackHttpUrl(targetUrl, timeoutMs = 5000) {
    return new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL(targetUrl);
      } catch (err) {
        return resolve({
          ok: false,
          type: 'open_url',
          url: targetUrl,
          verifiedViaHttp: true,
          message: `URL invalida: ${targetUrl}`
        });
      }

      const transportFn = this._httpRequest || http.request;
      const req = transportFn(
        {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          timeout: timeoutMs
        },
        (res) => {
          const statusCode = res.statusCode || 0;
          res.resume();
          res.on('end', () => {
            if (statusCode >= 200 && statusCode < 400) {
              resolve({
                ok: true,
                type: 'open_url',
                url: targetUrl,
                statusCode,
                verifiedViaHttp: true,
                message: `URL verificada via HTTP (${statusCode}): ${targetUrl}`
              });
            } else {
              resolve({
                ok: false,
                type: 'open_url',
                url: targetUrl,
                statusCode,
                verifiedViaHttp: true,
                message: `Falha HTTP ${statusCode} ao acessar ${targetUrl}`
              });
            }
          });
        }
      );

      req.on('timeout', () => {
        req.destroy(new Error(`Tempo limite HTTP (${timeoutMs}ms) ao acessar ${targetUrl}`));
      });
      req.on('error', (err) => {
        resolve({
          ok: false,
          type: 'open_url',
          url: targetUrl,
          verifiedViaHttp: true,
          message: `Erro HTTP ao acessar ${targetUrl}: ${err && err.message ? err.message : String(err)}`
        });
      });
      req.end();
    });
  }

  _findTelegramDesktopExe() {
    const tgAppPaths = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'Telegram Desktop', 'Telegram.exe') : '',
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Telegram Desktop', 'Telegram.exe') : '',
      'C:\\Program Files\\Telegram Desktop\\Telegram.exe'
    ].filter(Boolean);
    for (const p of tgAppPaths) {
      try {
        if (fs.existsSync(p)) return p;
      } catch (_) {}
    }
    return null;
  }

  _getVsCodeDiskPaths() {
    const candidates = [
      process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe')
        : '',
      process.env.ProgramFiles
        ? path.join(process.env.ProgramFiles, 'Microsoft VS Code', 'Code.exe')
        : '',
      process.env['ProgramFiles(x86)']
        ? path.join(process.env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe')
        : ''
    ].filter(Boolean);
    return candidates.filter((p) => {
      try {
        return fs.existsSync(p);
      } catch (_) {
        return false;
      }
    });
  }

  _parseLaunchArgs(rawArgs) {
    if (Array.isArray(rawArgs)) {
      return rawArgs.map((a) => String(a)).filter((a) => a.length > 0);
    }
    if (typeof rawArgs === 'string' && rawArgs.trim()) {
      const tokens = [];
      let current = '';
      let quote = null;
      let hasToken = false;
      for (let i = 0; i < rawArgs.length; i++) {
        const ch = rawArgs[i];
        if (quote) {
          if (ch === quote) {
            quote = null;
          } else {
            current += ch;
          }
          hasToken = true;
        } else if (ch === '"' || ch === "'") {
          quote = ch;
          hasToken = true;
        } else if (/\s/.test(ch)) {
          if (hasToken) {
            if (current.length > 0) tokens.push(current);
            current = '';
            hasToken = false;
          }
        } else {
          current += ch;
          hasToken = true;
        }
      }
      if (hasToken && current.length > 0) {
        tokens.push(current);
      }
      return tokens;
    }
    return [];
  }

  _resolveBatchExecutable(candidate) {
    const raw = String(candidate || '').trim();
    if (!raw) return null;
    if (/[\\/]/.test(raw) || /^[a-zA-Z]:/.test(raw)) {
      const resolved = path.resolve(raw);
      try {
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          return resolved;
        }
      } catch (_) {}
      return null;
    }
    const pathEntries = String(process.env.PATH || process.env.Path || '')
      .split(path.delimiter)
      .map((entry) => entry.replace(/^"+|"+$/g, '').trim())
      .filter(Boolean);
    const searchDirs = [process.cwd(), ...pathEntries];
    for (const dir of searchDirs) {
      const full = path.join(dir, raw);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          return full;
        }
      } catch (_) {}
    }
    return null;
  }

  _quoteCmdArg(arg) {
    return `"${String(arg).replace(/"/g, '')}"`;
  }

  async _spawnDetachedApp(candidates, launchArgs = []) {
    const seen = new Set();
    const uniqueCandidates = [];
    for (const c of candidates || []) {
      const trimmed = String(c || '').trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniqueCandidates.push(trimmed);
    }

    if (!uniqueCandidates.length) {
      return { ok: false, message: 'Nenhum executavel informado para iniciar.' };
    }

    let lastError = null;
    for (const candidate of uniqueCandidates) {
      const isBatch = /\.(cmd|bat)$/i.test(candidate);
      let bin = candidate;
      let args = [...launchArgs];
      const spawnOpts = {
        detached: true,
        windowsHide: true,
        stdio: 'ignore'
      };

      if (isBatch) {
        const resolvedBatch = this._resolveBatchExecutable(candidate);
        if (!resolvedBatch) {
          lastError = Object.assign(new Error(`ENOENT: arquivo batch nao encontrado (${candidate})`), {
            code: 'ENOENT'
          });
          continue;
        }
        const quotedCommandLine = [resolvedBatch, ...launchArgs].map((a) => this._quoteCmdArg(a)).join(' ');
        bin = process.env.ComSpec || 'cmd.exe';
        args = ['/d', '/s', '/c', `"${quotedCommandLine}"`];
        spawnOpts.windowsVerbatimArguments = true;
      }

      const attempt = await new Promise((resolve) => {
        let settled = false;
        let timer = null;
        let spawned = false;
        const finish = (res) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          resolve(res);
        };

        let child;
        try {
          child = this._spawn(bin, args, spawnOpts);
        } catch (err) {
          return finish({ ok: false, error: err });
        }

        if (!child || typeof child.once !== 'function') {
          if (child && typeof child.unref === 'function') child.unref();
          return finish({ ok: true, executable: candidate, usedCmdWrapper: isBatch });
        }

        child.once('error', (err) => {
          finish({ ok: false, error: err });
        });

        if (isBatch) {
          child.once('spawn', () => {
            spawned = true;
            if (typeof child.unref === 'function') {
              try { child.unref(); } catch (_) {}
            }
          });

          child.once('exit', (code) => {
            if (code === 0) {
              finish({ ok: true, executable: candidate, pid: child.pid, usedCmdWrapper: true, exitCode: 0 });
            } else {
              finish({
                ok: false,
                error: new Error(`Batch finalizou com codigo ${code}`),
                exitCode: code
              });
            }
          });

          timer = setTimeout(() => {
            if (typeof child.unref === 'function') {
              try { child.unref(); } catch (_) {}
            }
            if (!spawned && child.exitCode !== null && child.exitCode !== 0) {
              finish({
                ok: false,
                error: new Error(`Batch finalizou com codigo ${child.exitCode}`),
                exitCode: child.exitCode
              });
              return;
            }
            finish({ ok: true, executable: candidate, pid: child.pid, usedCmdWrapper: true });
          }, 150);
        } else {
          child.once('spawn', () => {
            if (typeof child.unref === 'function') {
              try { child.unref(); } catch (_) {}
            }
            finish({ ok: true, executable: candidate, pid: child.pid, usedCmdWrapper: false });
          });

          timer = setTimeout(() => {
            if (typeof child.unref === 'function') {
              try { child.unref(); } catch (_) {}
            }
            finish({ ok: true, executable: candidate, pid: child.pid, usedCmdWrapper: false });
          }, 80);
        }
      });

      if (attempt.ok) {
        return attempt;
      }
      lastError = attempt.error;
    }

    return {
      ok: false,
      message: lastError && lastError.message
        ? `Falha ao iniciar aplicativo (${uniqueCandidates[0]}): ${lastError.message}`
        : `Falha ao iniciar aplicativo: ${uniqueCandidates[0]}`
    };
  }

  /**
   * Captura a tela ou a janela exata do Sistema de Origem em alta resolucao.
   * Prioriza o snapshot pre-capturado pelo daemon Win32 no instante exato do atalho (Zero Flicker).
   */
  async captureScreenImage(cropToOriginWindow = false, mainWindow = null) {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;
    const scaleFactor = primaryDisplay.scaleFactor || 1;

    if (this.hookBridge) {
      const candidatePath = cropToOriginWindow
        ? this.hookBridge.lastWinSnapPath || this.hookBridge.lastFullSnapPath
        : this.hookBridge.lastFullSnapPath;

      if (candidatePath && fs.existsSync(candidatePath)) {
        try {
          const stat = fs.statSync(candidatePath);
          // Se o snapshot foi capturado recentemente, utiliza-o em 0ms sem piscar a tela
          if (Date.now() - stat.mtimeMs < 120000) {
            const preImg = nativeImage.createFromPath(candidatePath);
            if (!preImg.isEmpty()) {
              return {
                image: preImg,
                displaySize: { width, height, scaleFactor },
                fromPreCapture: true
              };
            }
          }
        } catch (_) {}
      }
    }

    const thumbWidth = Math.floor(width * scaleFactor);
    const thumbHeight = Math.floor(height * scaleFactor);

    // Captura nativa ultra-rapida via GDI+ (MpeHook.exe --CAPTURE-NOW)
    if (this.hookBridge && typeof this.hookBridge.captureScreenFast === 'function') {
      const fastTmpPath = path.join(
        this.configManager.dataDir || path.join(this.configManager.codeDir || this.configManager.rootDir, 'data'),
        '.cache',
        '_fast_capture_cache.png'
      );
      const dir = path.dirname(fastTmpPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const okFast = await this.hookBridge.captureScreenFast(fastTmpPath);
      if (okFast && fs.existsSync(fastTmpPath)) {
        let fastImg = nativeImage.createFromPath(fastTmpPath);
        if (!fastImg.isEmpty()) {
          if (cropToOriginWindow && this.hookBridge.lastWindowRect) {
            const rect = this.hookBridge.lastWindowRect;
            if (rect.width > 80 && rect.height > 80) {
              try {
                const cropped = fastImg.crop({
                  x: Math.max(0, Math.floor(rect.left)),
                  y: Math.max(0, Math.floor(rect.top)),
                  width: Math.min(fastImg.getSize().width, Math.floor(rect.width)),
                  height: Math.min(fastImg.getSize().height, Math.floor(rect.height))
                });
                if (!cropped.isEmpty()) {
                  fastImg = cropped;
                }
              } catch (_) {}
            }
          }
          return {
            image: fastImg,
            displaySize: { width, height, scaleFactor },
            fromNativeGdi: true
          };
        }
      }
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: thumbWidth, height: thumbHeight }
    });

    if (!sources || sources.length === 0) {
      throw new Error('Nenhuma fonte de video encontrada para captura.');
    }

    let finalImage = sources[0].thumbnail;

    // Se solicitado capturar especificamente a janela do Sistema de Origem
    if (cropToOriginWindow && this.hookBridge && this.hookBridge.lastWindowRect) {
      const rect = this.hookBridge.lastWindowRect;
      const cx = Math.max(0, Math.floor(rect.left * scaleFactor));
      const cy = Math.max(0, Math.floor(rect.top * scaleFactor));
      const cw = Math.min(thumbWidth - cx, Math.floor(rect.width * scaleFactor));
      const ch = Math.min(thumbHeight - cy, Math.floor(rect.height * scaleFactor));

      if (cw > 60 && ch > 60) {
        try {
          finalImage = finalImage.crop({ x: cx, y: cy, width: cw, height: ch });
        } catch (_) {}
      }
    }

    if (finalImage.isEmpty() && mainWindow && mainWindow.webContents) {
      try {
        finalImage = await mainWindow.webContents.capturePage();
      } catch (_) {}
    }

    return {
      image: finalImage,
      displaySize: { width, height, scaleFactor }
    };
  }

  sanitizeSegment(str, fallback = 'Geral') {
    const cleaned = String(str || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\/\\:*?"<>|]/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned ? cleaned.slice(0, 48) : fallback;
  }

  /**
   * Salva uma NativeImage em disco com organizacao parametrizada (sistema, data, categoria, nome customizado)
   * e grava no Clipboard do Windows.
   */
  saveAndCopyImage(img, customSaveDir, optionsOrPrefix = 'MPE_Print') {
    const opts =
      typeof optionsOrPrefix === 'string'
        ? { prefix: optionsOrPrefix }
        : Object.assign({}, optionsOrPrefix || {});

    const cfg = this.configManager.get();
    const capCfg = cfg.captures || {};
    const rawFolder =
      customSaveDir ||
      (cfg.telegram && cfg.telegram.savedScreenshotsFolder) ||
      './prints';
    const baseDir = this.configManager.resolvePath(rawFolder);

    const now = new Date();
    const yyyy = String(now.getFullYear());
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    const monthStr = `${yyyy}-${mm}`;
    const timeStr = `${hh}${mi}${ss}`;

    const rawOrigin =
      opts.originSystem ||
      (this.hookBridge && this.hookBridge.lastWindowTitle) ||
      'Sistema';
    const cleanOrigin = this.sanitizeSegment(
      String(rawOrigin).split(' - ').pop() || rawOrigin,
      'Sistema'
    ).slice(0, 28);

    const orgMode = opts.organizationMode || capCfg.organizationMode || 'system_date';
    const cleanCategory = opts.category
      ? this.sanitizeSegment(opts.category, capCfg.defaultCategory || 'Geral')
      : '';

    let subPath = '';
    if (cleanCategory) {
      if (orgMode === 'date') subPath = path.join(dateStr, cleanCategory);
      else if (orgMode === 'flat') subPath = cleanCategory;
      else subPath = path.join(cleanCategory, monthStr);
    } else if (orgMode === 'system_date') {
      subPath = path.join(cleanOrigin, monthStr);
    } else if (orgMode === 'date') {
      subPath = dateStr;
    } else if (orgMode === 'system') {
      subPath = cleanOrigin;
    } else if (orgMode === 'category') {
      subPath = path.join(this.sanitizeSegment(capCfg.defaultCategory || 'Geral', 'Geral'), monthStr);
    }

    const targetDir = subPath ? path.join(baseDir, subPath) : baseDir;
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    let baseName = '';
    if (opts.customName && String(opts.customName).trim()) {
      baseName = this.sanitizeSegment(opts.customName, `Print_${dateStr}_${timeStr}`).slice(0, 72);
    } else {
      const prefix = opts.prefix || capCfg.defaultPrefix || 'MPE';
      const pattern = capCfg.namingPattern || '{prefix}_{system}_{date}_{time}';
      baseName = pattern
        .replace(/\{prefix\}/gi, this.sanitizeSegment(prefix, 'MPE'))
        .replace(/\{system\}/gi, cleanOrigin)
        .replace(/\{category\}/gi, cleanCategory || this.sanitizeSegment(capCfg.defaultCategory || 'Geral', 'Geral'))
        .replace(/\{date\}/gi, `${yyyy}${mm}${dd}`)
        .replace(/\{time\}/gi, timeStr)
        .replace(/\{name\}/gi, cleanOrigin);
      baseName = this.sanitizeSegment(baseName, `${prefix}_${yyyy}${mm}${dd}_${timeStr}`);
    }

    let fileName = `${baseName}.png`;
    let filePath = path.join(targetDir, fileName);
    if (fs.existsSync(filePath)) {
      fileName = `${baseName}_${timeStr}.png`;
      filePath = path.join(targetDir, fileName);
    }

    const pngBuffer = img.toPNG();
    fs.writeFileSync(filePath, pngBuffer);
    this._clipboard.writeImage(img);

    const relativePath = path.relative(baseDir, filePath).replace(/\\/g, '/');

    return {
      filePath,
      fileName,
      relativePath,
      targetDir,
      category: cleanCategory || capCfg.defaultCategory || 'Geral',
      originSystem: cleanOrigin,
      pngBuffer
    };
  }

  _isTelegramTarget(rawTarget) {
    const t = String(rawTarget || '').trim().toLowerCase();
    if (!t) return false;
    if (
      t.includes('tg://') ||
      t.startsWith('@') ||
      t.includes('telegram') ||
      t.includes('eu |') ||
      t.includes('você') ||
      t.includes('voce')
    ) {
      return true;
    }
    const cfg =
      this.configManager && typeof this.configManager.get === 'function'
        ? this.configManager.get()
        : null;
    const savedChat = String((cfg && cfg.telegram && cfg.telegram.savedChatPath) || '').trim().toLowerCase();
    return Boolean(savedChat && t === savedChat);
  }

  /**
   * Transfere o conteudo (Print ou Texto ja no Clipboard) para qualquer outro Sistema no Windows
   * Se o sistema informado nao estiver aberto, o M.P.E inicia o executavel/protocolo e aguarda a janela abrir para colar.
   */
  async dispatchToTargetSystem(rawOpts = {}) {
    const opts = rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts) ? rawOpts : {};
    const { targetSystem, autoSendEnter = true, isTelegram = false, pngBuffer, filePath, textMessage } = opts;

    const blocked = this._checkConsent('launchAppsAndLinks', 'dispatchToTargetSystem');
    if (blocked) return blocked;

    if (isTelegram || this._isTelegramTarget(targetSystem)) {
      return await this.dispatchToTelegram({
        pngBuffer,
        filePath,
        textMessage,
        customTarget: targetSystem,
        autoSendEnter
      });
    }

    const rawTarget = (targetSystem || '').trim();
    if (!rawTarget) {
      return { ok: false, message: 'Nenhum sistema de destino informado.' };
    }

    if (textMessage && !pngBuffer) {
      this._clipboard.writeText(textMessage);
    }

    // 1. Tenta localizar a janela do sistema se ele ja estiver aberto no Windows
    if (this.hookBridge && typeof this.hookBridge.deliverToSystem === 'function') {
      const delivered = await this.hookBridge.deliverToSystem(rawTarget, autoSendEnter);
      if (delivered && delivered.ok) {
        return {
          ok: true,
          targetSystem: delivered.matchedTitle || rawTarget,
          filePath: filePath || null,
          mode: 'focused_and_delivered'
        };
      }
    }

    // 2. Se a janela ainda nao estava aberta, descobre o comando / executavel para abrir o sistema
    const targetLower = rawTarget.toLowerCase();
    let searchTitleAfterLaunch = rawTarget;
    let launchSucceeded = false;
    const exeCandidates = [];

    let alias = Object.prototype.hasOwnProperty.call(APP_ALIASES, targetLower) ? APP_ALIASES[targetLower] : null;
    if (!alias) {
      const aliasEntries = Object.entries(APP_ALIASES).sort((a, b) => b[0].length - a[0].length);
      for (const [k, v] of aliasEntries) {
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`\\b${escaped}\\b`, 'i');
        if (re.test(targetLower)) {
          alias = v;
          break;
        }
      }
    }

    if (alias) {
      if (alias.query === 'telegram') {
        const tgExe = this._findTelegramDesktopExe();
        if (tgExe) exeCandidates.push(tgExe);
      }
      if (alias.protocol) {
        try {
          await this._shell.openExternal(alias.protocol);
          launchSucceeded = true;
        } catch (_) {}
        searchTitleAfterLaunch = alias.query;
      }
      if (alias.cmd && alias.query !== 'telegram') {
        exeCandidates.push(alias.cmd);
        if (alias.fallbackCmd) exeCandidates.push(alias.fallbackCmd);
        searchTitleAfterLaunch = alias.query;
      }
    } else if (rawTarget.includes('://')) {
      try {
        await this._shell.openExternal(rawTarget);
        launchSucceeded = true;
      } catch (_) {}
    } else {
      const resolvedPath =
        this.configManager && typeof this.configManager.resolvePath === 'function'
          ? this.configManager.resolvePath(rawTarget)
          : path.resolve(rawTarget);
      if (fs.existsSync(resolvedPath)) {
        try {
          const openErr = await this._shell.openPath(resolvedPath);
          if (!openErr) launchSucceeded = true;
        } catch (_) {}
        searchTitleAfterLaunch = path.basename(resolvedPath, path.extname(resolvedPath));
      } else {
        exeCandidates.push(rawTarget.endsWith('.exe') || rawTarget.endsWith('.cmd') ? rawTarget : `${rawTarget}.exe`);
      }
    }

    if (exeCandidates.length > 0 && !(alias && alias.query === 'telegram' && launchSucceeded && !this._findTelegramDesktopExe())) {
      const spawnRes = await this._spawnDetachedApp(exeCandidates, []);
      if (spawnRes.ok) {
        launchSucceeded = true;
      }
    }

    // 3. Aguarda dinamicamente a janela do aplicativo abrir, foca e cola (sem relancar no loop)
    const query = searchTitleAfterLaunch || rawTarget;
    let launchedAndDelivered = false;
    let finalTitle = (alias && alias.label) || rawTarget;
    const pollDelay = Math.max(10, this._pollIntervalMs || 350);
    const maxAttempts = Math.min(8, Math.max(1, this._maxPollAttempts || 8));

    if (this.hookBridge && typeof this.hookBridge.deliverToSystem === 'function') {
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        const res = await this.hookBridge.deliverToSystem(query, autoSendEnter);
        if (res && res.ok) {
          launchedAndDelivered = true;
          finalTitle = res.matchedTitle || finalTitle;
          break;
        }
      }
    }

    if (!launchedAndDelivered && !launchSucceeded) {
      return {
        ok: false,
        targetSystem: finalTitle,
        filePath: filePath || null,
        message: `Nao foi possivel abrir ou localizar o sistema de destino: ${finalTitle}.`
      };
    }

    if (!launchedAndDelivered && this.hookBridge && typeof this.hookBridge.pasteAndSendInActiveWindow === 'function') {
      await this.hookBridge.pasteAndSendInActiveWindow(autoSendEnter);
    }

    return {
      ok: true,
      targetSystem: finalTitle,
      filePath: filePath || null,
      mode: launchedAndDelivered ? 'launched_and_delivered' : 'clipboard_ready'
    };
  }

  /**
   * Envia imagem e/ou texto para o Telegram:
   * 1. Se houver Bot Token + Chat ID (e !skipBot), envia silenciosamente via API do Telegram.
   * 2. Desperta o Telegram Desktop (processo local ou tg://) e transfere o conteudo com foco e disparo automatico.
   */
  async dispatchToTelegram(rawOpts = {}) {
    const opts = rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts) ? rawOpts : {};
    const { pngBuffer, filePath, textMessage, customTarget, autoSendEnter, skipBot = false } = opts;

    const blocked = this._checkConsent('launchAppsAndLinks', 'dispatchToTelegram');
    if (blocked) return blocked;

    const cfg = (this.configManager && typeof this.configManager.get === 'function' ? this.configManager.get() : {}) || {};
    const tg = cfg.telegram || {};
    const userName = (cfg.profile && cfg.profile.userName) || 'Leonardo';
    const dateStr = new Date().toLocaleString('pt-BR');
    const shouldAutoSend = typeof autoSendEnter === 'boolean' ? autoSendEnter : tg.autoSend !== false;

    const caption =
      textMessage ||
      (tg.captionTemplate || '[M.P.E] Captura enviada por {user} em {date}')
        .replace('{user}', userName)
        .replace('{date}', dateStr);

    let botSent = false;
    if (!skipBot && tg.botToken && tg.chatId) {
      try {
        if (pngBuffer) {
          await this.sendTelegramBotPhoto(tg.botToken, tg.chatId, pngBuffer, caption);
        } else {
          await this.sendTelegramBotMessage(tg.botToken, tg.chatId, caption);
        }
        botSent = true;
      } catch (err) {
        console.warn('[M.P.E Telegram Bot] Erro no envio via API:', err.message);
      }
    }

    const targetChat = (customTarget || tg.savedChatPath || 'Eu | Você | Leonardo').trim();

    if (textMessage && !pngBuffer) {
      this._clipboard.writeText(textMessage);
    }

    // 1. Tenta focar diretamente na janela existente do Telegram Desktop
    if (this.hookBridge && typeof this.hookBridge.deliverToSystem === 'function') {
      const res = await this.hookBridge.deliverToSystem(targetChat, shouldAutoSend);
      if (res && res.ok) {
        return {
          ok: true,
          botSent,
          mode: 'focused_and_delivered',
          targetChat: `${targetChat} (${res.matchedTitle || 'Telegram'})`,
          filePath: filePath || null
        };
      }
    }

    // 2. Se a janela nao estiver visivel, desperta o Telegram uma unica vez
    let launchedExe = false;
    let externalOpened = false;
    const tgExe = this._findTelegramDesktopExe();
    if (tgExe) {
      const spawnRes = await this._spawnDetachedApp([tgExe], []);
      launchedExe = Boolean(spawnRes.ok);
    }

    let deepLink = targetChat;
    if (deepLink.startsWith('@')) {
      deepLink = `tg://resolve?domain=${deepLink.slice(1)}`;
    } else if (deepLink.startsWith('https://t.me/')) {
      const domain = deepLink.replace('https://t.me/', '').split('/')[0];
      deepLink = `tg://resolve?domain=${domain}`;
    }

    if (!launchedExe && (deepLink.startsWith('tg://') || deepLink.startsWith('http://') || deepLink.startsWith('https://'))) {
      try {
        await this._shell.openExternal(deepLink);
        externalOpened = true;
      } catch (_) {}
    } else if (!launchedExe) {
      try {
        await this._shell.openExternal('tg://');
        externalOpened = true;
      } catch (_) {}
    }

    // 3. Aguarda dinamicamente o Telegram se tornar visivel e envia
    let delivered = false;
    const pollDelay = Math.max(10, this._pollIntervalMs || 350);
    const maxAttempts = Math.min(8, Math.max(1, this._maxPollAttempts || 8));

    if (this.hookBridge && typeof this.hookBridge.deliverToSystem === 'function') {
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        const res = await this.hookBridge.deliverToSystem('telegram', shouldAutoSend);
        if (res && res.ok) {
          delivered = true;
          break;
        }
      }
    }

    if (!delivered && !launchedExe && !externalOpened && !botSent) {
      return {
        ok: false,
        botSent: false,
        targetChat: `${targetChat} (Telegram Desktop)`,
        filePath: filePath || null,
        message: 'Nao foi possivel abrir ou localizar o Telegram Desktop.'
      };
    }

    if (!delivered && this.hookBridge && shouldAutoSend && typeof this.hookBridge.pasteAndSendInActiveWindow === 'function') {
      await this.hookBridge.pasteAndSendInActiveWindow(true);
    }

    return {
      ok: true,
      botSent,
      mode: delivered ? 'launched_and_delivered' : 'clipboard_ready',
      targetChat: `${targetChat} (Telegram Desktop)`,
      filePath: filePath || null
    };
  }

  async sendTelegramBotMessage(botToken, chatId, text) {
    const base = this._getTelegramApiBase();
    const url = `${base}/bot${botToken}/sendMessage`;
    const res = await this._postJson(url, { chat_id: chatId, text }, 8000);
    if (!res.ok) {
      throw new Error(res.message || `HTTP ${res.statusCode}`);
    }
    if (!res.json || typeof res.json !== 'object') {
      throw new Error('Telegram API retornou resposta JSON invalida.');
    }
    if (res.json.ok !== true) {
      throw new Error(res.json.description || 'Telegram API retornou ok !== true');
    }
    return res.body;
  }

  async sendTelegramBotPhoto(botToken, chatId, pngBuffer, caption) {
    const base = this._getTelegramApiBase();
    const url = `${base}/bot${botToken}/sendPhoto`;
    const boundary = '----MpeAstrolabeBoundary' + Date.now().toString(16);
    const parts = [];

    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`
      )
    );
    if (caption) {
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}\r\n`
        )
      );
    }
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="mpe_capture.png"\r\nContent-Type: image/png\r\n\r\n`
      )
    );
    parts.push(pngBuffer);
    parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));

    const bodyBuffer = Buffer.concat(parts);
    const resp = await this._requestUrl(url, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      },
      body: bodyBuffer,
      timeoutMs: 12000
    });

    if (resp.statusCode < 200 || resp.statusCode >= 300) {
      throw new Error(`HTTP ${resp.statusCode}: ${resp.body}`);
    }
    let parsed = null;
    try {
      parsed = resp.body ? JSON.parse(resp.body) : null;
    } catch (_) {
      throw new Error('Telegram API retornou resposta JSON invalida.');
    }
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Telegram API retornou resposta JSON invalida.');
    }
    if (parsed.ok !== true) {
      throw new Error(parsed.description || 'Telegram API retornou ok !== true');
    }
    return resp.body;
  }

  async executeSendLinkChat(rawParams = {}) {
    const blocked = this._checkConsent('launchAppsAndLinks', 'send_link_chat');
    if (blocked) return blocked;

    const params = rawParams && typeof rawParams === 'object' ? rawParams : {};
    const rawLink = params.linkUrl || params.url || '';
    const norm = this._normalizeHttpUrl(rawLink);
    if (!norm.ok) {
      return {
        ok: false,
        type: 'send_link_chat',
        message: norm.message
      };
    }

    const linkUrl = norm.url;
    const rawTemplate = typeof params.messageTemplate === 'string' ? params.messageTemplate.trim() : '';
    let text = linkUrl;
    if (rawTemplate) {
      if (/\{(url|link|linkUrl)\}/i.test(rawTemplate)) {
        text = rawTemplate
          .replace(/\{linkUrl\}/gi, () => linkUrl)
          .replace(/\{link\}/gi, () => linkUrl)
          .replace(/\{url\}/gi, () => linkUrl);
      } else {
        text = `${rawTemplate} ${linkUrl}`;
      }
    }

    const channel = String(params.deliveryChannel || 'telegram_desktop').trim().toLowerCase();

    switch (channel) {
      case 'telegram_bot': {
        const cfg =
          (this.configManager && typeof this.configManager.get === 'function' ? this.configManager.get() : {}) || {};
        const tg = cfg.telegram || {};
        const botToken = String(params.botToken || tg.botToken || '').trim();
        const chatId = String(params.chatId || tg.chatId || '').trim();
        if (!botToken || !chatId) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: 'botToken e chatId do Telegram sao obrigatorios para envio via Bot API.'
          };
        }
        try {
          await this.sendTelegramBotMessage(botToken, chatId, text);
          return {
            ok: true,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            text,
            botSent: true,
            message: 'Link enviado com sucesso via Telegram Bot API.'
          };
        } catch (err) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: `Falha ao enviar link via Telegram Bot: ${err && err.message ? err.message : String(err)}`
          };
        }
      }

      case 'webhook': {
        const whNorm = this._normalizeHttpUrl(params.webhookUrl || '');
        if (!whNorm.ok) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: params.webhookUrl ? whNorm.message : 'webhookUrl nao informada.'
          };
        }
        const postRes = await this._postJson(whNorm.url, { text, url: linkUrl }, 8000);
        if (!postRes.ok) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            statusCode: postRes.statusCode,
            message: `Falha no Webhook: ${postRes.message}`
          };
        }
        return {
          ok: true,
          type: 'send_link_chat',
          channel,
          url: linkUrl,
          text,
          statusCode: postRes.statusCode,
          message: 'Link enviado com sucesso via Webhook.'
        };
      }

      case 'telegram_desktop': {
        this._clipboard.writeText(text);
        const customTarget = String(params.telegramTarget || params.targetSystem || '').trim();
        const tgRes = await this.dispatchToTelegram({
          textMessage: text,
          customTarget,
          autoSendEnter: params.autoSendEnter !== false,
          skipBot: true
        });
        if (!tgRes || !tgRes.ok) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: (tgRes && tgRes.message) || 'Nao foi possivel enviar o link ao Telegram Desktop.'
          };
        }
        return {
          ok: true,
          type: 'send_link_chat',
          channel,
          url: linkUrl,
          text,
          targetChat: tgRes.targetChat,
          mode: tgRes.mode,
          message: `Link enviado para ${tgRes.targetChat}.`
        };
      }

      case 'whatsapp':
      case 'discord':
      case 'system': {
        const targetSystem =
          channel === 'whatsapp'
            ? String(params.targetSystem || 'WhatsApp').trim()
            : channel === 'discord'
            ? String(params.targetSystem || 'Discord').trim()
            : String(params.targetSystem || '').trim();

        if (!targetSystem) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: 'Sistema de destino nao informado para envio do link.'
          };
        }

        this._clipboard.writeText(text);
        const delivery = await this.dispatchToTargetSystem({
          targetSystem,
          autoSendEnter: params.autoSendEnter !== false,
          isTelegram: false,
          textMessage: text
        });
        if (!delivery || !delivery.ok) {
          return {
            ok: false,
            type: 'send_link_chat',
            channel,
            url: linkUrl,
            message: (delivery && delivery.message) || `Falha ao entregar link para ${targetSystem}.`
          };
        }
        return {
          ok: true,
          type: 'send_link_chat',
          channel,
          url: linkUrl,
          text,
          targetSystem: delivery.targetSystem,
          mode: delivery.mode,
          message: `Link enviado para [${delivery.targetSystem}].`
        };
      }

      default:
        return {
          ok: false,
          type: 'send_link_chat',
          channel,
          message: `Canal de envio desconhecido: ${channel}`
        };
    }
  }

  async executeLaunchAppProject(rawParams = {}) {
    const blocked = this._checkConsent('launchAppsAndLinks', 'launch_app_project');
    if (blocked) return blocked;

    const params = rawParams && typeof rawParams === 'object' ? rawParams : {};
    const rawAppName = String(params.appName || '').trim();
    const rawTargetPath = String(params.targetPath || '').trim();
    const rawProjectPath = String(params.projectPath || '').trim();
    const extraArgs = this._parseLaunchArgs(params.args);

    let resolvedProjectPath = '';
    if (rawProjectPath) {
      resolvedProjectPath = path.isAbsolute(rawProjectPath)
        ? path.resolve(rawProjectPath)
        : this.configManager && typeof this.configManager.resolvePath === 'function'
        ? this.configManager.resolvePath(rawProjectPath)
        : path.resolve(rawProjectPath);

      if (!fs.existsSync(resolvedProjectPath)) {
        return {
          ok: false,
          type: 'launch_app_project',
          projectPath: resolvedProjectPath,
          message: `Caminho do projeto nao encontrado: ${resolvedProjectPath}`
        };
      }
    }

    if (!rawAppName && !rawTargetPath) {
      if (resolvedProjectPath) {
        try {
          const errMsg = await this._shell.openPath(resolvedProjectPath);
          if (errMsg) {
            return {
              ok: false,
              type: 'launch_app_project',
              projectPath: resolvedProjectPath,
              message: `Falha ao abrir pasta/projeto: ${errMsg}`
            };
          }
          return {
            ok: true,
            type: 'launch_app_project',
            projectPath: resolvedProjectPath,
            message: `Projeto/pasta aberto: ${resolvedProjectPath}`
          };
        } catch (err) {
          return {
            ok: false,
            type: 'launch_app_project',
            projectPath: resolvedProjectPath,
            message: `Falha ao abrir pasta/projeto: ${err && err.message ? err.message : String(err)}`
          };
        }
      }
      return {
        ok: false,
        type: 'launch_app_project',
        message: 'Nenhum aplicativo ou caminho informado.'
      };
    }

    const appKey = rawAppName.toLowerCase();
    const targetKey = rawTargetPath.toLowerCase();
    const targetNoExt = targetKey.replace(/\.(exe|cmd|bat)$/i, '');
    const alias = APP_ALIASES[appKey] || APP_ALIASES[targetKey] || APP_ALIASES[targetNoExt] || null;

    const isVsCode =
      (alias && alias.query === 'visual studio code') ||
      ['vscode', 'code', 'code.cmd', 'code.exe', 'vs code', 'visual studio code'].includes(appKey) ||
      ['vscode', 'code', 'code.cmd', 'code.exe'].includes(targetKey);

    const candidates = [];
    if (isVsCode) {
      const diskCodePaths = this._getVsCodeDiskPaths();
      if (/\.(cmd|bat)$/i.test(rawTargetPath)) {
        candidates.push(rawTargetPath, 'code.exe', ...diskCodePaths);
      } else if (rawTargetPath && !['code', 'vscode', 'vs code', 'visual studio code'].includes(targetKey)) {
        candidates.push(rawTargetPath, ...diskCodePaths, 'code.cmd', 'code.exe');
      } else {
        candidates.push(...diskCodePaths, 'code.cmd', 'code.exe');
      }
    } else if (alias) {
      if (rawTargetPath && rawTargetPath.toLowerCase() !== appKey && rawTargetPath.toLowerCase() !== (alias.cmd || '').toLowerCase()) {
        candidates.push(rawTargetPath);
      }
      if (alias.cmd) candidates.push(alias.cmd);
      if (alias.fallbackCmd) candidates.push(alias.fallbackCmd);
    } else {
      candidates.push(rawTargetPath || rawAppName);
    }

    const queryTerm = (
      (alias && alias.query) ||
      rawAppName ||
      path.basename(rawTargetPath || rawAppName, path.extname(rawTargetPath || rawAppName))
    ).toLowerCase();

    const isMatchingWindow = (win) => {
      if (!win || !win.hwnd || String(win.hwnd) === '0') return false;
      const proc = String(win.process || win.processName || '').toLowerCase();
      const title = String(win.title || '').toLowerCase();

      let appMatched = false;
      if (isVsCode) {
        if (proc) {
          appMatched = proc === 'code' || proc === 'code.exe';
        } else {
          appMatched = title.includes('visual studio code');
        }
      } else if (queryTerm === 'notepad' || appKey === 'notepad') {
        appMatched = proc.includes('notepad') || title.includes('bloco de nota') || title.includes('notepad');
      } else if (queryTerm) {
        appMatched = proc.includes(queryTerm) || title.includes(queryTerm);
      }

      if (!appMatched) return false;

      if (resolvedProjectPath) {
        const folderName = path.basename(resolvedProjectPath).toLowerCase();
        return Boolean(folderName && title.includes(folderName));
      }
      return true;
    };

    // Verifica se o aplicativo/projeto ja esta aberto antes de criar novo processo (sem enviar Ctrl+V)
    if (this.hookBridge && typeof this.hookBridge.listOpenWindows === 'function') {
      try {
        const openWindows = await this.hookBridge.listOpenWindows();
        const existing = Array.isArray(openWindows) ? openWindows.find(isMatchingWindow) : null;
        if (existing) {
          if (typeof this.hookBridge.focusWindow === 'function') {
            try { await this.hookBridge.focusWindow(existing.hwnd); } catch (_) {}
          }
          return {
            ok: true,
            type: 'launch_app_project',
            alreadyOpen: true,
            hwnd: existing.hwnd,
            matchedTitle: existing.title || null,
            appName: (alias && alias.label) || rawAppName || rawTargetPath,
            projectPath: resolvedProjectPath || null,
            message: `Aplicativo ja aberto: ${existing.title || (alias && alias.label) || rawAppName || rawTargetPath}`
          };
        }
      } catch (_) {}
    }

    const launchArgs = [];
    if (resolvedProjectPath) launchArgs.push(resolvedProjectPath);
    launchArgs.push(...extraArgs);

    const spawnRes = await this._spawnDetachedApp(candidates, launchArgs);
    if (!spawnRes.ok) {
      return {
        ok: false,
        type: 'launch_app_project',
        appName: (alias && alias.label) || rawAppName || rawTargetPath,
        projectPath: resolvedProjectPath || null,
        message: spawnRes.message
      };
    }

    let matchedWindow = null;
    if (this.hookBridge && typeof this.hookBridge.listOpenWindows === 'function') {
      const pollDelay = Math.max(10, this._pollIntervalMs || 250);
      const maxAttempts = Math.min(8, Math.max(1, this._maxPollAttempts || 8));
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, pollDelay));
        try {
          const wins = await this.hookBridge.listOpenWindows();
          const hit = Array.isArray(wins) ? wins.find(isMatchingWindow) : null;
          if (hit) {
            matchedWindow = hit;
            break;
          }
        } catch (_) {
          break;
        }
      }
    }

    return {
      ok: true,
      type: 'launch_app_project',
      launched: true,
      alreadyOpen: false,
      executable: spawnRes.executable,
      usedCmdWrapper: Boolean(spawnRes.usedCmdWrapper),
      windowMatched: Boolean(matchedWindow),
      matchedTitle: matchedWindow ? matchedWindow.title : null,
      appName: (alias && alias.label) || rawAppName || rawTargetPath,
      projectPath: resolvedProjectPath || null,
      message: resolvedProjectPath
        ? `${(alias && alias.label) || rawAppName || rawTargetPath} iniciado em ${resolvedProjectPath}.`
        : `${(alias && alias.label) || rawAppName || rawTargetPath} iniciado.`
    };
  }

  async executePythonScript(rawParams = {}) {
    const blocked = this._checkConsent('pythonAutomation', 'run_python_script');
    if (blocked) return blocked;

    const params = rawParams && typeof rawParams === 'object' ? rawParams : {};
    if (this.pythonScheduler && typeof this.pythonScheduler.runScript === 'function') {
      const res = await this.pythonScheduler.runScript({
        scriptId: params.scriptId || null,
        scriptPath: params.scriptPath || null,
        scriptIdOrPath: params.scriptId || params.scriptPath || '',
        dryRun: Boolean(params.dryRun),
        args: Array.isArray(params.args) ? params.args : undefined,
        timeoutMs: params.timeoutMs,
        trigger: 'slot'
      });
      return Object.assign(
        { type: 'run_python_script' },
        res || { ok: false, message: 'Resposta vazia do agendador Python.' }
      );
    }

    const cfg =
      (this.configManager && typeof this.configManager.get === 'function' ? this.configManager.get() : {}) || {};
    let rawScriptPath = String(params.scriptPath || '').trim();
    if (!rawScriptPath && params.scriptId) {
      const scripts = Array.isArray(cfg.autoScripts) ? cfg.autoScripts : [];
      const found = scripts.find((s) => s && (s.id === params.scriptId || s.name === params.scriptId));
      if (found && found.filePath) {
        rawScriptPath = String(found.filePath).trim();
      }
    }

    if (!rawScriptPath) {
      return {
        ok: false,
        type: 'run_python_script',
        message: 'Nenhum script Python informado ou encontrado pelo ID.'
      };
    }

    let resolvedPath = '';
    if (path.isAbsolute(rawScriptPath)) {
      resolvedPath = path.resolve(rawScriptPath);
    } else {
      const codeCandidate =
        this.configManager && this.configManager.codeDir
          ? path.resolve(this.configManager.codeDir, rawScriptPath)
          : '';
      const rootCandidate =
        this.configManager && typeof this.configManager.resolvePath === 'function'
          ? this.configManager.resolvePath(rawScriptPath)
          : path.resolve(rawScriptPath);
      resolvedPath = codeCandidate && fs.existsSync(codeCandidate) ? codeCandidate : rootCandidate;
    }

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile() || !/\.py$/i.test(resolvedPath)) {
      return {
        ok: false,
        type: 'run_python_script',
        scriptId: params.scriptId || null,
        filePath: resolvedPath,
        message: `Arquivo de script Python invalido ou nao encontrado: ${resolvedPath}`
      };
    }

    const scriptArgs = [resolvedPath];
    if (params.dryRun) scriptArgs.push('--dry-run');
    if (Array.isArray(params.args)) {
      for (const a of params.args) scriptArgs.push(String(a));
    }

    const timeoutMs = Number(params.timeoutMs) > 0 ? Number(params.timeoutMs) : 30000;
    const pythonBins = ['python', 'py'];

    const runWithBin = (bin) =>
      new Promise((resolve) => {
        let settled = false;
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let exitFallbackTimer = null;
        const MAX_BUF = 65536;

        const finish = (payload) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutTimer);
          if (exitFallbackTimer) clearTimeout(exitFallbackTimer);
          resolve(payload);
        };

        let child;
        try {
          child = this._spawn(bin, scriptArgs, {
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe']
          });
        } catch (err) {
          return finish({ enoent: err && err.code === 'ENOENT', exitCode: -1, stdout: '', stderr: err.message });
        }

        const timeoutTimer = setTimeout(() => {
          timedOut = true;
          if (process.platform === 'win32' && child && child.pid) {
            try {
              execFileSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
                windowsHide: true,
                stdio: 'ignore',
                timeout: 3000
              });
            } catch (_) {}
          }
          try {
            if (child && typeof child.kill === 'function') child.kill();
          } catch (_) {}
          finish({
            enoent: false,
            timedOut: true,
            exitCode: -1,
            stdout,
            stderr: stderr || `Tempo limite excedido (${timeoutMs}ms)`
          });
        }, timeoutMs);
        if (typeof timeoutTimer.unref === 'function') timeoutTimer.unref();

        if (child.stdout && typeof child.stdout.on === 'function') {
          child.stdout.on('data', (d) => {
            if (stdout.length < MAX_BUF) stdout += String(d);
          });
        }
        if (child.stderr && typeof child.stderr.on === 'function') {
          child.stderr.on('data', (d) => {
            if (stderr.length < MAX_BUF) stderr += String(d);
          });
        }

        if (typeof child.once === 'function') {
          child.once('error', (err) => {
            finish({
              enoent: err && err.code === 'ENOENT',
              exitCode: -1,
              stdout,
              stderr: (err && err.message) || stderr
            });
          });
          child.once('close', (code) => {
            finish({
              enoent: false,
              timedOut,
              exitCode: typeof code === 'number' ? code : 0,
              stdout,
              stderr
            });
          });
          child.once('exit', (code) => {
            exitFallbackTimer = setTimeout(() => {
              finish({
                enoent: false,
                timedOut,
                exitCode: typeof code === 'number' ? code : 0,
                stdout,
                stderr
              });
            }, 40);
            if (typeof exitFallbackTimer.unref === 'function') exitFallbackTimer.unref();
          });
        } else {
          finish({ enoent: false, exitCode: 0, stdout, stderr });
        }
      });

    let execRes = null;
    for (const bin of pythonBins) {
      execRes = await runWithBin(bin);
      if (!execRes.enoent) break;
    }

    const ok = Boolean(execRes && !execRes.timedOut && !execRes.enoent && execRes.exitCode === 0);
    return {
      ok,
      type: 'run_python_script',
      scriptId: params.scriptId || null,
      filePath: resolvedPath,
      exitCode: execRes ? execRes.exitCode : -1,
      timedOut: Boolean(execRes && execRes.timedOut),
      stdout: (execRes && execRes.stdout) || '',
      stderr: (execRes && execRes.stderr) || '',
      message: ok
        ? `Script Python executado com sucesso: ${path.basename(resolvedPath)}`
        : execRes && execRes.timedOut
        ? `Execucao do script Python expirou apos ${timeoutMs}ms.`
        : `Falha ao executar script Python (codigo ${execRes ? execRes.exitCode : -1}): ${
            (execRes && execRes.stderr) || 'Erro de execucao.'
          }`
    };
  }

  /**
   * Executa um ponto estelar salvo pelo seu objeto `point`
   */
  async executePoint(point, mainWindow) {
    if (!point || typeof point !== 'object') {
      return {
        ok: false,
        message: 'Ponto de acao invalido.'
      };
    }

    const type = point.actionType || 'print';
    const params = point.params || {};
    // Acoes que usam a janela de origem (texto selecionado, print da janela ativa). Com o HUD
    // fechado (disparo pelo Mini, pela letra ou por atalho), a origem e a janela ativa AGORA:
    // o Mini nao rouba o foco. Antes ficava a janela da ultima abertura do HUD (as vezes de horas atras).
    const ORIGIN_TYPES = ['text_selection', 'text_to_system', 'text_telegram', 'print', 'print_telegram',
      'named_print', 'system_to_system_print', 'system'];
    const hudVisible = Boolean(mainWindow && typeof mainWindow.isVisible === 'function' && mainWindow.isVisible());
    if (!hudVisible && ORIGIN_TYPES.includes(type) && this.hookBridge &&
        typeof this.hookBridge.refreshForegroundWindow === 'function') {
      try {
        await this.hookBridge.refreshForegroundWindow();
      } catch (_) {}
    }
    const originTitle = (this.hookBridge && this.hookBridge.lastWindowTitle) || 'Sistema Atual';

    try {
      const requiredScope = this.getRequiredConsentScope(type);
      const consentBlocked = this._checkConsent(requiredScope, type);
      if (consentBlocked) {
        return consentBlocked;
      }

      switch (type) {
        case 'action_2d_scan': {
          const cropWin = params.captureScope === 'active_window';
          const { image } = await this.captureScreenImage(cropWin, mainWindow);
          const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Acao2D');
          return {
            ok: true,
            type: 'action_2d_scan',
            filePath: saved.filePath,
            fileName: saved.fileName,
            message: `Acao 2D executada em [${originTitle}]! Salvo em ${saved.fileName} e copiado para a Area de Transferencia.`
          };
        }

        case 'print': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 150));
          }
          const cropWin = params.captureScope === 'active_window';
          const { image } = await this.captureScreenImage(cropWin);
          const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Print');
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          return {
            ok: true,
            type: 'print',
            message: `Print capturado de [${originTitle}], salvo em ${saved.relativePath} e copiado para o Clipboard.`,
            filePath: saved.filePath
          };
        }

        case 'named_print': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 150));
          }
          if (params.captureScope === 'area') {
            const { image, displaySize } = await this.captureScreenImage(false);
            if (mainWindow) {
              mainWindow.show();
              mainWindow.focus();
            }
            return {
              ok: true,
              type: 'request_area_crop',
              nextAction: 'named_print',
              point,
              fullScreenDataUrl: image.toDataURL(),
              displaySize
            };
          }
          const cropWin = params.captureScope === 'active_window';
          const { image } = await this.captureScreenImage(cropWin);
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          const cfg = this.configManager.get();
          return {
            ok: true,
            type: 'request_named_print',
            point,
            imageDataUrl: image.toDataURL(),
            originSystem: originTitle,
            suggestedCategory: params.category || (cfg.captures && cfg.captures.defaultCategory) || 'Geral',
            saveDir: params.saveDir
          };
        }

        case 'system_to_system_print': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 150));
          }
          const cropWin = params.captureScope === 'active_window';
          const { image } = await this.captureScreenImage(cropWin);
          const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_CrossSystem');

          const targetSys = params.targetSystem || params.telegramTarget || 'Telegram';
          const autoSend = params.autoSendEnter !== false;

          const delivery = await this.dispatchToTargetSystem({
            targetSystem: targetSys,
            autoSendEnter: autoSend,
            isTelegram: targetSys.toLowerCase().includes('tg://') || targetSys.startsWith('@'),
            pngBuffer: saved.pngBuffer,
            filePath: saved.filePath
          });

          if (!delivery || !delivery.ok) {
            return delivery || { ok: false, type: 'system_to_system_print', message: 'Falha ao transferir print.' };
          }

          return {
            ok: true,
            type: 'system_to_system_print',
            message: `Print de [${originTitle}] transferido para [${delivery.targetSystem || targetSys}] (${saved.fileName}).`,
            filePath: saved.filePath
          };
        }

        case 'print_telegram': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 150));
          }
          const cropWin = params.captureScope === 'active_window';
          const { image } = await this.captureScreenImage(cropWin);
          const saved = this.saveAndCopyImage(image, params.saveDir, 'MPE_Telegram');
          const tgResult = await this.dispatchToTelegram({
            pngBuffer: saved.pngBuffer,
            filePath: saved.filePath,
            customTarget: params.telegramTarget
          });
          if (!tgResult || !tgResult.ok) {
            return tgResult || { ok: false, type: 'print_telegram', message: 'Falha ao enviar print ao Telegram.' };
          }
          return {
            ok: true,
            type: 'print_telegram',
            message: `Print de [${originTitle}] salvo (${saved.fileName}) e enviado para o Telegram (${tgResult.targetChat}).`,
            filePath: saved.filePath
          };
        }

        case 'area_print':
        case 'area_print_telegram':
        case 'area_print_system': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 150));
          }
          const { image, displaySize } = await this.captureScreenImage(false);
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          return {
            ok: true,
            type: 'request_area_crop',
            nextAction:
              type === 'area_print_telegram'
                ? 'telegram'
                : type === 'area_print_system'
                ? 'system'
                : 'save_only',
            point,
            fullScreenDataUrl: image.toDataURL(),
            displaySize
          };
        }

        case 'text_selection': {
          const prevClipboard = this._clipboard.readText();
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 160));
          }
          if (this.hookBridge) {
            const originHwnd = this.hookBridge.lastHwnd || '0';
            await this.hookBridge.copySelectionFromLastWindow(originHwnd);
          }
          await new Promise((r) => setTimeout(r, 180));
          let selectedText = this._clipboard.readText() || '';
          if (!selectedText && prevClipboard) {
            selectedText = prevClipboard;
          }
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
          return {
            ok: true,
            type: 'text_selection',
            selectedText,
            message: selectedText
              ? `Texto capturado do sistema [${originTitle}].`
              : 'Area de transferencia lida (selecione um texto no sistema de origem ou digite abaixo).'
          };
        }

        case 'text_telegram':
        case 'text_to_system': {
          if (mainWindow && mainWindow.isVisible()) {
            mainWindow.hide();
            await new Promise((r) => setTimeout(r, 120));
          }
          // Area de transferencia limpa antes do Ctrl+C: assim sabemos se veio texto de verdade.
          // Antes, sem selecao, colava o que ja estava copiado (ou '[M.P.E] Mensagem rapida') e dava Enter.
          const prevClipboardText = this._clipboard.readText() || '';
          try { this._clipboard.writeText(''); } catch (_) {}
          if (this.hookBridge) {
            await this.hookBridge.copySelectionFromLastWindow();
          }
          await new Promise((r) => setTimeout(r, 120));
          const selectedText = (this._clipboard.readText() || '').trim() ? this._clipboard.readText() : '';
          if (!selectedText) {
            try { this._clipboard.writeText(prevClipboardText); } catch (_) {}
            return {
              ok: false,
              type,
              message: `Nenhum texto selecionado em [${originTitle}]. Selecione o texto e use o atalho de novo.`
            };
          }
          if (type === 'text_to_system' && params.targetSystem) {
            const delivery = await this.dispatchToTargetSystem({
              targetSystem: params.targetSystem,
              autoSendEnter: params.autoSendEnter !== false,
              isTelegram: false,
              textMessage: selectedText
            });
            if (!delivery || !delivery.ok) {
              return delivery || { ok: false, type: 'text_to_system', message: 'Falha ao enviar texto.' };
            }
            return {
              ok: true,
              type: 'text_to_system',
              selectedText,
              message: `Texto de [${originTitle}] enviado para [${delivery.targetSystem}].`
            };
          } else {
            const tgRes = await this.dispatchToTelegram({
              textMessage: selectedText,
              customTarget: params.telegramTarget
            });
            if (!tgRes || !tgRes.ok) {
              return tgRes || { ok: false, type: 'text_telegram', message: 'Falha ao enviar texto ao Telegram.' };
            }
            return {
              ok: true,
              type: 'text_telegram',
              selectedText,
              message: `Texto de [${originTitle}] enviado para a conversa salva no Telegram.`
            };
          }
        }

        case 'open_organizer': {
          return {
            ok: true,
            type: 'open_organizer',
            scope: params.targetScope === 'prints' ? 'prints' : 'arquivos',
            message: 'Abrindo Organizador de Arquivos e Prints...'
          };
        }

        case 'organize_files_quick': {
          return {
            ok: true,
            type: 'organize_files_quick',
            scope: params.targetScope === 'prints' ? 'prints' : 'arquivos',
            criterion: params.criterion || 'type',
            pickMode: params.pickMode || 'files',
            message: 'Selecione os arquivos para organizar...'
          };
        }

        case 'toggle_2d_3d': {
          return {
            ok: true,
            type: 'toggle_2d_3d',
            message: 'Alternando modo 2D/3D do Astrolabio...'
          };
        }

        case 'macro_sequence': {
          const steps = Array.isArray(params.steps) ? params.steps.filter((s) => s && s.actionType) : [];
          if (!steps.length) {
            return {
              ok: false,
              message: 'Nenhuma etapa configurada nesta rotina.'
            };
          }

          // Pre-valida todas as permissoes de consentimento antes de executar a etapa 1
          for (const step of steps) {
            if (step.actionType === 'macro_sequence') continue;
            const stepScope = this.getRequiredConsentScope(step.actionType);
            const stepBlocked = this._checkConsent(stepScope, step.actionType);
            if (stepBlocked) {
              return stepBlocked;
            }
          }

          const results = [];
          for (const step of steps) {
            if (step.actionType === 'macro_sequence') continue;
            const r = await this.executePoint(
              {
                id: `${point.id || 'macro'}-step`,
                title: step.title || point.title,
                actionType: step.actionType,
                params: Object.assign({}, params, step.params || {})
              },
              mainWindow
            );
            results.push(r);
            if (r && r.blockedByConsent) {
              return r;
            }
            if (!r || r.ok === false) {
              return r || { ok: false, type: 'macro_sequence', message: 'Etapa da rotina falhou.' };
            }
            if (['request_area_crop', 'request_named_print', 'text_selection', 'open_organizer', 'organize_files_quick'].includes(r.type)) {
              return r;
            }
            await new Promise((res) => setTimeout(res, 180));
          }
          const summary = results.map((r) => r && r.message).filter(Boolean).join(' | ');
          return {
            ok: true,
            type: 'macro_sequence',
            message: summary || `Rotina "${point.title}" executada com sucesso (${results.length} etapas).`
          };
        }

        case 'open_path': {
          const rawTarget = params.targetPath || './prints';
          const specialAliases = {
            downloads: path.join(os.homedir(), 'Downloads'),
            documentos: path.join(os.homedir(), 'Documents'),
            desktop: path.join(os.homedir(), 'Desktop'),
            prints: './prints',
            arquivos: './arquivos'
          };
          const resolvedAlias = specialAliases[String(rawTarget).trim().toLowerCase()] || rawTarget;
          const target = this.configManager.resolvePath(resolvedAlias);
          if (!fs.existsSync(target) && (target.toLowerCase().includes('prints') || target.toLowerCase().includes('arquivos'))) {
            fs.mkdirSync(target, { recursive: true });
          }
          await this._shell.openPath(target);
          return {
            ok: true,
            type: 'open_path',
            message: `Pasta ou arquivo aberto: ${target}`
          };
        }

        case 'open_url': {
          const norm = this._normalizeHttpUrl(params.url);
          if (!norm.ok) {
            return {
              ok: false,
              type: 'open_url',
              message: norm.message
            };
          }

          const hostLower = (norm.parsed.hostname || '').toLowerCase();
          const isLoopback = hostLower === '127.0.0.1' || hostLower === 'localhost' || hostLower === '::1' || hostLower === '[::1]';
          if (process.env.MPE_TEST_OPEN_URL_HTTP === '1' && norm.parsed.protocol === 'http:' && isLoopback) {
            return await this._verifyLoopbackHttpUrl(norm.url);
          }

          await this._shell.openExternal(norm.url);
          return {
            ok: true,
            type: 'open_url',
            url: norm.url,
            message: `Site aberto no navegador: ${norm.url}`
          };
        }

        case 'send_link_chat': {
          return await this.executeSendLinkChat(params);
        }

        case 'launch_app_project': {
          return await this.executeLaunchAppProject(params);
        }

        case 'run_python_script': {
          return await this.executePythonScript(params);
        }

        case 'command': {
          const cmd = params.command || 'calc.exe';
          this._exec(cmd, { windowsHide: true });
          return {
            ok: true,
            type: 'command',
            message: `Programa executado: ${cmd}`
          };
        }

        case 'open_settings': {
          return {
            ok: true,
            type: 'open_settings',
            message: 'Abrindo Configuracoes...'
          };
        }

        default:
          return {
            ok: false,
            message: `Tipo de acao desconhecido: ${type}`
          };
      }
    } catch (err) {
      return {
        ok: false,
        type,
        message: err && err.message ? err.message : 'Erro ao executar acao.'
      };
    }
  }

  /**
   * Finaliza o recorte de area (Area Crop) e transfere para o Sistema de Destino ou Telegram
   */
  async completeAreaCrop(rawOpts = {}) {
    const opts = rawOpts && typeof rawOpts === 'object' && !Array.isArray(rawOpts) ? rawOpts : {};
    const { dataUrl, saveDir, nextAction, telegramTarget, targetSystem, autoSendEnter, mainWindow } = opts;

    const blocked = this._checkConsent('launchAppsAndLinks', 'completeAreaCrop');
    if (blocked) return blocked;

    if (!dataUrl || typeof dataUrl !== 'string') {
      return {
        ok: false,
        message: 'Dados da imagem de recorte nao informados.'
      };
    }

    if (nextAction === 'named_print') {
      const originTitle = (this.hookBridge && this.hookBridge.lastWindowTitle) || 'Sistema Atual';
      const cfg = this.configManager.get();
      return {
        ok: true,
        type: 'request_named_print',
        imageDataUrl: dataUrl,
        originSystem: originTitle,
        suggestedCategory: (cfg.captures && cfg.captures.defaultCategory) || 'Geral',
        saveDir
      };
    }

    const img = nativeImage.createFromDataURL(dataUrl);
    const saved = this.saveAndCopyImage(
      img,
      saveDir,
      nextAction === 'telegram' || nextAction === 'system' ? 'MPE_Recorte_Transfer' : 'MPE_Recorte'
    );

    if (nextAction === 'telegram') {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
      }
      const tgResult = await this.dispatchToTelegram({
        pngBuffer: saved.pngBuffer,
        filePath: saved.filePath,
        customTarget: telegramTarget
      });
      if (!tgResult || !tgResult.ok) {
        return Object.assign(
          {},
          tgResult || {},
          {
            ok: false,
            filePath: saved.filePath,
            message: (tgResult && tgResult.message) || 'Falha ao enviar recorte para o Telegram.'
          }
        );
      }
      return {
        ok: true,
        filePath: saved.filePath,
        message: `Recorte salvo (${saved.relativePath}) e enviado para o Telegram (${tgResult.targetChat}).`
      };
    }

    if (nextAction === 'system') {
      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.hide();
      }
      const delivery = await this.dispatchToTargetSystem({
        targetSystem: targetSystem || telegramTarget || 'Telegram',
        autoSendEnter: autoSendEnter !== false,
        isTelegram: false,
        pngBuffer: saved.pngBuffer,
        filePath: saved.filePath
      });
      if (!delivery || !delivery.ok) {
        return Object.assign(
          {},
          delivery || {},
          {
            ok: false,
            filePath: saved.filePath,
            message: (delivery && delivery.message) || 'Falha ao transferir recorte para o sistema de destino.'
          }
        );
      }
      return {
        ok: true,
        filePath: saved.filePath,
        message: `Recorte salvo (${saved.relativePath}) e transferido para [${delivery.targetSystem}].`
      };
    }

    return {
      ok: true,
      filePath: saved.filePath,
      message: `Recorte salvo em ${saved.relativePath} e copiado para a Area de Transferencia.`
    };
  }

  /**
   * Salva um Print Nomeado com categoria/subpasta e grava observacoes opcionais ao lado da imagem.
   */
  saveNamedPrint({
    dataUrl,
    customName,
    category,
    notes,
    saveDir,
    originSystem
  }) {
    const img = nativeImage.createFromDataURL(dataUrl);
    const saved = this.saveAndCopyImage(img, saveDir, {
      customName: customName || 'Print_Nomeado',
      category: category || 'Geral',
      originSystem
    });

    let notesPath = null;
    if (notes && notes.trim()) {
      try {
        notesPath = saved.filePath.replace(/\.png$/i, '.txt');
        const textBody = [
          `Print Nomeado: ${saved.fileName}`,
          `Categoria: ${saved.category}`,
          `Sistema de Origem: ${originSystem || saved.originSystem}`,
          `Arquivo de Imagem: ${saved.filePath}`,
          `\nAnotacoes:\n${notes.trim()}`
        ].join('\n');
        fs.writeFileSync(notesPath, textBody, 'utf-8');
      } catch (_) {
        notesPath = null;
      }
    }

    return {
      ok: true,
      filePath: saved.filePath,
      fileName: saved.fileName,
      relativePath: saved.relativePath,
      notesPath,
      message: notesPath
        ? `Print e anotacoes salvos em ${saved.relativePath} e copiados para a Area de Transferencia.`
        : `Print salvo em ${saved.relativePath} e copiado para a Area de Transferencia.`
    };
  }
}

module.exports = ActionExecutor;
