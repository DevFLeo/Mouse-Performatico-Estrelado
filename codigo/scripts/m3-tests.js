const assert = require('assert');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

function installElectronShimIfNeeded() {
  if (global.__mpeElectronShimInstalled) return global.__mpeElectronState;
  const state = {
    openedUrls: [],
    openedPaths: [],
    clipboardText: ''
  };
  const origLoad = Module._load;
  Module._load = function patchedLoad(request) {
    if (request === 'electron') {
      return {
        app: {
          getPath: (name) => path.join(os.tmpdir(), `mpe-m3-test-${name}`),
          setAppUserModelId: () => {}
        },
        shell: {
          openExternal: async (u) => {
            state.openedUrls.push(u);
          },
          openPath: async (p) => {
            state.openedPaths.push(p);
            return '';
          },
          showItemInFolder: () => {}
        },
        clipboard: {
          writeText: (t) => {
            state.clipboardText = String(t || '');
          },
          writeImage: () => {},
          readText: () => state.clipboardText
        },
        nativeImage: {
          createFromDataURL: () => ({ isEmpty: () => false, toPNG: () => Buffer.from('PNG') }),
          createFromPath: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) })
        },
        screen: {
          getPrimaryDisplay: () => ({ size: { width: 1280, height: 720 }, scaleFactor: 1 })
        },
        desktopCapturer: { getSources: async () => [] }
      };
    }
    return origLoad.apply(this, arguments);
  };
  global.__mpeElectronShimInstalled = true;
  global.__mpeElectronState = state;
  return state;
}

if (require.main === module) {
  installElectronShimIfNeeded();
}

const ConfigManager = require('../src/main/configManager');
const ConsentManager = require('../src/main/consentManager');
const FileOrganizer = require('../src/main/fileOrganizer');
const ActionExecutor = require('../src/main/actionExecutor');

function sha256IfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const data = fs.readFileSync(filePath);
  const stat = fs.statSync(filePath);
  return {
    hash: crypto.createHash('sha256').update(data).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs
  };
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function startHttpServer(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        server,
        port: addr.port,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise((res) => {
            server.close(() => res());
          })
      });
    });
  });
}

function makeIsolatedManagers(tmpDir) {
  const cfgPath = path.join(tmpDir, 'mpe.config.json');
  const userDataDir = path.join(tmpDir, 'userdata');
  const cm = new ConfigManager(ROOT_DIR, CODE_DIR, {
    configPath: cfgPath,
    cleanState: true,
    ignoreProcessArgs: true,
    userDataDir
  });
  cm.load();
  const consent = new ConsentManager(cm);
  return { cm, consent, cfgPath };
}

function createFakeSpawn(fn) {
  const calls = [];
  const spawnSpy = (cmd, args, opts) => {
    calls.push({ cmd, args: Array.isArray(args) ? [...args] : [], opts: Object.assign({}, opts) });
    if (fn) return fn(cmd, args, opts, calls.length - 1);
    const ee = new EventEmitter();
    ee.pid = 40000 + calls.length;
    ee.unref = () => {
      ee.__unreffed = true;
    };
    process.nextTick(() => ee.emit('spawn'));
    return ee;
  };
  return { spawnSpy, calls };
}

