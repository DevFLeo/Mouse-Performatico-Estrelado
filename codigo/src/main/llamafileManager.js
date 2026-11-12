const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');

/**
 * Gerenciador do motor Mozilla llamafile (LLM local, 100% offline).
 * - Procura o modelo em models/ (*.llamafile, *.llamafile.exe ou *.gguf + llamafile.exe)
 * - No Windows, renomeia *.llamafile para *.llamafile.exe (exigencia do sistema)
 * - Evita conflitos de porta (ex: Apache na porta 8080) e valida resposta JSON real do LLM
 * - Sobe o servidor OpenAI-compativel em 127.0.0.1:<porta> e aguarda ficar pronto
 */
class LlamafileManager {
  constructor(rootDir, codeDir) {
    this.rootDir = rootDir;
    this.codeDir = codeDir || rootDir;
    this.child = null;
    this.state = 'offline'; // offline | starting | online | error | external
    this.lastError = '';
    this.modelName = '';
    this.defaultPort = 18080;
    this.port = this.defaultPort;
    this.activePort = null;
    this.startPromise = null;
    this.lastLoadMs = 0;
    this.lastMetrics = null;
    this.logPath = path.join(this.codeDir, 'logs', 'llamafile.log');
  }

  getBoostTuning(aiCfg = {}) {
    const cpus = os.cpus() || [];
    const logicalCores = cpus.length || 4;
    const mode = ['eco', 'balanced', 'turbo'].includes(aiCfg.boostMode) ? aiCfg.boostMode : 'balanced';
    const configuredCtx = parseInt(aiCfg.contextSize, 10) || 4096;

    if (mode === 'eco') {
      return {
        mode: 'eco',
        label: 'Eco (Baixa RAM)',
        contextSize: Math.min(configuredCtx, 2048),
        threads: aiCfg.threads || Math.max(2, Math.min(4, Math.floor(logicalCores * 0.3))),
        threadsBatch: Math.max(2, Math.min(6, Math.floor(logicalCores * 0.45))),
        batchSize: 512,
        kvType: 'q8_0',
        flashAttn: 'on',
        priority: 'normal'
      };
    }

    if (mode === 'turbo') {
      return {
        mode: 'turbo',
        label: 'Turbo (/boost)',
        contextSize: configuredCtx,
        threads: aiCfg.threads || Math.max(4, Math.min(8, Math.round(logicalCores * 0.375))),
        threadsBatch: Math.max(4, Math.min(12, Math.floor(logicalCores * 0.75))),
        batchSize: 2048,
        kvType: 'q8_0',
        flashAttn: 'on',
        priority: 'above_normal'
      };
    }

    return {
      mode: 'balanced',
      label: 'Balanceado',
      contextSize: configuredCtx,
      threads: aiCfg.threads || Math.max(4, Math.min(8, Math.round(logicalCores * 0.375))),
      threadsBatch: Math.max(4, Math.min(10, Math.floor(logicalCores * 0.65))),
      batchSize: 1024,
      kvType: 'q8_0',
      flashAttn: 'on',
      priority: 'normal'
    };
  }

  recordMetrics(metrics = {}) {
    this.lastMetrics = Object.assign(
      {
        updatedAt: new Date().toISOString()
      },
      this.lastMetrics || {},
      metrics
    );
  }

  measureElectronMemoryMb() {
    const mainRssMb = Math.round(process.memoryUsage().rss / (1024 * 1024));
    try {
      if (process.versions && process.versions.electron) {
        const { app } = require('electron');
        if (app && typeof app.getAppMetrics === 'function') {
          const metrics = app.getAppMetrics() || [];
          if (metrics.length > 0) {
            let wsKb = 0;
            let privKb = 0;
            for (const m of metrics) {
              if (m && m.memory) {
                wsKb += m.memory.workingSetSize || 0;
                privKb += m.memory.privateBytes || 0;
              }
            }
            if (wsKb > 0) {
              return {
                measured: true,
                processCount: metrics.length,
                workingSetMb: Math.round(wsKb / 1024),
                privateMb: Math.round(privKb / 1024),
                mainRssMb
              };
            }
          }
        }
      }
    } catch (_) {}
    return {
      measured: false,
      processCount: 5,
      workingSetMb: 440,
      privateMb: 325,
      mainRssMb
    };
  }

