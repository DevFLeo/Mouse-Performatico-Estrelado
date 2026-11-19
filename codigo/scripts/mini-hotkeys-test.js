// Teclado no leque do Mini: numeros 1-9 (inclui teclado numerico) e letras em uso viram atalhos
// globais so enquanto o leque esta aberto, e sao liberados ao fechar. Uso: node scripts/mini-hotkeys-test.js
const Module = require('module');
const path = require('path');
const C = path.resolve(__dirname, '..');
const registered = new Map();
const fakeElectron = {
  BrowserWindow: function () {},
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 }, bounds: { x: 0, y: 0, width: 1600, height: 900 } }), getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1600, height: 900 } }), getAllDisplays: () => [] },
  globalShortcut: {
    register: (a, cb) => { registered.set(a, cb); return true; },
    unregister: (a) => { registered.delete(a); }
  }
};
const orig = Module._load;
Module._load = function (req, ...r) { return req === 'electron' ? fakeElectron : orig.call(this, req, ...r); };
const Mgr = require(path.join(C, 'src/main/miniAstrolabeManager.js'));
const sent = [];
const m = Object.create(Mgr.prototype);
m.configManager = { get: () => ({ points: [{ title: 'Notas', hotkeyLetter: 'N' }, { title: 'VS' }, { title: 'Org', hotkeyLetter: 'O' }] }) };
m.win = { isDestroyed: () => false, webContents: { send: (ch, p) => sent.push([ch, p]) } };
m.syncFanHotkeys(true);
console.log('registradas:', [...registered.keys()].join(','));
registered.get('2')(); registered.get('N')(); registered.get('num3')();
console.log('enviadas:', JSON.stringify(sent));
m.syncFanHotkeys(false);
console.log('depois de fechar:', registered.size);
const ok = registered.size === 0 && sent.length === 3 && sent[1][1].key === 'N' && sent[2][1].key === '3';
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
