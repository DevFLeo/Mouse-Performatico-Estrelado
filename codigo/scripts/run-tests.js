const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

// A bateria e auto-isolada: variaveis MPE_* herdadas (ex.: quando chamada de dentro do e2e)
// apontariam a configuracao para outra pasta e quebrariam CFG-02.
for (const key of Object.keys(process.env)) {
  if (/^MPE_/.test(key)) delete process.env[key];
}

// Shim leve de 'electron' quando executado via Node CLI puro
const openedUrls = [];
const openedPaths = [];
const origLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => path.join(os.tmpdir(), `mpe-test-${name}`),
        setAppUserModelId: () => {}
      },
      shell: {
        openExternal: async (u) => { openedUrls.push(u); },
        openPath: async (p) => { openedPaths.push(p); return ''; },
        showItemInFolder: () => {}
      },
      clipboard: { writeText: () => {}, writeImage: () => {}, readText: () => '' },
      nativeImage: { createFromDataURL: () => ({ isEmpty: () => true, toPNG: () => Buffer.alloc(0) }) },
      screen: { getPrimaryDisplay: () => ({ size: { width: 1280, height: 720 }, scaleFactor: 1 }) },
      desktopCapturer: { getSources: async () => [] }
    };
  }
  return origLoad.apply(this, arguments);
};

const ConfigManager = require('../src/main/configManager');
const FileOrganizer = require('../src/main/fileOrganizer');
const ActionExecutor = require('../src/main/actionExecutor');
const { runM1Suite } = require('./m1-tests');

const results = [];

async function runCase(suite, id, name, fn) {
  const start = Date.now();
  try {
    const detail = await fn();
    const durationMs = Date.now() - start;
    results.push({ suite, id, name, status: 'PASS', durationMs, detail: detail || 'OK' });
    console.log(`[PASS] ${id} (${durationMs}ms) - ${name}: ${detail || 'OK'}`);
  } catch (err) {
    const durationMs = Date.now() - start;
    results.push({ suite, id, name, status: 'FAIL', durationMs, detail: err.message });
    console.error(`[FAIL] ${id} (${durationMs}ms) - ${name}:`, err.message);
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function rmSafe(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (_) {}
}

function walkJs(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walkJs(p));
    else if (/\.(js|html|css|json|txt)$/i.test(e.name)) out.push(p);
  }
  return out;
}