async function runM3Suite(ctx = {}) {
  const ownResults = [];
  const runCase =
    ctx.runCase ||
    (async (suite, id, name, fn) => {
      const start = Date.now();
      try {
        const detail = await fn();
        const durationMs = Date.now() - start;
        ownResults.push({ suite, id, name, status: 'PASS', durationMs, detail: detail || 'OK' });
        console.log(`[PASS] ${id} (${durationMs}ms) - ${name}: ${detail || 'OK'}`);
      } catch (err) {
        const durationMs = Date.now() - start;
        ownResults.push({ suite, id, name, status: 'FAIL', durationMs, detail: err.message });
        console.error(`[FAIL] ${id} (${durationMs}ms) - ${name}:`, err.message);
      }
    });

  const tmpMake = ctx.makeTempDir || makeTempDir;
  const tmpRm = ctx.rmSafe || rmSafe;
  const codeDir = ctx.CODE_DIR || CODE_DIR;
  const prodConfigPath = path.join(codeDir, 'mpe.config.json');
  const prodUndoPath = path.join(codeDir, 'data', 'organizer-undo.json');
  const beforeProdConfig = sha256IfExists(prodConfigPath);
  const beforeProdUndo = sha256IfExists(prodUndoPath);

  await runCase('M3 - Consent Gate', 'M3-01', 'Bloqueio e liberacao granular de consentimento no ActionExecutor', async () => {
    const tmpDir = tmpMake('mpe-m3-consent-');
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      const { spawnSpy, calls: spawnCalls } = createFakeSpawn();
      let execCalls = 0;
      const openedUrls = [];
      const openedPaths = [];
      const spyShell = {
        openExternal: async (u) => { openedUrls.push(u); },
        openPath: async (p) => { openedPaths.push(p); return ''; }
      };
      const spyClipboard = { writeText: () => {}, readText: () => '', writeImage: () => {} };
      const ex = new ActionExecutor(cm, null, {
        consentManager: consent,
        spawn: spawnSpy,
        exec: () => { execCalls++; },
        shell: spyShell,
        clipboard: spyClipboard,
        pollIntervalMs: 10,
        maxPollAttempts: 2
      });

      const blockedActions = [
        { actionType: 'open_url', params: { url: 'https://example.com' } },
        { actionType: 'send_link_chat', params: { linkUrl: 'https://example.com', deliveryChannel: 'webhook', webhookUrl: 'http://127.0.0.1:9/hook' } },
        { actionType: 'launch_app_project', params: { appName: 'notepad', targetPath: 'notepad.exe' } },
        { actionType: 'open_path', params: { targetPath: 'downloads' } },
        { actionType: 'command', params: { command: 'calc.exe' } },
        { actionType: 'run_python_script', params: { scriptPath: path.join(tmpDir, 'fake.py') } }
      ];

      for (const pt of blockedActions) {
        const res = await ex.executePoint(pt);
        assert.strictEqual(res.ok, false, `${pt.actionType} deveria ser bloqueado`);
        assert.strictEqual(res.blockedByConsent, true, `${pt.actionType} deveria retornar blockedByConsent: true`);
        assert.strictEqual(res.message, 'Aceite de primeiro acesso necessario.');
      }

      const dSys = await ex.dispatchToTargetSystem({ targetSystem: 'notepad' });
      assert.strictEqual(dSys.blockedByConsent, true);
      const dTg = await ex.dispatchToTelegram({ textMessage: 'oi' });
      assert.strictEqual(dTg.blockedByConsent, true);
      const dCropTg = await ex.completeAreaCrop({ dataUrl: 'data:image/png;base64,AA==', nextAction: 'telegram', saveDir: tmpDir });
      assert.strictEqual(dCropTg.blockedByConsent, true);
      const dCropSave = await ex.completeAreaCrop({ dataUrl: 'data:image/png;base64,AA==', nextAction: 'save_only', saveDir: tmpDir });
      assert.strictEqual(dCropSave.blockedByConsent, true);
      const dCropNamed = await ex.completeAreaCrop({ dataUrl: 'data:image/png;base64,AA==', nextAction: 'named_print', saveDir: tmpDir });
      assert.strictEqual(dCropNamed.blockedByConsent, true);

      const dDirectChat = await ex.executeSendLinkChat({ linkUrl: 'https://example.com', deliveryChannel: 'webhook', webhookUrl: 'http://127.0.0.1:9/hook' });
      assert.strictEqual(dDirectChat.blockedByConsent, true);
      const dDirectLaunch = await ex.executeLaunchAppProject({ appName: 'notepad', targetPath: 'notepad.exe' });
      assert.strictEqual(dDirectLaunch.blockedByConsent, true);
      const dDirectPy = await ex.executePythonScript({ scriptPath: path.join(tmpDir, 'fake.py') });
      assert.strictEqual(dDirectPy.blockedByConsent, true);

      assert.strictEqual(spawnCalls.length, 0);
      assert.strictEqual(execCalls, 0);
      assert.strictEqual(openedUrls.length, 0);
      assert.strictEqual(openedPaths.length, 0);

      for (const uiType of ['open_organizer', 'organize_files_quick', 'open_settings', 'toggle_2d_3d']) {
        const r = await ex.executePoint({ actionType: uiType, params: {} });
        assert.strictEqual(r.ok, true, `${uiType} UI-only nao deveria ser bloqueado`);
      }

      consent.setConsentDecision(true, {
        backgroundExecution: true,
        launchAppsAndLinks: true,
        pythonAutomation: false
      });

      const rNullSys = await ex.dispatchToTargetSystem(undefined);
      assert.strictEqual(rNullSys.ok, false);
      const rNullTg = await ex.dispatchToTelegram(null);
      assert.strictEqual(typeof rNullTg.ok, 'boolean');
      const rNullCrop = await ex.completeAreaCrop(undefined);
      assert.strictEqual(rNullCrop.ok, false);

      const exCropFail = new ActionExecutor(cm, {
        deliverToSystem: async () => ({ ok: false }),
        pasteAndSendInActiveWindow: async () => false
      }, {
        consentManager: consent,
        spawn: () => {
          const ee = new EventEmitter();
          ee.unref = () => {};
          process.nextTick(() => ee.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
          return ee;
        },
        shell: { openExternal: async () => { throw new Error('fail'); }, openPath: async () => 'fail' },
        clipboard: spyClipboard,
        pollIntervalMs: 10,
        maxPollAttempts: 1
      });
      const rCropSysFail = await exCropFail.completeAreaCrop({
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        nextAction: 'system',
        targetSystem: 'AppInexistenteXYZ',
        saveDir: tmpDir
      });
      assert.strictEqual(rCropSysFail.ok, false, 'completeAreaCrop deve propagar falha de system');
      assert.ok(rCropSysFail.filePath && fs.existsSync(rCropSysFail.filePath));
      const rCropTgFail = await exCropFail.completeAreaCrop({
        dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
        nextAction: 'telegram',
        saveDir: tmpDir
      });
      assert.strictEqual(rCropTgFail.ok, false, 'completeAreaCrop deve propagar falha de telegram');
      assert.ok(rCropTgFail.filePath && fs.existsSync(rCropTgFail.filePath));

      const rUrl = await ex.executePoint({ actionType: 'open_url', params: { url: 'example.com' } });
      assert.strictEqual(rUrl.ok, true);
      assert.strictEqual(openedUrls[0], 'https://example.com');

      const rPyBlocked = await ex.executePoint({ actionType: 'run_python_script', params: { scriptPath: path.join(tmpDir, 'fake.py') } });
      assert.strictEqual(rPyBlocked.ok, false);
      assert.strictEqual(rPyBlocked.blockedByConsent, true);

      openedUrls.length = 0;
      const rMacroBlocked = await ex.executePoint({
        actionType: 'macro_sequence',
        params: {
          steps: [
            { actionType: 'open_url', params: { url: 'example.org' } },
            { actionType: 'run_python_script', params: { scriptPath: path.join(tmpDir, 'fake.py') } }
          ]
        }
      });
      assert.strictEqual(rMacroBlocked.blockedByConsent, true);
      assert.strictEqual(openedUrls.length, 0, 'macro_sequence deve pre-validar e nao executar etapa 1 se etapa 2 estiver bloqueada');

      const exCompat = new ActionExecutor(cm, null, { shell: spyShell });
      consent.setConsentDecision(false, {});
      const rCompatUrl = await exCompat.executePoint({ actionType: 'open_url', params: { url: 'example.net' } });
      assert.strictEqual(rCompatUrl.ok, true, 'Sem consentManager, open_url preserva compatibilidade EXE-01/EXE-02');
      const rCompatPy = await exCompat.executePoint({ actionType: 'run_python_script', params: { scriptPath: path.join(tmpDir, 'fake.py') } });
      assert.strictEqual(rCompatPy.blockedByConsent, true, 'Sem consentManager, run_python_script deve falhar fechado contra cfg.consent');

      exCompat.setConsentManager(consent);
      const rNowBlocked = await exCompat.executePoint({ actionType: 'open_url', params: { url: 'example.net' } });
      assert.strictEqual(rNowBlocked.blockedByConsent, true);

      return 'Bloqueio total, permissoes granulares, pre-validacao macro e compatibilidade retroativa verificados';
    } finally {
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - open_url', 'M3-02', 'Normalizacao de URL, rejeicao de protocolos inseguros e MPE_TEST_OPEN_URL_HTTP=1', async () => {
    const tmpDir = tmpMake('mpe-m3-url-');
    const prevHttpMode = process.env.MPE_TEST_OPEN_URL_HTTP;
    let hits = 0;
    const srv = await startHttpServer((req, res) => {
      hits++;
      if (req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('pong');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('fail');
      }
    });
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });
      const openedUrls = [];
      const ex = new ActionExecutor(cm, null, {
        consentManager: consent,
        shell: { openExternal: async (u) => openedUrls.push(u) }
      });

      const rNorm = await ex.executePoint({ actionType: 'open_url', params: { url: 'github.com' } });
      assert.strictEqual(rNorm.ok, true);
      assert.strictEqual(openedUrls[0], 'https://github.com');

      for (const bad of ['', '   ', 'javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'ftp://example.com', 'http:bad']) {
        const prevLen = openedUrls.length;
        const rBad = await ex.executePoint({ actionType: 'open_url', params: { url: bad } });
        assert.strictEqual(rBad.ok, false, `Deveria rejeitar URL: ${bad}`);
        assert.strictEqual(openedUrls.length, prevLen, `Nao deveria chamar openExternal para: ${bad}`);
      }

      process.env.MPE_TEST_OPEN_URL_HTTP = '1';
      const beforeOpenLen = openedUrls.length;
      const rOkHttp = await ex.executePoint({ actionType: 'open_url', params: { url: `${srv.baseUrl}/ping` } });
      assert.strictEqual(rOkHttp.ok, true);
      assert.strictEqual(rOkHttp.verifiedViaHttp, true);
      assert.strictEqual(rOkHttp.statusCode, 200);
      assert.strictEqual(hits, 1);
      assert.strictEqual(openedUrls.length, beforeOpenLen, 'Modo MPE_TEST_OPEN_URL_HTTP=1 nao deve chamar shell.openExternal');

      const rFailHttp = await ex.executePoint({ actionType: 'open_url', params: { url: `${srv.baseUrl}/err` } });
      assert.strictEqual(rFailHttp.ok, false);
      assert.strictEqual(rFailHttp.statusCode, 500);

      return `Normalizacao, rejeicao de 7 entradas invalidas e HTTP GET loopback (${srv.baseUrl}/ping) OK`;
    } finally {
      if (prevHttpMode === undefined) delete process.env.MPE_TEST_OPEN_URL_HTTP;
      else process.env.MPE_TEST_OPEN_URL_HTTP = prevHttpMode;
      await srv.close();
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - send_link_chat HTTP', 'M3-03', 'Envio de link via telegram_bot (MPE_TELEGRAM_API_BASE) e webhook + erros HTTP', async () => {
    const tmpDir = tmpMake('mpe-m3-bot-');
    const prevBase = process.env.MPE_TELEGRAM_API_BASE;
    const received = [];
    const srv = await startHttpServer((req, res) => {
      let body = '';
      req.on('data', (d) => (body += d));
      req.on('end', () => {
        let json = null;
        try { json = JSON.parse(body); } catch (_) {}
        received.push({ method: req.method, url: req.url, json });
        if (req.url.includes('FAIL_TOKEN') || req.url === '/hook-fail') {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, description: 'Internal Error' }));
          return;
        }
        if (req.url.includes('BAD_TG_JSON')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, description: 'chat not found' }));
          return;
        }
        if (req.url.includes('HTML_200_TOKEN')) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html>502 Bad Gateway</html>');
          return;
        }
        if (req.url.includes('EMPTY_JSON_TOKEN')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('{}');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, result: { message_id: 77 } }));
      });
    });

    try {
      process.env.MPE_TELEGRAM_API_BASE = srv.baseUrl;
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });
      cm.save({ telegram: { botToken: 'CFG_TOK', chatId: '999001' } });
      const ex = new ActionExecutor(cm, null, { consentManager: consent });

      const rBot1 = await ex.executePoint({
        actionType: 'send_link_chat',
        params: {
          linkUrl: 'example.com/artigo',
          deliveryChannel: 'telegram_bot',
          botToken: 'TOK_123',
          chatId: '4242',
          messageTemplate: 'Leia aqui: {url}'
        }
      });
      assert.strictEqual(rBot1.ok, true);
      assert.strictEqual(received[0].url, '/botTOK_123/sendMessage');
      assert.deepStrictEqual(received[0].json, {
        chat_id: '4242',
        text: 'Leia aqui: https://example.com/artigo'
      });

      const rBotCfg = await ex.executePoint({
        actionType: 'send_link_chat',
        params: {
          linkUrl: 'https://example.org',
          deliveryChannel: 'telegram_bot',
          messageTemplate: 'Veja agora:'
        }
      });
      assert.strictEqual(rBotCfg.ok, true);
      assert.strictEqual(received[1].url, '/botCFG_TOK/sendMessage');
      assert.strictEqual(received[1].json.chat_id, '999001');
      assert.strictEqual(received[1].json.text, 'Veja agora: https://example.org');

      const rWh = await ex.executePoint({
        actionType: 'send_link_chat',
        params: {
          linkUrl: 'https://mpe.local/doc',
          deliveryChannel: 'webhook',
          webhookUrl: `${srv.baseUrl}/hook`
        }
      });
      assert.strictEqual(rWh.ok, true);
      assert.strictEqual(received[2].url, '/hook');
      assert.deepStrictEqual(received[2].json, {
        text: 'https://mpe.local/doc',
        url: 'https://mpe.local/doc'
      });

      const rDollar = await ex.executePoint({
        actionType: 'send_link_chat',
        params: {
          linkUrl: 'https://a.com/?q=$$&$&',
          deliveryChannel: 'telegram_bot',
          botToken: 'TOK_DOLLAR',
          chatId: '4242',
          messageTemplate: 'Link: {url}'
        }
      });
      assert.strictEqual(rDollar.ok, true);
      assert.strictEqual(rDollar.text, 'Link: https://a.com/?q=$$&$&');
      assert.strictEqual(received[3].json.text, 'Link: https://a.com/?q=$$&$&');

      const errCases = [
        { linkUrl: '', deliveryChannel: 'telegram_bot' },
        { linkUrl: 'javascript:alert(1)', deliveryChannel: 'webhook', webhookUrl: `${srv.baseUrl}/hook` },
        { linkUrl: 'https://a.b', deliveryChannel: 'telegram_bot', botToken: 'FAIL_TOKEN', chatId: '1' },
        { linkUrl: 'https://a.b', deliveryChannel: 'telegram_bot', botToken: 'BAD_TG_JSON', chatId: '1' },
        { linkUrl: 'https://a.b', deliveryChannel: 'telegram_bot', botToken: 'HTML_200_TOKEN', chatId: '1' },
        { linkUrl: 'https://a.b', deliveryChannel: 'telegram_bot', botToken: 'EMPTY_JSON_TOKEN', chatId: '1' },
        { linkUrl: 'https://a.b', deliveryChannel: 'webhook', webhookUrl: `${srv.baseUrl}/hook-fail` },
        { linkUrl: 'https://a.b', deliveryChannel: 'webhook', webhookUrl: '' }
      ];
      for (const p of errCases) {
        const res = await ex.executePoint({ actionType: 'send_link_chat', params: p });
        assert.strictEqual(res.ok, false, `Caso de erro deveria retornar ok:false: ${JSON.stringify(p)}`);
        assert.ok(res.message && res.message.length > 0);
      }

      await assert.rejects(
        () => ex.sendTelegramBotPhoto('HTML_200_TOKEN', '1', Buffer.from('PNG'), 'cap'),
        /JSON invalida/i
      );
      await assert.rejects(
        () => ex.sendTelegramBotPhoto('EMPTY_JSON_TOKEN', '1', Buffer.from('PNG'), 'cap'),
        /ok !== true/i
      );
      await assert.rejects(
        () => ex.sendTelegramBotPhoto('BAD_TG_JSON', '1', Buffer.from('PNG'), 'cap'),
        /chat not found/i
      );

      return `telegram_bot, template $$&$&, webhook e 11 caminhos de erro verificados em ${srv.baseUrl}`;
    } finally {
      if (prevBase === undefined) delete process.env.MPE_TELEGRAM_API_BASE;
      else process.env.MPE_TELEGRAM_API_BASE = prevBase;
      await srv.close();
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - send_link_chat Desktop', 'M3-04', 'Canais desktop (telegram_desktop, whatsapp, discord, system) e erros estruturados', async () => {
    const tmpDir = tmpMake('mpe-m3-chatdesk-');
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });

      const clipboardLog = [];
      const openedUrls = [];
      const deliverCalls = [];
      let deliverBehavior = () => ({ ok: false });

      const mockHook = {
        deliverToSystem: async (query, autoSend) => {
          deliverCalls.push({ query, autoSend });
          return deliverBehavior(query, autoSend, deliverCalls.length);
        },
        pasteAndSendInActiveWindow: async () => true
      };
      const { spawnSpy } = createFakeSpawn((_cmd) => {
        const ee = new EventEmitter();
        ee.unref = () => {};
        process.nextTick(() => ee.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
        return ee;
      });

      const ex = new ActionExecutor(cm, mockHook, {
        consentManager: consent,
        spawn: spawnSpy,
        clipboard: { writeText: (t) => clipboardLog.push(t), readText: () => '', writeImage: () => {} },
        shell: { openExternal: async (u) => { openedUrls.push(u); }, openPath: async () => '' },
        pollIntervalMs: 10,
        maxPollAttempts: 3
      });

      let attempt = 0;
      deliverBehavior = () => {
        attempt++;
        return attempt >= 2 ? { ok: true, matchedTitle: 'Telegram Desktop' } : { ok: false };
      };
      const rTg = await ex.executePoint({
        actionType: 'send_link_chat',
        params: {
          linkUrl: 'https://t.me/canal_teste',
          deliveryChannel: 'telegram_desktop',
          telegramTarget: '@canal_teste',
          autoSendEnter: false
        }
      });
      assert.strictEqual(rTg.ok, true);
      assert.strictEqual(rTg.mode, 'launched_and_delivered');
      assert.strictEqual(clipboardLog[0], 'https://t.me/canal_teste');
      assert.strictEqual(deliverCalls[0].autoSend, false);

      attempt = 0;
      deliverBehavior = (q) => {
        attempt++;
        return attempt >= 2 ? { ok: true, matchedTitle: q === 'whatsapp' ? 'WhatsApp' : 'Discord' } : { ok: false };
      };
      const rWa = await ex.executePoint({
        actionType: 'send_link_chat',
        params: { linkUrl: 'exemplo.com/wa', deliveryChannel: 'whatsapp' }
      });
      assert.strictEqual(rWa.ok, true);
      assert.ok(openedUrls.includes('whatsapp://'));

      attempt = 0;
      const rDc = await ex.executePoint({
        actionType: 'send_link_chat',
        params: { linkUrl: 'exemplo.com/dc', deliveryChannel: 'discord' }
      });
      assert.strictEqual(rDc.ok, true);
      assert.ok(openedUrls.includes('discord://'));

      const rEmptySys = await ex.executePoint({
        actionType: 'send_link_chat',
        params: { linkUrl: 'https://exemplo.com', deliveryChannel: 'system', targetSystem: '' }
      });
      assert.strictEqual(rEmptySys.ok, false);

      const spawnSpyCalls = [];
      const exFail = new ActionExecutor(cm, {
        deliverToSystem: async () => ({ ok: false }),
        pasteAndSendInActiveWindow: async () => false
      }, {
        consentManager: consent,
        spawn: (cmd, args, opts) => {
          spawnSpyCalls.push({ cmd, args });
          return spawnSpy(cmd, args, opts);
        },
        clipboard: { writeText: () => {}, readText: () => '', writeImage: () => {} },
        shell: {
          openExternal: async () => { throw new Error('protocol failed'); },
          openPath: async () => 'not found'
        },
        pollIntervalMs: 10,
        maxPollAttempts: 2
      });
      const rWordPad = await exFail.executePoint({
        actionType: 'send_link_chat',
        params: { linkUrl: 'https://exemplo.com', deliveryChannel: 'system', targetSystem: 'WordPad' }
      });
      assert.strictEqual(rWordPad.ok, false);
      assert.strictEqual(spawnSpyCalls[0].cmd, 'WordPad.exe', 'WordPad nao deve casar com alias word/winword.exe');

      const rFailSys = await exFail.executePoint({
        actionType: 'send_link_chat',
        params: { linkUrl: 'https://exemplo.com', deliveryChannel: 'system', targetSystem: 'AppInexistenteXYZ' }
      });
      assert.strictEqual(rFailSys.ok, false);

      return 'telegram_desktop, whatsapp, discord, word-boundary WordPad e falha estruturada verificados';
    } finally {
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - launch_app_project', 'M3-05', 'Slot 1 (Notepad), Slot 2 (VS Code + projectPath), .cmd oculto e validacao de caminho', async () => {
    const tmpDir = tmpMake('mpe-m3-launch-');
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });
      const cfg = cm.get();
      const slot1 = cfg.points[0];
      const slot2 = cfg.points[1];
      assert.strictEqual(slot1.actionType, 'launch_app_project');
      assert.strictEqual(slot1.params.targetPath, 'notepad.exe');
      assert.strictEqual(slot2.actionType, 'launch_app_project');

      const projectDir = path.join(tmpDir, 'meu_projeto');
      fs.mkdirSync(projectDir, { recursive: true });

      const { spawnSpy, calls } = createFakeSpawn();
      let deliverCalls = 0;
      const mockHook = {
        listOpenWindows: async () => [],
        deliverToSystem: async () => { deliverCalls++; return { ok: true }; }
      };

      const ex = new ActionExecutor(cm, mockHook, {
        consentManager: consent,
        spawn: spawnSpy,
        pollIntervalMs: 10,
        maxPollAttempts: 2
      });

      const r1 = await ex.executePoint(slot1);
      assert.strictEqual(r1.ok, true);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].cmd, 'notepad.exe');
      assert.strictEqual(calls[0].opts.detached, true);
      assert.strictEqual(calls[0].opts.windowsHide, true);

      const r2 = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: 'code', projectPath: projectDir }
      });
      assert.strictEqual(r2.ok, true);
      assert.strictEqual(calls.length, 2);
      assert.ok(calls[1].args.includes(projectDir), 'VS Code deveria receber projectDir nos args');
      assert.strictEqual(calls[1].opts.detached, true);
      assert.strictEqual(calls[1].opts.windowsHide, true);

      const customCmd = path.join(tmpDir, 'mock_launcher.cmd');
      fs.writeFileSync(customCmd, '@echo off\r\nexit /b 0\r\n', 'utf8');
      const rCmd = await ex.executePoint({
        actionType: 'launch_app_project',
        params: {
          appName: 'custom',
          targetPath: customCmd,
          projectPath: projectDir,
          args: '--flag="quoted value" --other=\'abc def\''
        }
      });
      assert.strictEqual(rCmd.ok, true);
      assert.strictEqual(calls.length, 3);
      assert.ok(/cmd\.exe$/i.test(calls[2].cmd), '.cmd deve ser invocado via cmd.exe');
      assert.deepStrictEqual(calls[2].args.slice(0, 3), ['/d', '/s', '/c']);
      assert.ok(calls[2].args[3].includes(customCmd) && calls[2].args[3].includes(projectDir));
      assert.ok(calls[2].args[3].includes('"--flag=quoted value"'), 'Inline quoted flag deve permanecer como token unico');
      assert.ok(calls[2].args[3].includes('"--other=abc def"'));
      assert.strictEqual(calls[2].opts.windowsVerbatimArguments, true);
      assert.strictEqual(calls[2].opts.windowsHide, true);
      assert.strictEqual(calls[2].opts.detached, true);

      const rMissing = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: 'code', projectPath: path.join(tmpDir, 'nao-existe') }
      });
      assert.strictEqual(rMissing.ok, false);
      assert.strictEqual(calls.length, 3, 'Caminho inexistente nao deve chamar spawn');

      const rEmpty = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: '', targetPath: '', projectPath: '' }
      });
      assert.strictEqual(rEmpty.ok, false);
      assert.strictEqual(calls.length, 3);
      assert.strictEqual(deliverCalls, 0, 'launch_app_project nunca deve chamar deliverToSystem (Ctrl+V)');

      return 'Slot 1 Notepad, Slot 2 VS Code, cmd.exe /c oculto, zero Ctrl+V e validacao de caminho OK';
    } finally {
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - Janela & Fallback', 'M3-06', 'Anti-spoof VS Code, hwnd!=0, fallbackCmd em .cmd ausente/erro e .cmd real com espacos', async () => {
    const tmpDir = tmpMake('mpe-m3-fb-');
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });

      const projA = path.join(tmpDir, 'ProjetoA');
      const projB = path.join(tmpDir, 'ProjetoB');
      fs.mkdirSync(projA, { recursive: true });
      fs.mkdirSync(projB, { recursive: true });

      let openWindows = [
        { hwnd: '0', process: 'notepad.exe', title: 'Bloco de Notas (Sintetico)' },
        { hwnd: '98765', process: 'notepad.exe', title: 'Sem titulo - Bloco de Notas' },
        { hwnd: '77777', process: 'notepad.exe', title: 'ProjetoB Visual Studio Code notes.txt - Bloco de Notas' },
        { hwnd: '55555', process: 'Code.exe', title: 'ProjetoA - Visual Studio Code' }
      ];
      let deliverCalls = 0;

      const { spawnSpy, calls } = createFakeSpawn((cmd) => {
        const ee = new EventEmitter();
        ee.unref = () => {};
        if (/wt\.exe$/i.test(cmd)) {
          process.nextTick(() => ee.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
        } else if (/cmd\.exe$/i.test(cmd)) {
          process.nextTick(() => {
            ee.emit('spawn');
            ee.emit('exit', 1, null);
          });
        } else {
          process.nextTick(() => ee.emit('spawn'));
        }
        return ee;
      });

      const ex = new ActionExecutor(cm, {
        listOpenWindows: async () => openWindows,
        deliverToSystem: async () => { deliverCalls++; return { ok: true }; }
      }, {
        consentManager: consent,
        spawn: spawnSpy,
        pollIntervalMs: 10,
        maxPollAttempts: 2
      });

      const rNpOpen = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'notepad', targetPath: 'notepad.exe' }
      });
      assert.strictEqual(rNpOpen.ok, true);
      assert.strictEqual(rNpOpen.alreadyOpen, true);
      assert.strictEqual(calls.length, 0, 'Nao deve spawnar Notepad se hwnd valido ja existe');

      const rVsSame = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: 'code', projectPath: projA }
      });
      assert.strictEqual(rVsSame.ok, true);
      assert.strictEqual(rVsSame.alreadyOpen, true);
      assert.strictEqual(calls.length, 0, 'Nao deve spawnar VS Code se ProjetoA ja esta aberto');

      const rVsDiff = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: 'code', projectPath: projB }
      });
      assert.strictEqual(rVsDiff.ok, true);
      assert.strictEqual(rVsDiff.alreadyOpen, false);
      assert.strictEqual(calls.length, 1, 'Nao deve confundir notepad.exe com titulo Visual Studio Code');

      openWindows = [{ hwnd: '0', process: 'cmd.exe', title: 'Fake' }];
      const callsBeforeFb = calls.length;
      const rTermFb = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'terminal', targetPath: 'wt.exe' }
      });
      assert.strictEqual(rTermFb.ok, true);
      assert.strictEqual(rTermFb.executable, 'cmd.exe');
      assert.strictEqual(calls.length, callsBeforeFb + 2, 'wt.exe ENOENT deve acionar fallbackCmd cmd.exe');

      const callsBeforeMissingCmd = calls.length;
      const rMissingCmdFb = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: 'nonexistent_mpe_code_999.cmd', projectPath: projB }
      });
      assert.strictEqual(rMissingCmdFb.ok, true);
      assert.strictEqual(rMissingCmdFb.executable, 'code.exe');
      assert.strictEqual(calls.length, callsBeforeMissingCmd + 1, '.cmd ausente deve pular cmd.exe e ir direto para fallback code.exe');

      const failingCmd = path.join(tmpDir, 'failing_code.cmd');
      fs.writeFileSync(failingCmd, '@echo off\r\nexit /b 1\r\n', 'utf8');
      const rExitCodeFb = await ex.executePoint({
        actionType: 'launch_app_project',
        params: { appName: 'vscode', targetPath: failingCmd, projectPath: projB }
      });
      assert.strictEqual(rExitCodeFb.ok, true);
      assert.strictEqual(rExitCodeFb.executable, 'code.exe', '.cmd com exit 1 deve acionar fallback code.exe');
      assert.strictEqual(deliverCalls, 0);

      // Teste real de spawn OS: .cmd em diretorio com espacos + projectPath com espacos + --flag="quoted value"
      const spacedBin = path.join(tmpDir, 'bin with spaces');
      const spacedProj = path.join(tmpDir, 'proj with spaces');
      fs.mkdirSync(spacedBin, { recursive: true });
      fs.mkdirSync(spacedProj, { recursive: true });
      const realSpacedCmd = path.join(spacedBin, 'test launch.cmd');
      const markerOut = path.join(tmpDir, 'spaced_marker.txt');
      fs.writeFileSync(
        realSpacedCmd,
        `@echo off\r\necho ARG1=%~1> "${markerOut}"\r\necho ARG2=%~2>> "${markerOut}"\r\n`,
        'utf8'
      );

      const exReal = new ActionExecutor(cm, null, {
        consentManager: consent,
        pollIntervalMs: 10,
        maxPollAttempts: 1
      });
      const rRealSpaced = await exReal.executePoint({
        actionType: 'launch_app_project',
        params: {
          appName: 'custom',
          targetPath: realSpacedCmd,
          projectPath: spacedProj,
          args: '--flag="quoted value"'
        }
      });
      assert.strictEqual(rRealSpaced.ok, true);
      assert.strictEqual(rRealSpaced.usedCmdWrapper, true);
      await new Promise((r) => setTimeout(r, 150));
      assert.ok(fs.existsSync(markerOut), 'Arquivo marcador deveria ter sido criado pelo .cmd com espacos');
      const markerText = fs.readFileSync(markerOut, 'utf8');
      assert.ok(markerText.includes(`ARG1=${spacedProj}`), `ARG1 inesperado: ${markerText}`);
      assert.ok(markerText.includes('ARG2=--flag=quoted value'), `ARG2 inesperado: ${markerText}`);

      const rRealMissingBatch = await exReal._spawnDetachedApp([path.join(tmpDir, 'missing_real.cmd'), 'nonexistent_bare_999.cmd'], []);
      assert.strictEqual(rRealMissingBatch.ok, false, '_spawnDetachedApp real nao deve retornar ok=true para .cmd ausente');

      const rRealFallback = await exReal._spawnDetachedApp(['nonexistent_bare_999.cmd', 'where.exe'], ['cmd']);
      assert.strictEqual(rRealFallback.ok, true);
      assert.strictEqual(rRealFallback.executable, 'where.exe', 'Real _spawnDetachedApp deve fazer fallback para where.exe');

      const realFailingCmd = path.join(spacedBin, 'fail exit.cmd');
      fs.writeFileSync(realFailingCmd, '@echo off\r\nexit /b 1\r\n', 'utf8');
      const rRealExitFallback = await exReal._spawnDetachedApp([realFailingCmd, 'where.exe'], ['cmd']);
      assert.strictEqual(rRealExitFallback.ok, true);
      assert.strictEqual(rRealExitFallback.executable, 'where.exe', 'Real .cmd com exit 1 deve fazer fallback para where.exe');

      return 'Anti-spoof VS Code, fallbackCmd em .cmd ausente/exit=1 e spawn real com espacos OK';
    } finally {
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - Python Slot', 'M3-07', 'run_python_script via pythonScheduler e execucao direta Python real', async () => {
    const tmpDir = tmpMake('mpe-m3-py-');
    try {
      const { cm, consent } = makeIsolatedManagers(tmpDir);
      consent.setConsentDecision(true, { backgroundExecution: false, launchAppsAndLinks: false, pythonAutomation: true });

      const pyOk = path.join(tmpDir, 'ok_script.py');
      const pyFail = path.join(tmpDir, 'fail_script.py');
      fs.writeFileSync(
        pyOk,
        'import sys\nprint("M3_PY_OK:" + ("dry" if "--dry-run" in sys.argv else "real"))\n',
        'utf8'
      );
      fs.writeFileSync(pyFail, 'import sys\nsys.stderr.write("erro simulado\\n")\nsys.exit(2)\n', 'utf8');

      cm.save({
        autoScripts: [{ id: 'scr-1', name: 'Teste', filePath: pyOk, steps: [] }]
      });

      const delegatedCalls = [];
      const exWithSched = new ActionExecutor(cm, null, {
        consentManager: consent,
        pythonScheduler: {
          runScript: async (payload) => {
            delegatedCalls.push(payload);
            return { ok: true, exitCode: 0, stdout: 'DELEGATED_OK', stderr: '' };
          }
        }
      });
      const rSched = await exWithSched.executePoint({
        actionType: 'run_python_script',
        params: { scriptId: 'scr-1', dryRun: true }
      });
      assert.strictEqual(rSched.ok, true);
      assert.strictEqual(delegatedCalls.length, 1);
      assert.strictEqual(delegatedCalls[0].scriptId, 'scr-1');
      assert.strictEqual(delegatedCalls[0].dryRun, true);

      const exDirect = new ActionExecutor(cm, null, { consentManager: consent });
      const rDirectOk = await exDirect.executePoint({
        actionType: 'run_python_script',
        params: { scriptId: 'scr-1', dryRun: true }
      });
      assert.strictEqual(rDirectOk.ok, true);
      assert.strictEqual(rDirectOk.exitCode, 0);
      assert.ok(rDirectOk.stdout.includes('M3_PY_OK:dry'), `stdout inesperado: ${rDirectOk.stdout}`);

      const rDirectFail = await exDirect.executePoint({
        actionType: 'run_python_script',
        params: { scriptPath: pyFail }
      });
      assert.strictEqual(rDirectFail.ok, false);
      assert.strictEqual(rDirectFail.exitCode, 2);

      const rMissing = await exDirect.executePoint({
        actionType: 'run_python_script',
        params: { scriptPath: path.join(tmpDir, 'nao_existe.py') }
      });
      assert.strictEqual(rMissing.ok, false);

      const gcPidFile = path.join(tmpDir, 'gc_pid.txt');
      const pyTimeout = path.join(tmpDir, 'sleep_script.py');
      fs.writeFileSync(
        pyTimeout,
        `import subprocess, sys, time\np = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(30)"])\nopen(r"${gcPidFile}", "w").write(str(p.pid))\ntime.sleep(10)\n`,
        'utf8'
      );
      const rTimeout = await exDirect.executePoint({
        actionType: 'run_python_script',
        params: { scriptPath: pyTimeout, timeoutMs: 350 }
      });
      assert.strictEqual(rTimeout.ok, false);
      assert.strictEqual(rTimeout.timedOut, true);
      await new Promise((r) => setTimeout(r, 120));
      if (fs.existsSync(gcPidFile)) {
        const gcPid = Number(fs.readFileSync(gcPidFile, 'utf8').trim());
        let gcAlive = true;
        try { process.kill(gcPid, 0); } catch (_) { gcAlive = false; }
        assert.strictEqual(gcAlive, false, `Subprocesso neto (${gcPid}) deve ser encerrado no timeout`);
      }

      return 'Delegacao pythonScheduler + execucao real Python (--dry-run, exitCode=2 e timeout arvore) OK';
    } finally {
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - FileOrganizer Isolamento', 'M3-08', 'FileOrganizer respeita MPE_DATA_DIR e configManager.dataDir sem mutar codigo/data', async () => {
    const tmpDir = tmpMake('mpe-m3-org-');
    const prevDataDir = process.env.MPE_DATA_DIR;
    try {
      const envDataDir = path.join(tmpDir, 'env-data');
      const inboxDir = path.join(tmpDir, 'inbox');
      fs.mkdirSync(inboxDir, { recursive: true });
      const sampleFile = path.join(inboxDir, 'nota_m3.txt');
      fs.writeFileSync(sampleFile, 'teste isolamento MPE_DATA_DIR', 'utf8');

      process.env.MPE_DATA_DIR = envDataDir;
      const cm = new ConfigManager(tmpDir, codeDir, {
        configPath: path.join(tmpDir, 'mpe.config.json'),
        cleanState: true,
        ignoreProcessArgs: true,
        userDataDir: path.join(tmpDir, 'ud')
      });
      cm.load();

      const orgEnv = new FileOrganizer(tmpDir, codeDir, cm);
      assert.strictEqual(orgEnv.dataDir, path.resolve(envDataDir));
      assert.strictEqual(orgEnv.undoFilePath, path.join(path.resolve(envDataDir), 'organizer-undo.json'));

      const resOrg = orgEnv.organizePaths({
        paths: [sampleFile],
        criterion: 'type',
        moveInsteadOfCopy: true,
        targetScope: 'arquivos'
      });
      assert.strictEqual(resOrg.ok, true);
      assert.ok(fs.existsSync(orgEnv.undoFilePath), 'organizer-undo.json deve ser gravado em MPE_DATA_DIR');

      const resUndo = orgEnv.revertLastBatch();
      assert.strictEqual(resUndo.ok, true);
      assert.ok(fs.existsSync(sampleFile));

      delete process.env.MPE_DATA_DIR;
      const orgCm = new FileOrganizer(tmpDir, codeDir, cm);
      assert.strictEqual(orgCm.dataDir, path.resolve(cm.dataDir));

      const afterProdUndo = sha256IfExists(prodUndoPath);
      assert.deepStrictEqual(
        afterProdUndo ? afterProdUndo.hash : null,
        beforeProdUndo ? beforeProdUndo.hash : null,
        'codigo/data/organizer-undo.json nao deve ser alterado'
      );

      return 'MPE_DATA_DIR e configManager.dataDir isolaram organizer-undo.json 100%';
    } finally {
      if (prevDataDir === undefined) delete process.env.MPE_DATA_DIR;
      else process.env.MPE_DATA_DIR = prevDataDir;
      tmpRm(tmpDir);
    }
  });

  await runCase('M3 - Estabilidade Estatica', 'M3-09', 'node -c e zero emojis nos arquivos M3', () => {
    const targets = [
      path.join(codeDir, 'src', 'main', 'actionExecutor.js'),
      path.join(codeDir, 'src', 'main', 'fileOrganizer.js'),
      path.join(codeDir, 'scripts', 'm3-tests.js')
    ];
    const emojiRe = /\p{Extended_Pictographic}/gu;
    for (const file of targets) {
      execFileSync(process.execPath, ['-c', file], { stdio: 'pipe' });
      const content = fs.readFileSync(file, 'utf8');
      const matches = content.match(emojiRe);
      assert.strictEqual(matches, null, `Emoji encontrado em ${file}: ${matches}`);
    }
    return `${targets.length} arquivos validados com node -c e 0 emojis`;
  });

  await runCase('M3 - Integridade Producao', 'M3-10', 'Preservacao de codigo/mpe.config.json e codigo/data/organizer-undo.json', () => {
    const afterProdConfig = sha256IfExists(prodConfigPath);
    const afterProdUndo = sha256IfExists(prodUndoPath);
    assert.deepStrictEqual(
      afterProdConfig ? afterProdConfig.hash : null,
      beforeProdConfig ? beforeProdConfig.hash : null,
      'codigo/mpe.config.json foi modificado durante m3-tests!'
    );
    assert.deepStrictEqual(
      afterProdUndo ? afterProdUndo.hash : null,
      beforeProdUndo ? beforeProdUndo.hash : null,
      'codigo/data/organizer-undo.json foi modificado durante m3-tests!'
    );
    return 'Hashes SHA-256 de producao preservados 100%';
  });

  return ownResults;
}

if (require.main === module) {
  runM3Suite()
    .then((results) => {
      const passed = results.filter((r) => r.status === 'PASS').length;
      const failed = results.filter((r) => r.status === 'FAIL').length;
      console.log('\n=== RESUMO DA BATERIA M3 ===');
      console.log(`Total: ${results.length} | PASS: ${passed} | FAIL: ${failed}`);
      console.log('MPE_M3_REPORT_JSON=' + JSON.stringify({ total: results.length, passed, failed, results }));
      if (failed > 0) process.exit(1);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runM3Suite };