  getPerformanceProfile(aiCfg = {}) {
    const totalRamBytes = os.totalmem();
    const freeRamBytes = os.freemem();
    const totalRamGb = Number((totalRamBytes / (1024 ** 3)).toFixed(2));
    const freeRamGb = Number((freeRamBytes / (1024 ** 3)).toFixed(2));
    const cpus = os.cpus() || [];
    const cpuModel = (cpus[0] && cpus[0].model ? cpus[0].model.trim() : 'CPU x64');
    const logicalCores = cpus.length || 4;
    const tuning = this.getBoostTuning(aiCfg);

    const model = this.findModel(aiCfg);
    let ggufBytes = 0;
    let runnerBytes = 0;
    try {
      if (model && model.gguf && fs.existsSync(model.gguf)) ggufBytes = fs.statSync(model.gguf).size;
      if (model && model.exe && fs.existsSync(model.exe)) runnerBytes = fs.statSync(model.exe).size;
    } catch (_) {}

    const ggufGb = Number((ggufBytes / (1024 ** 3)).toFixed(2));
    const ggufMb = Math.round(ggufBytes / (1024 * 1024));
    const runnerMb = Math.round(runnerBytes / (1024 * 1024));
    const diskModelsGb = Number(((ggufBytes + runnerBytes) / (1024 ** 3)).toFixed(2));

    const electronMem = this.measureElectronMemoryMb();
    const electronSuiteMb = electronMem.workingSetMb;
    const hookMb = 28;
    const kvCacheMb = ggufBytes > 0
      ? Math.round((tuning.contextSize / 4096) * (tuning.kvType === 'q8_0' ? 280 : 560))
      : 0;
    const computeBufMb = ggufBytes > 0 ? 180 : 0;
    const llmEstimatedMb = ggufBytes > 0 ? ggufMb + kvCacheMb + computeBufMb : 0;
    const totalMpeWithLlmGb = Number(((electronSuiteMb + hookMb + llmEstimatedMb) / 1024).toFixed(2));
    const windowsBaseGb = 4.0;
    const totalSystemWithLlmGb = Number((windowsBaseGb + totalMpeWithLlmGb).toFixed(1));

    const estGenTokSec = ggufGb <= 0
      ? 0
      : ggufGb <= 1.4
      ? 24.0
      : ggufGb <= 2.6
      ? 13.5
      : ggufGb <= 5.5
      ? (tuning.mode === 'turbo' ? 5.2 : tuning.mode === 'eco' ? 4.0 : 4.7)
      : 2.5;
    const estPromptTokSec = ggufGb <= 0
      ? 0
      : ggufGb <= 1.4
      ? 95.0
      : ggufGb <= 2.6
      ? 52.0
      : ggufGb <= 5.5
      ? (tuning.mode === 'turbo' ? 29.0 : tuning.mode === 'eco' ? 21.5 : 26.0)
      : 12.0;

    const kits = [
      {
        id: 'kit-minimo',
        name: 'Kit Mínimo (HUD 2D/3D + Motor Kataros Instantâneo)',
        cpu: 'Dual-Core x64 (2+ threads)',
        ram: '4 GB RAM (M.P.E base ~350-480 MB)',
        disk: '500 MB livres',
        gpu: 'Integrada (Canvas 2D/3D)',
        speed: '~2 ms por revisão/ação (sem modelo GGUF)'
      },
      {
        id: 'kit-entrada',
        name: 'Kit Entrada I.A Offline (Modelo 1.5B Q4_K_M)',
        cpu: 'Quad-Core AVX2 (4+ threads)',
        ram: '8 GB RAM (LLM ~1,5 GB + SO + HUD)',
        disk: '2 GB livres',
        gpu: 'Integrada ou Dedicada',
        speed: '18-30 tok/s em CPU (~1,5 s carga)'
      },
      {
        id: 'kit-recomendado',
        name: 'Kit Recomendado (Modelo 3B-7B Q4_K_M + /boost)',
        cpu: '6+ Núcleos / 12+ Threads AVX2',
        ram: '16 GB RAM (7B usa ~4,5 GB + 0,47 GB HUD)',
        disk: '6 GB livres (SSD NVMe)',
        gpu: 'Integrada ou RTX',
        speed: '22-33 tok/s prompt | 4,0-5,5 tok/s geração (7B CPU)'
      },
      {
        id: 'kit-ultra',
        name: 'Kit Ultra GPU (7B-14B em VRAM Dedicada)',
        cpu: '8+ Núcleos AVX2',
        ram: '16-32 GB RAM + GPU 6-8 GB VRAM',
        disk: '10 GB livres (SSD NVMe)',
        gpu: 'NVIDIA RTX 6-8 GB VRAM (runner CUDA/Vulkan)',
        speed: '45-90+ tok/s em VRAM (~1,5 s carga)'
      }
    ];

    const recommendedKit =
      totalRamGb < 7
        ? kits[0]
        : totalRamGb < 12
        ? kits[1]
        : kits[2];

    return {
      boostMode: tuning.mode,
      boostLabel: tuning.label,
      tuning,
      hardware: {
        cpuModel,
        logicalCores,
        totalRamGb,
        freeRamGb
      },
      model: {
        found: Boolean(model),
        name: model ? model.name : 'Nenhum GGUF detectado',
        ggufGb,
        ggufMb,
        runnerMb,
        diskModelsGb,
        engineState: this.state
      },
      memory: {
        nodeMainRssMb: electronMem.mainRssMb,
        electronSuiteMb,
        electronPrivateMb: electronMem.privateMb,
        electronMeasured: electronMem.measured,
        electronProcesses: electronMem.processCount,
        hookMb,
        kvCacheMb,
        kvCacheSavedMb: tuning.kvType === 'q8_0' && ggufBytes > 0 ? kvCacheMb : 0,
        llmEstimatedMb,
        totalMpeBaseMb: electronSuiteMb + hookMb,
        totalMpeWithLlmGb,
        totalSystemWithLlmGb,
        fitsInRam: freeRamGb + 1.5 >= totalMpeWithLlmGb
      },
      speed: {
        builtinMs: 2,
        lastLoadMs: model ? (this.lastLoadMs || 0) : 0,
        promptTokPerSec: (this.lastMetrics && this.lastMetrics.promptTokPerSec) || estPromptTokSec,
        genTokPerSec: (this.lastMetrics && this.lastMetrics.genTokPerSec) || estGenTokSec,
        measured: Boolean(this.lastMetrics && this.lastMetrics.genTokPerSec)
      },
      kits,
      recommendedKit
    };
  }

