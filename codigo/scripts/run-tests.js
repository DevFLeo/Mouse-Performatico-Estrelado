const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const Module = require('module');

const CODE_DIR = path.resolve(__dirname, '..');
const ROOT_DIR = path.resolve(CODE_DIR, '..');

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
const LlamafileManager = require('../src/main/llamafileManager');
const LocalAiService = require('../src/main/localAiService');
const FileOrganizer = require('../src/main/fileOrganizer');
const ActionExecutor = require('../src/main/actionExecutor');

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

  await runCase('Config & Migracoes', 'CFG-02', 'Migracao automatica de porta 8080 e provider builtin legado', () => {
    const tmpRoot = makeTempDir('mpe-cfg-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    fs.writeFileSync(
      path.join(tmpCode, 'mpe.config.json'),
      JSON.stringify({
        profile: { userName: 'Teste', isRegistered: true },
        ai: { provider: 'builtin', port: 8080, modelsDir: './models' },
        points: [{ id: 'p1', code: '01 1', title: 'Print', actionType: 'print' }]
      }),
      'utf8'
    );
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const loaded = cm.load();
    try {
      assert.strictEqual(loaded.ai.provider, 'auto');
      assert.strictEqual(loaded.ai.port, 18080);
      assert.strictEqual(loaded.ai.modelsDir, './codigo/models');
      const hasOrgStar = loaded.points.some((p) => p.actionType === 'open_organizer');
      assert.ok(hasOrgStar, 'Estrela open_organizer deveria ser injetada automaticamente');
      return `provider=${loaded.ai.provider}, port=${loaded.ai.port}, estrelaOrganizador=${hasOrgStar}`;
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
  // SUITE B: Motor I.A Local (Mozilla llamafile + LocalAiService)
  // =========================================================================
  await runCase('I.A Local (llamafile)', 'AI-01', 'Binario llamafile.exe e modelo GGUF presentes e <= 15 GB', () => {
    const modelsDir = path.join(CODE_DIR, 'models');
    const files = fs.readdirSync(modelsDir).filter((f) => fs.statSync(path.join(modelsDir, f)).isFile());
    const totalBytes = files.reduce((acc, f) => acc + fs.statSync(path.join(modelsDir, f)).size, 0);
    const totalGb = totalBytes / (1024 ** 3);
    const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
    const found = mgr.findModel(realCfg.ai);
    assert.ok(found && found.exe && found.gguf, 'Par llamafile.exe + .gguf nao detectado');
    assert.ok(totalGb > 0.5 && totalGb <= 15, `Tamanho fora do limite: ${totalGb.toFixed(2)} GB`);
    return `${found.name} + llamafile.exe (${totalGb.toFixed(2)} GB <= 15 GB)`;
  });

  await runCase('I.A Local (llamafile)', 'AI-02', 'ping() rejeita HTML 404 (protecao contra servidor Apache/IIS na porta)', async () => {
    const srv = http.createServer((_req, res) => {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN"><html><head><title>404 Not Found</title></head><body>Not Found</body></html>');
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;
    try {
      const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
      const status = await mgr.ping(port, 1200);
      assert.strictEqual(status, 'fail', `ping deveria retornar fail para HTML 404, retornou ${status}`);
      return `Porta mock ${port} (HTML 404) rejeitada como '${status}'`;
    } finally {
      srv.close();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-03', 'findFreePort() ignora porta ocupada e seleciona porta livre', async () => {
    const blocker = http.createServer((_req, res) => res.end('busy'));
    await new Promise((r) => blocker.listen(0, '127.0.0.1', r));
    const busyPort = blocker.address().port;
    try {
      const mgr = new LlamafileManager(ROOT_DIR, CODE_DIR);
      const chosen = await mgr.findFreePort(busyPort);
      assert.notStrictEqual(chosen, busyPort);
      assert.strictEqual(await mgr.isPortAvailable(chosen), true);
      return `Ocupada=${busyPort} -> Livre escolhida=${chosen}`;
    } finally {
      blocker.close();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-04', 'cleanModelOutput() remove blocos internos <think>...</think>', () => {
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    const cleaned = svc.cleanModelOutput('<think>raciocinio oculto</think>\n\nResposta final objetiva.');
    assert.strictEqual(cleaned, 'Resposta final objetiva.');
    return `Output limpo: "${cleaned}"`;
  });

  await runCase('I.A Local (llamafile)', 'AI-05', 'Comandos slash (/ajuda, /status) e revisao offline (< 50ms)', async () => {
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    const helpRes = await svc.chat({ message: '/ajuda' });
    assert.ok(helpRes.ok && helpRes.source === 'command' && helpRes.text.includes('COMANDOS'));
    const rev = svc.builtinGrammarAndStyleReview('este e um texto de teste sem ponto');
    assert.ok(rev.ok && rev.revised.startsWith('Este') && rev.revised.endsWith('.'));
    const obs = svc.classifyForObsidian('Ata de reuniao sobre meta do projeto');
    assert.ok(obs.ok && obs.suggestedFolder === 'Reunioes');
    return `Help OK, Revisao="${rev.revised}", ObsidianFolder=${obs.suggestedFolder}`;
  });

  await runCase('I.A Local (llamafile)', 'AI-06', 'Inferencia LLM real via llamafile + Qwen2.5-7B-Instruct (/v1/chat/completions)', async () => {
    const svc = new LocalAiService(ROOT_DIR, realCm, CODE_DIR);
    try {
      const res = await svc.chat({ message: 'Responda em uma frase curta: do que a agua e feita?', tone: 'amigavel', mode: 'chat' });
      assert.ok(res.ok, 'Resposta de chat falhou');
      assert.strictEqual(res.source, 'llm', `Esperado source=llm, obtido ${res.source}: ${res.text}`);
      assert.ok(/hidrog|H2O|oxig/i.test(res.text), `Conteudo inesperado: ${res.text}`);
      const status = await svc.getStatus(false);
      assert.strictEqual(status.ready, true);
      assert.strictEqual(status.engine, 'online');
      return `source=${res.source}, modelo=${status.modelName}, resposta="${res.text.slice(0, 85).replace(/\s+/g, ' ')}"`;
    } finally {
      svc.shutdown();
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-07', 'Calculo de memoria/velocidade, kits minimos e comando /boost', async () => {
    const tmpRoot = makeTempDir('mpe-boost-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    const cm = new ConfigManager(tmpRoot, tmpCode);
    cm.load();
    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      const kitsRes = await svc.chat({ message: '/kits' });
      assert.ok(kitsRes.ok && kitsRes.source === 'command');
      assert.ok(kitsRes.text.includes('CALCULO DE MEMORIA RAM') && kitsRes.text.includes('KITS MINIMOS'));

      const ecoProf = await svc.setBoostMode('eco', { restartIfOnline: false });
      assert.strictEqual(ecoProf.boostMode, 'eco');
      assert.strictEqual(ecoProf.tuning.contextSize, 2048);

      const turboRes = await svc.chat({ message: '/boost turbo' });
      assert.ok(turboRes.ok && turboRes.text.includes('Turbo (/boost)'));
      const turboProf = svc.getPerformanceProfile();
      assert.strictEqual(turboProf.boostMode, 'turbo');
      assert.strictEqual(turboProf.speed.lastLoadMs, 0);
      assert.ok(Array.isArray(turboProf.kits) && turboProf.kits.length === 4);
      assert.strictEqual(typeof svc.engine.stopAsync, 'function');
      return `eco(ctx=${ecoProf.tuning.contextSize}), turbo(threads=${turboProf.tuning.threads}/${turboProf.tuning.threadsBatch}), kits=${turboProf.kits.length}, RAM=${turboProf.hardware.totalRamGb}GB`;
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-08', 'Roteador de comandos / (aliases, fuzzy, /status termo, /revise referencia doc e /organizar)', async () => {
    const tmpRoot = makeTempDir('mpe-slash-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'offline';
    cm.save(cfg);

    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      // Salva documento "bolo do jorge" simulando o cenario real
      svc.saveDocumentFile({ title: 'bolo do jorge', category: 'Geral', text: 'quero uma ravisão de bolo' });

      // 1. Fuzzy & prefixo
      const rAjud = LocalAiService.resolveSlashCommand('ajud');
      assert.strictEqual(rAjud.matched, 'ajuda');
      assert.strictEqual(rAjud.autoCorrected, true);

      const rTypo = LocalAiService.resolveSlashCommand('stauts');
      assert.strictEqual(rTypo.matched, 'status');
      assert.strictEqual(rTypo.autoCorrected, true);

      // Comandos destrutivos nao devem rodar por fuzzy automatico
      const rDest = LocalAiService.resolveSlashCommand('par');
      assert.strictEqual(rDest.matched, null);

      // 2. /status do bolo inclui busca rapida pelo termo
      const stBolo = await svc.chat({ message: '/status do bolo' });
      assert.ok(stBolo.ok && stBolo.text.includes('BUSCA RAPIDA PARA "do bolo"') && stBolo.text.includes('bolo do jorge'));

      // 3. /revise o que foi enviado para o jorge encontra o documento e revisa o conteudo dele
      const revJorge = await svc.chat({ message: '/revise o que foi enviado para o jorge' });
      assert.ok(revJorge.ok, 'Falha em /revise referencial');
      assert.ok(revJorge.text.includes('bolo do jorge'), 'Deveria informar origem do documento');
      assert.ok(revJorge.text.includes('ravisão') || revJorge.text.includes('Quero uma'), 'Deveria revisar o texto do documento');

      // 4. /buscar unificado e /organizar arquivos com acao
      const buscar = await svc.chat({ message: '/buscar bolo' });
      assert.ok(buscar.ok && buscar.text.includes('DOCUMENTOS') && buscar.text.includes('bolo do jorge'));

      const orgCmd = await svc.chat({ message: '/organizar arquivos' });
      assert.ok(orgCmd.ok && orgCmd.action && orgCmd.action.type === 'open-organizer');

      // 5. /tom e /perfil
      const tomRes = await svc.chat({ message: '/tom neutra' });
      assert.ok(tomRes.ok && tomRes.action && tomRes.action.type === 'set-tone' && tomRes.action.tone === 'neutra');

      const unkRes = await svc.chat({ message: '/revissarx algo' });
      assert.ok(unkRes.ok && unkRes.text.includes('Voce quis dizer:'));

      return 'Aliases, fuzzy (/ajud, /stauts), /status termo, /revise referencia doc, /buscar, /organizar e /tom validados';
    } finally {
      rmSafe(tmpRoot);
    }
  });

  await runCase('I.A Local (llamafile)', 'AI-09', 'Parametros de resposta (top_p, repeat_penalty, /perfil) + retry HTTP 503 sem fallback indevido', async () => {
    const tmpRoot = makeTempDir('mpe-params-');
    const tmpCode = path.join(tmpRoot, 'codigo');
    fs.mkdirSync(tmpCode, { recursive: true });
    let hits = 0;
    let lastPayload = null;

    const srv = http.createServer((req, res) => {
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-qwen' }] }));
        return;
      }
      if (req.url === '/v1/chat/completions') {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          hits++;
          lastPayload = JSON.parse(body);
          if (hits === 1) {
            // Simula 503 transitorio (ex: slot ocupado apos /boost) na 1a tentativa
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Loading model' } }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: 'Receita de bolo pronta para o Jorge com cobertura de chocolate.' } }]
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const port = srv.address().port;

    const cm = new ConfigManager(tmpRoot, tmpCode);
    const cfg = cm.load();
    cfg.ai.provider = 'lmstudio';
    cfg.ai.endpoint = `http://127.0.0.1:${port}/v1/chat/completions`;
    cm.save(cfg);

    const svc = new LocalAiService(tmpRoot, cm, tmpCode);
    try {
      const pRes = await svc.chat({ message: '/param perfil criativo' });
      assert.ok(pRes.ok && pRes.text.includes('Criativo'), 'Perfil criativo falhou');

      const aliasRes = await svc.chat({ message: '/param repeticao 1.18' });
      assert.ok(aliasRes.ok && aliasRes.text.includes('repeat_penalty = 1.18'), 'Alias repeticao falhou');

      // Simula provider auto com retry transitorio mudando temporariamente para mock em porta local
      svc.engine.ping = async () => 'ok';
      cfg.ai.provider = 'auto';
      cfg.ai.port = port;
      cm.save(cfg);

      const reply = await svc.chat({ message: 'pode adaptar', tone: 'neutra', mode: 'free' });
      assert.strictEqual(reply.source, 'llm', `Esperado source=llm apos retry, obtido ${reply.source}`);
      assert.strictEqual(hits, 2, `Esperado 2 tentativas (503 -> 200), obteve ${hits}`);
      assert.strictEqual(lastPayload.repeat_penalty, 1.18);
      assert.strictEqual(lastPayload.top_p, 0.95);
      assert.strictEqual(lastPayload.max_tokens, 1400);
      assert.ok(lastPayload.messages[0].content.includes('neutro, equilibrado'), 'Tone neutra ausente no system prompt');
      return `Retry 503->200 OK, payload top_p=${lastPayload.top_p}, repeat_penalty=${lastPayload.repeat_penalty}, max_tokens=${lastPayload.max_tokens}`;
    } finally {
      srv.close();
      rmSafe(tmpRoot);
    }
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

  await runCase('Integridade & AGENTS.md', 'SYS-02', 'Zero emojis em codigo, HTML, CSS, JSON e documentacao tecnica', () => {
    const files = walkJs(path.join(CODE_DIR, 'src')).concat([
      path.join(CODE_DIR, 'mpe.config.json'),
      path.join(CODE_DIR, 'models', 'README.txt')
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

  await runCase('Integridade & AGENTS.md', 'SYS-03', 'AppUserModelId, setAppDetails e binarios Win32 presentes', () => {
    const mainJs = fs.readFileSync(path.join(CODE_DIR, 'src', 'main', 'main.js'), 'utf8');
    const launcherCs = fs.readFileSync(path.join(CODE_DIR, 'src', 'native', 'MpeLauncher.cs'), 'utf8');
    const hasAumidConst = mainJs.includes("'DevFLeo.MousePerformaticoEstrelado'");
    const aumidIdx = mainJs.indexOf('app.setAppUserModelId(');
    const winIdx = mainJs.indexOf('new BrowserWindow');
    assert.ok(hasAumidConst && aumidIdx > 0 && aumidIdx < winIdx, 'AUMID deve vir antes de createWindow/BrowserWindow');
    assert.ok(mainJs.includes('mainWindow.setAppDetails(') && mainJs.includes('relaunchCommand'), 'setAppDetails com relaunchCommand obrigatorio para Fixar na Barra de Tarefas');
    assert.ok(launcherCs.includes('IPropertyStore') && launcherCs.includes('DevFLeo.MousePerformaticoEstrelado'), 'MpeLauncher.cs deve gravar PKEY_AppUserModel_ID no .lnk');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'src', 'native', 'bin', 'MpeHook.exe')), 'MpeHook.exe ausente');
    assert.ok(fs.existsSync(path.join(ROOT_DIR, 'MPE.exe')), 'MPE.exe ausente');
    assert.ok(fs.existsSync(path.join(CODE_DIR, 'assets', 'icon.ico')), 'icon.ico ausente');
    return 'AUMID + setAppDetails + IPropertyStore .lnk configurados; MPE.exe, MpeHook.exe e icon.ico presentes';
  });

  await runCase('Integridade & AGENTS.md', 'SYS-04', 'DOM completo do assistente interativo, topbar, guia /boost e IDs do Astrolabio', () => {
    const html = fs.readFileSync(path.join(CODE_DIR, 'src', 'renderer', 'index.html'), 'utf8');
    const requiredIds = [
      'btn-tab-astrolabe',
      'btn-tab-organizer',
      'btn-dock-organizer',
      'btn-dock-kataros',
      'btn-open-guide',
      'btn-guide-open-chat',
      'btn-guide-repair-shortcut',
      'modal-guide',
      'cfg-ai-boost',
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
      'side-chat-drawer',
      'side-ai-preset',
      'mini-assistant-overlay'
    ];
    for (const id of requiredIds) {
      assert.ok(html.includes(`id="${id}"`), `ID obrigatorio ausente no HTML: ${id}`);
    }
    return `Todos os ${requiredIds.length} IDs estruturais, guia /boost e assistente presentes`;
  });

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