async function main() {
  const realCm = new ConfigManager(ROOT_DIR, CODE_DIR);
  const realCfg = realCm.load();

  // =========================================================================
  // SUITE A: ConfigManager, Migracoes e Estado Padrao do Astrolabio
  // =========================================================================
  await runCase('Config & Migracoes', 'CFG-01', 'Astrolabio definido como tela inicial padrao', () => {
    assert.strictEqual(realCfg.organizer.lastActiveTab, 'astrolabe');
    assert.strictEqual(realCfg.organizer.rememberWindowState, false);
    return `lastActiveTab=${realCfg.organizer.lastActiveTab}, rememberWindowState=${realCfg.organizer.rememberWindowState}`;
  });

  await runCase('Config & Migracoes', 'CFG-02', 'Injecao automatica da estrela open_organizer e migracao de caminhos', () => {
    const tmpRoot = makeTempDir('mpe-cfg-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.writeFileSync(
      path.join(tmpCode, 'mpe.config.json'),
      JSON.stringify({
        profile: { userName: 'Teste', isRegistered: true },
        telegram: { savedScreenshotsFolder: './Capturas_MPE' },
        captures: { documentsFolder: './documentos' },
        points: [{ id: 'p1', code: '01 1', title: 'Print', actionType: 'print' }]
      }),
      'utf8'
    );
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const loaded = cm.load();
    try {
      assert.strictEqual(loaded.telegram.savedScreenshotsFolder, './prints');
      assert.strictEqual(loaded.captures.documentsFolder, './arquivos');
      const hasOrgStar = loaded.points.some((p) => p.actionType === 'open_organizer');
      assert.ok(hasOrgStar, 'Estrela open_organizer deveria ser injetada automaticamente');
      return `prints=${loaded.telegram.savedScreenshotsFolder}, docs=${loaded.captures.documentsFolder}, estrelaOrganizador=${hasOrgStar}`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('Config & Migracoes', 'CFG-03', 'Estrela Organizar Arquivos presente na configuracao ativa', () => {
    const star = (realCfg.points || []).find((p) => p.actionType === 'open_organizer' || p.actionType === 'organize_files_quick');
    assert.ok(star, 'Ponto de organizador nao encontrado em mpe.config.json');
    return `id=${star.id}, code=${star.code}, title=${star.title}, orbit=${star.orbit}, angle=${star.angle}`;
  });

  // =========================================================================
  // SUITE C: Organizador de Arquivos (FileOrganizer)
  // =========================================================================
  await runCase('Organizador de Arquivos', 'ORG-01', 'Organizacao por Tipo (Extensao) + deteccao de duplicidade', () => {
    const tmpRoot = makeTempDir('mpe-org-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    const srcInbox = path.join(tmpRoot, 'entrada_externa');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.mkdirSync(srcInbox, { recursive: true });
    const fPdf = path.join(srcInbox, 'contrato.pdf');
    const fImg = path.join(srcInbox, 'foto.png');
    const fJs = path.join(srcInbox, 'helper.js');
    fs.writeFileSync(fPdf, 'conteudo pdf financeiro saldo 1500');
    fs.writeFileSync(fImg, 'fake png bytes');
    fs.writeFileSync(fJs, 'console.log("ok");');

    const cm = new ConfigManager(tmpRoot, tmpCode);
    cm.load();
    const org = new FileOrganizer(tmpRoot, tmpCode, cm);
    try {
      const r1 = org.organizePaths({ paths: [fPdf, fImg, fJs], criterion: 'type', moveInsteadOfCopy: false, targetScope: 'arquivos' });
      assert.ok(r1.ok && r1.organizedCount === 3);
      assert.ok(r1.results.some((x) => x.category === 'documentos/pdf'));
      assert.ok(r1.results.some((x) => x.category === 'imagens/png'));
      assert.ok(r1.results.some((x) => x.category === 'codigo/js'));
      // Executa segunda vez para testar renomeacao segura
      const r2 = org.organizePaths({ paths: [fPdf], criterion: 'type', moveInsteadOfCopy: false, targetScope: 'arquivos' });
      assert.ok(r2.ok && r2.results[0].renamedAs, 'Duplicata deveria receber sufixo numerico');
      return `3 categorias ok, conflito renomeado para ${r2.results[0].renamedAs}`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('Organizador de Arquivos', 'ORG-02', 'Criterios Data, Nome (A-Z) e Tamanho + Busca em Conteudo', () => {
    const tmpRoot = makeTempDir('mpe-org2-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    const srcInbox = path.join(tmpRoot, 'entrada');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.mkdirSync(srcInbox, { recursive: true });
    const fTxt = path.join(srcInbox, 'Relatorio_Secreto.txt');
    fs.writeFileSync(fTxt, 'Chave exclusiva MPE-KATAROS-2026 para busca textual.', 'utf8');

    const cm = new ConfigManager(tmpRoot, tmpCode);
    cm.load();
    const org = new FileOrganizer(tmpRoot, tmpCode, cm);
    try {
      const stat = fs.statSync(fTxt);
      assert.ok(/^\d{4}\/\d{4}-\d{2}$/.test(org.resolveCategory(fTxt, stat, 'date')));
      assert.strictEqual(org.resolveCategory(fTxt, stat, 'name'), 'Nome/R');
      assert.ok(org.resolveCategory(fTxt, stat, 'size').includes('Pequenos'));

      org.organizePaths({ paths: [fTxt], criterion: 'name', moveInsteadOfCopy: false, targetScope: 'arquivos' });
      const searchHit = org.searchScope({ scope: 'arquivos', query: 'KATAROS-2026', searchInContent: true });
      assert.ok(searchHit.ok && Array.isArray(searchHit.searchResults) && searchHit.searchResults.length === 1);
      assert.strictEqual(searchHit.searchResults[0].matchType, 'content');
      return `Criterios Date/Name/Size ok, searchScope encontrou ${searchHit.searchResults.length} arquivo (matchType=${searchHit.searchResults[0].matchType})`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('Organizador de Arquivos', 'ORG-03', 'Mover arquivos + Desfazer Ultimo Lote (Undo) + Protecao anti-auto-organizacao e traversal', () => {
    const tmpRoot = makeTempDir('mpe-org3-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    const srcInbox = path.join(tmpRoot, 'entrada');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.mkdirSync(srcInbox, { recursive: true });
    const fMov = path.join(srcInbox, 'nota.md');
    fs.writeFileSync(fMov, '# Nota teste undo', 'utf8');

    const cm = new ConfigManager(tmpRoot, tmpCode);
    cm.load();
    const org = new FileOrganizer(tmpRoot, tmpCode, cm);
    try {
      // Tentar organizar codigo/ deve falhar com protecao
      const blocked = org.organizePaths({ paths: [tmpCode], criterion: 'type', targetScope: 'arquivos' });
      assert.strictEqual(blocked.ok, false);

      // Tentar excluir fora da pasta permitida deve falhar
      const traversal = org.deleteOrganizedFile({ scope: 'arquivos', relPath: '../codigo/mpe.config.json' });
      assert.strictEqual(traversal.ok, false);

      const moved = org.organizePaths({ paths: [fMov], criterion: 'type', moveInsteadOfCopy: true, targetScope: 'arquivos' });
      assert.ok(moved.ok && !fs.existsSync(fMov) && fs.existsSync(moved.results[0].destPath));

      const undone = org.revertLastBatch();
      assert.ok(undone.ok && undone.revertedCount === 1 && fs.existsSync(fMov) && !fs.existsSync(moved.results[0].destPath));
      return `Protecao codigo/ e traversal ativos, move+undo restaurou ${path.basename(fMov)} corretamente`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  // =========================================================================
  // SUITE D: Motor de Execucao (ActionExecutor)
  // =========================================================================
  await runCase('Motor de Acoes', 'EXE-01', 'Acoes open_organizer, organize_files_quick e open_url (auto https)', async () => {
    const ex = new ActionExecutor(realCm, null);
    const rOrg = await ex.executePoint({ id: 't1', title: 'Organizar', actionType: 'open_organizer', params: { targetScope: 'prints' } });
    assert.strictEqual(rOrg.type, 'open_organizer');
    assert.strictEqual(rOrg.scope, 'prints');

    const rQuick = await ex.executePoint({ id: 't2', title: 'Rapido', actionType: 'organize_files_quick', params: { criterion: 'date', targetScope: 'arquivos' } });
    assert.strictEqual(rQuick.type, 'organize_files_quick');
    assert.strictEqual(rQuick.criterion, 'date');

    openedUrls.length = 0;
    const rUrl = await ex.executePoint({ id: 't3', title: 'Site', actionType: 'open_url', params: { url: 'github.com' } });
    assert.ok(rUrl.ok && openedUrls[0] === 'https://github.com');
    return `open_organizer(prints), organize_files_quick(date), open_url(${openedUrls[0]})`;
  });

  await runCase('Motor de Acoes', 'EXE-02', 'Rotina sequencial macro_sequence e aliases amigaveis de open_path', async () => {
    const ex = new ActionExecutor(realCm, null);
    openedPaths.length = 0;
    const rMacro = await ex.executePoint({
      id: 't4',
      title: 'Rotina Downloads + Site',
      actionType: 'macro_sequence',
      params: {
        targetPath: 'downloads',
        url: 'google.com',
        steps: [
          { actionType: 'macro_sequence' }, // deve ser ignorado pelo guarda anti-loop
          { actionType: 'open_path' },
          { actionType: 'open_url' }
        ]
      }
    });
    assert.ok(rMacro.ok);
    assert.ok(openedPaths[0] && openedPaths[0].toLowerCase().includes('downloads'));
    assert.ok(openedUrls.includes('https://google.com'));
    return `Alias downloads -> "${openedPaths[0]}", macro executou 2 etapas validas sem loop`;
  });

  // =========================================================================
  // SUITE E: Integridade Estatica, Binarios Nativo & Regras AGENTS.md
  // =========================================================================
  await runCase('Integridade & AGENTS.md', 'SYS-01', 'Sintaxe Node valida em todos os arquivos JS do projeto', () => {
    const jsFiles = walkJs(path.join(CODE_DIR, 'src')).filter((f) => f.endsWith('.js'));
    for (const f of jsFiles) {
      execSync(`node -c "${f}"`, { stdio: 'pipe' });
    }
    return `${jsFiles.length} arquivos JS validados com node -c`;
  });

  await runCase('Integridade & AGENTS.md', 'SYS-02', 'Zero emojis em codigo, HTML, CSS e JSON', () => {
    const files = walkJs(path.join(CODE_DIR, 'src')).concat([
      path.join(CODE_DIR, 'mpe.config.json')
    ]);
    const emojiRe = /\p{Extended_Pictographic}/gu;
    let hits = 0;
    for (const f of files) {
      const txt = fs.readFileSync(f, 'utf8');
      if (emojiRe.test(txt)) hits++;
    }
    assert.strictEqual(hits, 0, `Encontrados arquivos com emojis: ${hits}`);
    return `${files.length} arquivos auditados com 0 emojis`;
  });

  await runCase('Integridade & AGENTS.md', 'SYS-03', 'AppUserModelId, setAppDetails, hook exclusivo Astrolabio e binarios Win32 presentes', () => {
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    const launcherCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeLauncher.cs'), 'utf8');
    const hookCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeHook.cs'), 'utf8');
    const hasAumidConst = mainJs.includes("'DevFLeo.MousePerformaticoEstrelado'");
    const aumidIdx = mainJs.indexOf('app.setAppUserModelId(');
    const winIdx = mainJs.indexOf('new BrowserWindow');
    assert.ok(hasAumidConst && aumidIdx > 0 && aumidIdx < winIdx, 'AUMID deve vir antes de createWindow/BrowserWindow');
    assert.ok(mainJs.includes('mainWindow.setAppDetails(') && mainJs.includes('relaunchCommand'), 'setAppDetails com relaunchCommand obrigatorio para Fixar na Barra de Tarefas');
    assert.ok(launcherCs.includes('IPropertyStore') && launcherCs.includes('DevFLeo.MousePerformaticoEstrelado'), 'MpeLauncher.cs deve gravar PKEY_AppUserModel_ID no .lnk');
    assert.ok(!hookCs.includes('TRIGGER_MINI'), 'MPE MpeHook.cs nao deve interceptar Shift+Ctrl+Botao Direito (exclusivo do Katharos AI)');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe')), 'MpeHook.exe ausente');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'MPE.exe')), 'MPE.exe ausente');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'assets', 'icon.ico')), 'icon.ico ausente');
    return 'AUMID + setAppDetails + IPropertyStore .lnk + hook exclusivo HUD configurados; MPE.exe, MpeHook.exe e icon.ico presentes';
  });

  await runCase('Integridade & AGENTS.md', 'SYS-04', 'DOM completo do Astrolabio, Wizard e Organizador sem acoplamento de IA', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const requiredIds = [
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
      'pt-action-type'
    ];
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `ID obrigatorio ausente no HTML: ${id}`);
    }
    assert.ok(!html.includes('mini-assistant-overlay'), 'DOM MPE nao deve conter Mini Assistente');
    return `Todos os ${requiredIds.length} IDs estruturais do M.P.E presentes`;
  });

  await runM1Suite({ runCase, makeTempDir, rmSafe, CODE_DIR, ROOT_DIR });

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const summary = {
    executedAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results
  };

  console.log('\n=== RESUMO DA BATERIA NODE/INTEGRACAO ===');
  console.log(`Total: ${summary.total} | PASS: ${passed} | FAIL: ${failed}`);
  console.log('MPE_TEST_REPORT_JSON=' + JSON.stringify(summary));

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
