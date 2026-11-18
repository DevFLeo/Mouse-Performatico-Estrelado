'use strict';

/**
 * Tier 5 - Estresse pesado (cliques, hover, teclas, zoom, ciclos de HUD, memoria, reinicios).
 * Objetivo: provar que o M.P.E nao trava, nao vaza memoria e nao deixa processos orfaos
 * sob uso repetido e exagerado.
 */

const assert = require('assert');

const { sleep } = require('../lib/cdpClient');
const { MockServer } = require('../lib/mockServer');
const h = require('../lib/helpers');

const HUB_SEL = '[data-mini-hub], #mini-hub, #mini-core, .mini-hub, .mini-core, .mini-dot';

function t(id, features, name, fn) {
  return { id, tier: 5, feature: features, name, fn };
}

function urlPoints(mock, n, withLetters) {
  const letters = 'ABCDEFGHIJKL';
  const pts = [];
  for (let i = 0; i < n; i++) {
    pts.push({
      id: `stress-${i + 1}`,
      code: `${String(i + 1).padStart(2, '0')} 7`,
      title: `Stress ${i + 1}`,
      actionType: 'open_url',
      orbit: 2 + (i % 2),
      angle: (i * 360) / n,
      elevation: 12,
      vectorStyle: 'gold',
      glyph: 'C',
      ...(withLetters ? { hotkeyLetter: letters[i] } : {}),
      params: { url: mock.url(`/s${i + 1}`) }
    });
  }
  return pts;
}

// Resposta da janela principal: um round-trip IPC deve voltar rapido mesmo sob carga.
async function assertResponsive(page, label, maxMs = 1500) {
  const t0 = Date.now();
  await page.eval(() => window.mpeApi.getConfig());
  const ms = Date.now() - t0;
  assert.ok(ms <= maxMs, `${label}: janela demorou ${ms}ms para responder (limite ${maxMs}ms)`);
  return ms;
}