  resolve(p) {
    if (!p) return '';
    return path.isAbsolute(p) ? p : path.resolve(this.rootDir, p);
  }

  getPreferredPort(aiCfg = {}) {
    const configured = parseInt(aiCfg.port, 10);
    if (!Number.isNaN(configured) && configured > 0 && configured !== 8080) {
      return configured;
    }
    return this.defaultPort;
  }

  getActivePort(aiCfg = {}) {
    return this.activePort || this.port || this.getPreferredPort(aiCfg);
  }

  findModel(aiCfg = {}) {
    const explicit = this.resolve(aiCfg.llamafilePath);
    if (explicit && fs.existsSync(explicit)) {
      return this.describe(explicit, aiCfg);
    }

    let dir = this.resolve(aiCfg.modelsDir || './codigo/models');
    if (!fs.existsSync(dir)) {
      dir = path.join(this.codeDir, 'models');
    }
    if (!fs.existsSync(dir)) return null;

    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => {
        if (/\.(part|tmp|crdownload)$/i.test(f)) return false;
        try {
          return fs.statSync(path.join(dir, f)).isFile();
        } catch (_) {
          return false;
        }
      });
    } catch (_) {
      return null;
    }

    const lower = (f) => f.toLowerCase();

    // Prioriza pares GGUF + llamafile.exe (sem limite de 4 GB no Windows e com CUDA/Vulkan)
    const gguf = files.find((f) => lower(f).endsWith('.gguf'));
    const runner = files.find((f) => /^llamafile.*\.exe$/i.test(f) || /^llamafile$/i.test(f));
    if (gguf && runner) {
      return { exe: path.join(dir, runner), gguf: path.join(dir, gguf), name: gguf };
    }

    const llamaExe = files.find((f) => /\.llamafile\.exe$/i.test(f));
    if (llamaExe) return this.describe(path.join(dir, llamaExe), aiCfg);

    const llama = files.find((f) => lower(f).endsWith('.llamafile'));
    if (llama) return this.describe(path.join(dir, llama), aiCfg);

    return null;
  }

  describe(file, aiCfg = {}) {
    if (file.toLowerCase().endsWith('.gguf')) {
      const dir = path.dirname(file);
      const runnerCfg = this.resolve(aiCfg.llamafileBinary);
      let runner = runnerCfg && fs.existsSync(runnerCfg) ? runnerCfg : '';
      if (!runner) {
        try {
          const f = fs.readdirSync(dir).find((x) => /^llamafile.*\.exe$/i.test(x) || /^llamafile$/i.test(x));
          if (f) runner = path.join(dir, f);
        } catch (_) {}
      }
      return runner ? { exe: runner, gguf: file, name: path.basename(file) } : null;
    }
    return { exe: file, gguf: '', name: path.basename(file) };
  }

  httpGet(port, urlPath, timeoutMs = 1500) {
    return new Promise((resolve) => {
      let settled = false;
      const done = (val) => {
        if (!settled) {
          settled = true;
          resolve(val);
        }
      };
      const req = http.get({ hostname: '127.0.0.1', port, path: urlPath, timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          done({
            statusCode: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || '').toLowerCase(),
            body
          });
        });
      });
      req.on('timeout', () => {
        req.destroy();
        done(null);
      });
      req.on('error', () => done(null));
    });
  }

  /**
   * Verifica se ha um servidor llamafile/llama.cpp REAL respondendo na porta.
   * Nunca aceita 404 ou paginas HTML (como Apache/IIS) como servidor conectado.
   */
  async ping(port, timeoutMs = 2500) {
    const h = await this.httpGet(port, '/health', timeoutMs);
    if (!h) return 'fail';

    const trimmed = (h.body || '').trim();
    const looksHtml = h.contentType.includes('text/html') || trimmed.startsWith('<');
    if (looksHtml) return 'fail';

    if (h.statusCode === 503) return 'loading';
    if (h.statusCode === 200) {
      if (!trimmed) return 'ok';
      try {
        const j = JSON.parse(trimmed);
        if (j && (j.status === 'ok' || j.status === 'no slot available' || j.slots_idle !== undefined)) {
          return 'ok';
        }
        if (j && j.status === 'loading model') return 'loading';
      } catch (_) {
        if (/^ok$/i.test(trimmed)) return 'ok';
      }
    }

    // Fallback: verifica /v1/models JSON valido (ex: alguns servidores OpenAI-compativeis)
    const m = await this.httpGet(port, '/v1/models', timeoutMs);
    if (m && m.statusCode === 200 && !m.contentType.includes('text/html')) {
      try {
        const mj = JSON.parse(m.body || '{}');
        if (mj && (Array.isArray(mj.data) || mj.object === 'list')) {
          return 'ok';
        }
      } catch (_) {}
    }

    return 'fail';
  }

  isPortAvailable(port) {
    return new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.once('listening', () => {
        srv.close(() => resolve(true));
      });
      srv.listen(port, '127.0.0.1');
    });
  }

  async findFreePort(preferredPort) {
    const candidates = [preferredPort, 18080, 18081, 18082, 18083, 18084, 18085];
    for (const p of candidates) {
      if (p > 0 && (await this.isPortAvailable(p))) {
        return p;
      }
    }
    return preferredPort || 18080;
  }

  async status(aiCfg = {}) {
    const checkPort = this.activePort || this.getPreferredPort(aiCfg);
    this.port = checkPort;
    const model = this.findModel(aiCfg);
    if (this.state !== 'starting') {
      const p = await this.ping(checkPort);
      if (p === 'ok') {
        this.state = this.child ? 'online' : 'external';
        this.activePort = checkPort;
      } else if (p === 'loading') {
        this.state = 'starting';
      } else if (this.state === 'online' || this.state === 'external') {
        this.state = 'offline';
        this.activePort = null;
      }
    }
    return {
      state: this.state,
      modelFound: Boolean(model),
      modelName: this.modelName || (model ? model.name : ''),
      port: this.port,
      error: this.lastError
    };
  }

  isReady() {
    return this.state === 'online' || this.state === 'external';
  }

  ensureStarted(aiCfg = {}) {
    if (this.isReady()) return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.start(aiCfg).finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async start(aiCfg = {}) {
    let targetPort = this.getPreferredPort(aiCfg);
    this.lastError = '';

    // Se ja houver um servidor LLM valido rodando nessa porta, reutiliza ou aguarda terminar de carregar
    const pre = await this.ping(targetPort);
    if (pre === 'ok') {
      this.port = targetPort;
      this.activePort = targetPort;
      this.state = this.child ? 'online' : 'external';
      return true;
    }
    if (pre === 'loading') {
      this.port = targetPort;
      this.activePort = targetPort;
      this.state = 'starting';
      const waitDeadline = Date.now() + (parseInt(aiCfg.startupTimeoutMs, 10) || 240000);
      while (Date.now() < waitDeadline) {
        const p = await this.ping(targetPort);
        if (p === 'ok') {
          this.state = this.child ? 'online' : 'external';
          return true;
        }
        if (p === 'fail') break;
        await new Promise((r) => setTimeout(r, 700));
      }
    }

    // Se a porta estiver ocupada por outro programa (ex: httpd/Apache), escolhe porta livre
    if (!(await this.isPortAvailable(targetPort))) {
      targetPort = await this.findFreePort(this.defaultPort);
    }
    this.port = targetPort;
    this.activePort = targetPort;

    let model = this.findModel(aiCfg);
    if (!model) {
      this.state = 'offline';
      this.activePort = null;
      this.lastError = 'Nenhum modelo .llamafile ou .gguf encontrado em codigo/models/';
      return false;
    }

    // Windows so executa binarios standalone com extensao .exe
    if (process.platform === 'win32' && !model.gguf && !model.exe.toLowerCase().endsWith('.exe')) {
      const renamed = `${model.exe}.exe`;
      try {
        fs.renameSync(model.exe, renamed);
        model = { exe: renamed, gguf: '', name: path.basename(renamed) };
      } catch (err) {
        this.state = 'error';
        this.activePort = null;
        this.lastError = `Nao foi possivel renomear para .exe: ${err.message}`;
        return false;
      }
    }

    const tuning = this.getBoostTuning(aiCfg);
    const args = [];
    if (model.gguf) args.push('-m', model.gguf);
    args.push('--server', '--nologo', '--no-webui', '--host', '127.0.0.1', '--port', String(this.port));
    args.push('-np', String(parseInt(aiCfg.parallelSlots, 10) || 1));
    args.push('-c', String(tuning.contextSize));
    args.push('-b', String(tuning.batchSize));
    args.push('-fa', tuning.flashAttn);
    args.push('-ctk', tuning.kvType, '-ctv', tuning.kvType);
    args.push('-t', String(tuning.threads));
    args.push('-tb', String(tuning.threadsBatch));

    const gpuMode = aiCfg.gpuMode || 'auto';
    args.push('--gpu', gpuMode);

    if (aiCfg.gpuLayers !== undefined && aiCfg.gpuLayers !== null && aiCfg.gpuLayers !== '') {
      args.push('-ngl', String(aiCfg.gpuLayers));
    } else {
      args.push('-ngl', 'auto');
    }

    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      fs.writeFileSync(this.logPath, `[${new Date().toISOString()}] [${tuning.mode}] ${model.exe} ${args.join(' ')}\n`);
    } catch (_) {}

    this.state = 'starting';
    this.modelName = model.name;

    let spawnedChild = null;
    try {
      spawnedChild = spawn(model.exe, args, {
        cwd: path.dirname(model.exe),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      this.child = spawnedChild;
      if (tuning.priority === 'above_normal' && spawnedChild && spawnedChild.pid) {
        try {
          os.setPriority(spawnedChild.pid, os.constants.priority.PRIORITY_ABOVE_NORMAL);
        } catch (_) {}
      }
    } catch (err) {
      this.state = 'error';
      this.activePort = null;
      this.lastError = `Falha ao iniciar llamafile: ${err.message}`;
      return false;
    }

    const appendLog = (buf) => {
      if (this.child !== spawnedChild) return;
      try {
        fs.appendFileSync(this.logPath, buf);
      } catch (_) {}
    };
    spawnedChild.stdout.on('data', appendLog);
    spawnedChild.stderr.on('data', appendLog);
    spawnedChild.on('error', (err) => {
      if (this.child !== spawnedChild) return;
      this.state = 'error';
      this.activePort = null;
      this.lastError = `Erro no processo llamafile: ${err.message}`;
      this.child = null;
    });
    spawnedChild.on('exit', (code) => {
      if (this.child !== spawnedChild) return;
      if (this.state !== 'offline') {
        this.state = code === 0 ? 'offline' : 'error';
        if (code) this.lastError = `llamafile encerrou (codigo ${code}). Veja codigo/logs/llamafile.log`;
      }
      this.activePort = null;
      this.child = null;
    });

    const timeoutMs = parseInt(aiCfg.startupTimeoutMs, 10) || 240000;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.child !== spawnedChild) return false;
      const p = await this.ping(this.port);
      if (this.child !== spawnedChild) return false;
      if (p === 'ok') {
        this.lastLoadMs = Date.now() - t0;
        this.state = 'online';
        this.activePort = this.port;
        return true;
      }
      await new Promise((r) => setTimeout(r, 700));
    }

    this.state = 'error';
    this.lastError = 'Tempo esgotado aguardando o modelo carregar.';
    this.stop();
    return false;
  }

  stop() {
    const oldChild = this.child;
    this.child = null;
    this.activePort = null;
    this.state = 'offline';
    if (oldChild) {
      try {
        oldChild.kill();
      } catch (_) {}
    }
  }

  async stopAsync(timeoutMs = 5000) {
    const oldChild = this.child;
    const oldPort = this.activePort || this.port;
    this.child = null;
    this.activePort = null;
    this.state = 'offline';

    if (oldChild) {
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (!done) {
            done = true;
            resolve();
          }
        };
        oldChild.once('exit', finish);
        try {
          oldChild.kill();
        } catch (_) {
          finish();
        }
        setTimeout(() => {
          if (!done && oldChild.pid && process.platform === 'win32') {
            try {
              const { execFileSync } = require('child_process');
              execFileSync('taskkill', ['/PID', String(oldChild.pid), '/T', '/F'], { windowsHide: true });
            } catch (_) {}
          }
          setTimeout(finish, 200);
        }, Math.min(1800, timeoutMs));
      });
    }

    if (oldPort) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        if (await this.isPortAvailable(oldPort)) break;
        await new Promise((r) => setTimeout(r, 120));
      }
    }
  }
}

module.exports = LlamafileManager;
