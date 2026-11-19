// Selecao de Texto -> Outro Sistema pelo Mini/letra (HUD fechado): o Ctrl+C deve ir para a janela
// ativa AGORA, nao para a janela antiga guardada em lastHwnd. Uso: node scripts/text-origin-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') {
    return {
      app: { getPath: (n) => path.join(os.tmpdir(), `mpe-origin-${n}`) },
      clipboard: { readText: () => '', writeText: () => {}, writeImage: () => {} },
      nativeImage: { createFromDataURL: () => ({}) },
      shell: { openExternal: async () => {}, openPath: async () => '' },
      screen: { getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 }) },
      desktopCapturer: { getSources: async () => [] }
    };
  }
  return origLoad.call(this, req, ...rest);
};

const ConfigManager = require('../src/main/configManager');
const ConsentManager = require('../src/main/consentManager');
const ActionExecutor = require('../src/main/actionExecutor');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpe-origin-'));
  const cm = new ConfigManager(path.dirname(CODE_DIR), CODE_DIR, {
    configPath: path.join(tmp, 'c.json'), cleanState: true, ignoreProcessArgs: true, userDataDir: path.join(tmp, 'u')
  });
  cm.load();
  const consent = new ConsentManager(cm);
  consent.setConsentDecision(true, { backgroundExecution: true, launchAppsAndLinks: true, pythonAutomation: true });

  const events = [];
  let clip = 'texto antigo';
  const hook = {
    lastHwnd: '111',
    lastWindowTitle: 'Janela Antiga',
    refreshForegroundWindow: async () => {
      events.push('refresh');
      hook.lastHwnd = '222';
      hook.lastWindowTitle = 'Chrome - artigo';
      return '222';
    },
    copySelectionFromLastWindow: async (override) => {
      const target = override || hook.lastHwnd;
      events.push(`copy:${target}`);
      clip = target === '222' ? 'texto selecionado agora' : 'texto antigo';
      return true;
    },
    deliverToSystem: async (q, auto, text) => {
      events.push(`deliver:${q}`);
      return { ok: true, targetSystem: q, delivered: true };
    },
    pasteAndSendInActiveWindow: async () => true
  };
  const ex = new ActionExecutor(cm, hook, {
    consentManager: consent,
    clipboard: { readText: () => clip, writeText: (t) => { clip = t; }, writeImage: () => {} },
    pollIntervalMs: 5,
    maxPollAttempts: 1
  });
  if (typeof ex.setHookBridge === 'function') ex.setHookBridge(hook);

  const hiddenHud = { isVisible: () => false, isDestroyed: () => false, hide() {}, show() {}, focus() {} };
  const res = await ex.executePoint(
    { id: 't', actionType: 'text_to_system', params: { targetSystem: 'Bloco de Notas', autoSendEnter: true } },
    hiddenHud
  );
  console.log('eventos:', events.join(' -> '), '| resultado:', JSON.stringify({ ok: res.ok, msg: res.message }));
  assert.ok(events.indexOf('refresh') !== -1 && events.indexOf('refresh') < events.findIndex((e) => e.startsWith('copy:')),
    'A janela ativa deve ser lida ANTES do Ctrl+C quando o HUD esta fechado');
  assert.ok(events.includes('copy:222'), 'Ctrl+C foi para a janela antiga (111) em vez da ativa (222)');
  // Sem texto selecionado: nao pode colar lixo (clipboard antigo ou '[M.P.E] Mensagem rapida')
  events.length = 0;
  clip = 'senha copiada antes';
  hook.copySelectionFromLastWindow = async () => { events.push('copy-vazio'); return true; };
  const vazio = await ex.executePoint(
    { id: 't2', actionType: 'text_to_system', params: { targetSystem: 'Bloco de Notas', autoSendEnter: true } },
    hiddenHud
  );
  console.log('sem selecao:', events.join(' -> '), '|', JSON.stringify({ ok: vazio.ok, msg: vazio.message }), '| clipboard:', clip);
  assert.strictEqual(vazio.ok, false, 'Sem texto selecionado deve falhar com aviso');
  assert.ok(!events.some((e) => e.startsWith('deliver:')), 'Nao pode colar nada no destino sem texto selecionado');
  assert.strictEqual(clip, 'senha copiada antes', 'A area de transferencia anterior deve ser restaurada');
  console.log('PASS');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.log('FAIL', e.message); process.exit(1); });