const tier5Tests = [
  t('T5-01', 'STRESS', '300 cliques rapidos nos botoes do leque do Mini executam sem perder acoes', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T5-01', {
      points: urlPoints(mock, 6, false),
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      const mini = await h.connectMiniPage(app.session);
      await mini.hover(HUB_SEL);
      await sleep(300);
      const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
      assert.ok(vis.length >= 6, `Esperado 6 botoes visiveis, achou ${vis.length}`);
      const CLICKS = 300;
      for (let i = 0; i < CLICKS; i++) {
        const s = vis[i % 6];
        await mini.clickAt(s.rect.cx, s.rect.cy);
        if (i % 6 === 5) {
          await mini.hover(HUB_SEL);
        }
        await sleep(15);
      }
      const deadline = Date.now() + 15000;
      let hits = 0;
      while (Date.now() < deadline) {
        hits = mock.getRequests((r) => /^\/s\d+$/.test(r.path)).length;
        if (hits >= CLICKS) break;
        await sleep(200);
      }
      assert.ok(hits >= CLICKS * 0.95, `Apenas ${hits}/${CLICKS} cliques executaram (minimo 95%)`);
      await assertResponsive(app.mainPage, 'apos 300 cliques');
      assert.deepStrictEqual(mini.getErrors(), [], 'Erros JS no Mini');
      assert.deepStrictEqual(app.mainPage.getErrors(), [], 'Erros JS no Main');
      return `${hits}/${CLICKS} cliques executados`;
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T5-02', 'STRESS', '500 ciclos de mouse entra/sai no Mini: pausa e retomada sempre coerentes', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T5-02');
    try {
      const mini = await h.connectMiniPage(app.session);
      for (let i = 0; i < 500; i++) {
        await mini.hover(HUB_SEL);
        await mini.moveOutside();
      }
      await sleep(900);
      const st = await mini.eval(() => {
        const root = document.querySelector('.mini-root, [data-mini-root], body');
        const rotor =
          document.querySelector('[data-mini-rotor], .mini-rotor, .mini-rotator, #mini-rotator, .mini-hub-ring') ||
          document.querySelector('[data-mini-hub], #mini-hub, #mini-core, .mini-hub');
        return {
          expanded: Boolean(root && root.classList.contains('is-expanded')),
          playState: rotor ? getComputedStyle(rotor).animationPlayState : 'none'
        };
      });
      assert.notStrictEqual(st.playState, 'paused', 'Rotacao ficou pausada depois de sair com o mouse');
      await assertResponsive(app.mainPage, 'apos 500 hovers');
      assert.deepStrictEqual(mini.getErrors(), []);
      return `estado final expanded=${st.expanded} playState=${st.playState}`;
    } finally {
      await app.close();
    }
  }),

  t('T5-03', 'STRESS', '240 teclas (numeros e letras) no HUD principal executam o atalho certo', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T5-03', {
      points: urlPoints(mock, 4, true),
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      // 120 por numero (1..4) + 120 por letra (A..D)
      const plan = [];
      for (let i = 0; i < 120; i++) plan.push({ key: String((i % 4) + 1), path: `/s${(i % 4) + 1}` });
      for (let i = 0; i < 120; i++) {
        const L = 'ABCD'[i % 4];
        plan.push({ key: L.toLowerCase(), code: `Key${L}`, path: `/s${(i % 4) + 1}` });
      }
      for (const p of plan) {
        await app.mainPage.pressKey(p.key, p.code);
        await sleep(20);
      }
      const deadline = Date.now() + 15000;
      let hits = 0;
      while (Date.now() < deadline) {
        hits = mock.getRequests((r) => /^\/s[1-4]$/.test(r.path)).length;
        if (hits >= plan.length) break;
        await sleep(200);
      }
      assert.ok(hits >= plan.length * 0.95, `Apenas ${hits}/${plan.length} teclas executaram`);
      for (let k = 1; k <= 4; k++) {
        const c = mock.getRequests((r) => r.path === `/s${k}`).length;
        assert.ok(c >= 50, `Atalho ${k} recebeu so ${c} execucoes (esperado ~60)`);
      }
      // Tecla sem atalho (Z) nao executa nada
      const before = mock.getRequests(() => true).length;
      for (let i = 0; i < 20; i++) await app.mainPage.pressKey('z', 'KeyZ');
      await sleep(600);
      assert.strictEqual(mock.getRequests(() => true).length, before, 'Letra sem atalho executou algo');
      await assertResponsive(app.mainPage, 'apos 260 teclas');
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      return `${hits}/${plan.length} teclas executadas, letra livre ignorada`;
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T5-04', 'STRESS', '80 ciclos esconder/mostrar HUD intercalados com Organizador sem travar', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T5-04');
    try {
      let worst = 0;
      for (let i = 0; i < 80; i++) {
        await app.mainPage.eval(() => window.mpeApi.hideHud());
        await sleep(15);
        await app.mainPage.eval(() =>
          window.mpeApi.executePoint({ id: 'open-org', actionType: 'open_organizer', params: {} })
        );
        await sleep(15);
        if (i % 10 === 0) worst = Math.max(worst, await assertResponsive(app.mainPage, `ciclo ${i}`));
      }
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      return `80 ciclos, pior resposta ${worst}ms`;
    } finally {
      await app.close();
    }
  }),

  t('T5-05', 'STRESS', '120 cliques de zoom +/- no Mini: botoes continuam >= 40px e fora do centro', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T5-05', { points: urlPoints(mock, 8, false) });
    try {
      const mini = await h.connectMiniPage(app.session);
      for (let i = 0; i < 120; i++) {
        await mini.hover(HUB_SEL);
        const id = Math.floor(i / 20) % 2 === 0 ? '#btn-mini-scale-up' : '#btn-mini-scale-down';
        await mini.eval((sel) => {
          const b = document.querySelector(sel);
          if (b) b.click();
        }, id);
        await sleep(10);
      }
      await mini.hover(HUB_SEL);
      await sleep(350);
      const info = await h.getMiniHubAndSlots(mini);
      const vis = info.slots.filter((s) => s.visible);
      assert.ok(vis.length >= 8, `Esperado 8 botoes, achou ${vis.length}`);
      for (const s of vis) {
        assert.ok(s.rect.width >= 39.5, `Botao menor que 40px: ${s.rect.width}`);
      }
      const st = await app.mainPage.eval(() => window.mpeApi.getMiniAstrolabeState());
      assert.ok(st.scale >= 0.75 && st.scale <= 1.5, `Escala fora do limite: ${st.scale}`);
      assert.deepStrictEqual(mini.getErrors(), []);
      return `escala final ${st.scale}, ${vis.length} botoes >= 40px`;
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T5-06', 'STRESS', 'Memoria estavel: 200 aberturas do leque depois do aquecimento (<= 60 MB)', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T5-06');
    try {
      const mini = await h.connectMiniPage(app.session);
      for (let i = 0; i < 30; i++) {
        await mini.hover(HUB_SEL);
        await mini.moveOutside();
      }
      await sleep(5000);
      const s0 = ctx.processManager.getProcessTreeStats(app.session.pid);
      for (let i = 0; i < 200; i++) {
        await mini.hover(HUB_SEL);
        await sleep(5);
        await mini.moveOutside();
      }
      await sleep(3000);
      const s1 = ctx.processManager.getProcessTreeStats(app.session.pid);
      const mb = (s1.totalWorkingSetBytes - s0.totalWorkingSetBytes) / (1024 * 1024);
      assert.ok(mb <= 60, `Memoria cresceu ${mb.toFixed(1)} MB em 200 aberturas`);
      assert.deepStrictEqual(mini.getErrors(), []);
      return `crescimento ${mb.toFixed(1)} MB`;
    } finally {
      await app.close();
    }
  }),

  t('T5-07', 'STRESS', '8 ciclos completos abrir/fechar o app sem processos orfaos', async (ctx) => {
    for (let i = 0; i < 8; i++) {
      const app = await h.launchIsolatedApp(ctx, `T5-07-${i}`);
      const rootPid = app.session.pid;
      try {
        await h.connectMiniPage(app.session).catch(() => null);
        const exit = await h.quitAppGracefully(app.mainPage, app.session, 6000);
        assert.strictEqual(exit.code, 0, `Ciclo ${i}: saida ${exit.code}`);
        await sleep(400);
        const orphans = ctx.processManager.findOrphanProcesses([rootPid], [app.ws.runToken]);
        assert.strictEqual(orphans.length, 0, `Ciclo ${i}: orfaos ${JSON.stringify(orphans)}`);
      } finally {
        await app.close();
      }
    }
    return '8 ciclos, 0 orfaos';
  }),

  t('T5-08', 'STRESS', 'Tempestade mista: cliques + teclas + hover + zoom simultaneos por 20s', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    const app = await h.launchIsolatedApp(ctx, 'T5-08', {
      points: urlPoints(mock, 6, true),
      extraEnv: { MPE_TEST_OPEN_URL_HTTP: '1' }
    });
    try {
      const mini = await h.connectMiniPage(app.session);
      const end = Date.now() + 20000;
      let ops = 0;
      const keys = async () => {
        while (Date.now() < end) {
          const L = 'ABCDEF'[ops % 6];
          await app.mainPage.pressKey(L.toLowerCase(), `Key${L}`);
          ops++;
          await sleep(35);
        }
      };
      const fan = async () => {
        while (Date.now() < end) {
          await mini.hover(HUB_SEL);
          const vis = (await h.getMiniHubAndSlots(mini)).slots.filter((s) => s.visible);
          if (vis.length) {
            const s = vis[ops % vis.length];
            await mini.clickAt(s.rect.cx, s.rect.cy);
          }
          ops++;
          await mini.moveOutside();
          await sleep(25);
        }
      };
      const probes = async () => {
        let worst = 0;
        while (Date.now() < end) {
          worst = Math.max(worst, await assertResponsive(app.mainPage, 'tempestade', 2000));
          await sleep(500);
        }
        return worst;
      };
      const [, , worst] = await Promise.all([keys(), fan(), probes()]);
      await sleep(1500);
      const hits = mock.getRequests((r) => /^\/s\d+$/.test(r.path)).length;
      assert.ok(hits > 100, `So ${hits} execucoes em 20s de tempestade`);
      assert.deepStrictEqual(mini.getErrors(), []);
      assert.deepStrictEqual(app.mainPage.getErrors(), []);
      return `${ops} operacoes, ${hits} execucoes, pior resposta ${worst}ms`;
    } finally {
      await app.close();
      await mock.stop();
    }
  }),

  t('T5-09', 'STRESS', 'Diagnostico de memoria por etapa (HUD, Organizador, 2D/3D, Mini) e por processo', async (ctx) => {
    const app = await h.launchIsolatedApp(ctx, 'T5-09');
    const rootPid = app.session.pid;
    const byType = () => {
      const st = ctx.processManager.getProcessTreeStats(rootPid);
      const out = {};
      for (const p of st.processes) {
        const m = /--type=([a-z-]+)/.exec(p.commandLine || '');
        const k = m ? m[1] : (p.name || 'proc').toLowerCase();
        out[k] = (out[k] || 0) + p.workingSetBytes;
      }
      out.total = st.totalWorkingSetBytes;
      return out;
    };
    const diff = (a, b) => {
      const r = {};
      for (const k of Object.keys(b)) r[k] = Math.round(((b[k] || 0) - (a[k] || 0)) / (1024 * 1024));
      return r;
    };
    try {
      const mini = await h.connectMiniPage(app.session);
      await sleep(5000);
      const phases = {
        hud_hide_show: async () => {
          await app.mainPage.eval(() => window.mpeApi.hideHud());
          await sleep(40);
          await app.mainPage.eval(() =>
            window.mpeApi.executePoint({ id: 'wake', actionType: 'open_organizer', params: {} })
          );
          await sleep(40);
        },
        organizer_tab: async () => {
          await app.mainPage.click('#btn-dock-organizer');
          await app.mainPage.waitForSelector('#organizer-workspace', 2500).catch(() => {});
          await app.mainPage.click('#btn-org-back-astrolabe');
          await sleep(40);
        },
        toggle_2d_3d: async () => {
          await app.mainPage.pressKey('Tab', 'Tab');
          await sleep(60);
        },
        mini_hover: async () => {
          await mini.hover(HUB_SEL);
          await sleep(60);
          await mini.moveOutside();
        }
      };
      const report = {};
      for (const [name, fn] of Object.entries(phases)) {
        const before = byType();
        for (let i = 0; i < 15; i++) await fn();
        await sleep(2500);
        report[name] = diff(before, byType());
      }
      const lines = Object.entries(report).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
      ctx.diagnostic = lines.join(' | ');
      console.log(`[T5-09 MEMORIA] ${ctx.diagnostic}`);
      const worst = Object.entries(report).sort((a, b) => b[1].total - a[1].total)[0];
      assert.ok(worst[1].total <= 60, `Etapa '${worst[0]}' cresceu ${worst[1].total} MB em 15 ciclos -> ${lines.join(' | ')}`);
      return lines.join(' | ');
    } finally {
      await app.close();
    }
  }),

  t('T5-10', 'STRESS', 'Sonda: clique sintetico chega na janela alvo (sem M.P.E, com M.P.E, HUD oculto)', async (ctx) => {
    const mock = new MockServer();
    await mock.start();
    let target = null;
    let app = null;
    const results = {};
    const probe = async (label) => {
      mock.clear();
      const b = target.bounds;
      h.performWin32Click(b.x + 60, b.y + 60);
      await sleep(700);
      results[label] = mock.getClickEvents().length;
    };
    try {
      target = await h.launchClickTargetWindow(ctx, mock, { x: 120, y: 120, width: 260, height: 260 });
      await probe('sem_mpe');
      app = await h.launchIsolatedApp(ctx, 'T5-10');
      await sleep(800);
      await probe('mpe_hud_visivel');
      await app.mainPage.eval(() => window.mpeApi.hideHud());
      await sleep(500);
      await probe('mpe_hud_oculto');
      const vis = await app.mainPage.eval(async () =>
        window.mpeApi.isMainWindowVisible ? window.mpeApi.isMainWindowVisible() : 'n/a'
      );
      const detail = `${JSON.stringify(results)} mainVisivelAposHide=${vis}`;
      console.log(`[T5-10 SONDA] ${detail}`);
      assert.ok(results.sem_mpe >= 1, `Clique sintetico nao chega nem sem o M.P.E: ${detail}`);
      assert.ok(results.mpe_hud_oculto >= 1, `Com HUD oculto o clique nao chega: ${detail}`);
      return detail;
    } finally {
      if (target) await target.close();
      if (app) await app.close();
      await mock.stop();
    }
  }),
];

module.exports = { tier5Tests };
