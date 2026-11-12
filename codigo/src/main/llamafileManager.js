const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
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
    this.logPath = path.join(this.codeDir, 'logs', 'llamafile.log');
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
  async ping(port, timeoutMs = 1500) {
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

    // Se ja houver um servidor LLM valido rodando nessa porta, reutiliza
    const pre = await this.ping(targetPort);
    if (pre === 'ok') {
      this.port = targetPort;
      this.activePort = targetPort;
      this.state = this.child ? 'online' : 'external';
      return true;
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

    const args = [];
    if (model.gguf) args.push('-m', model.gguf);
    args.push('--server', '--nologo', '--no-webui', '--host', '127.0.0.1', '--port', String(this.port));
    args.push('-np', String(parseInt(aiCfg.parallelSlots, 10) || 1));
    args.push('-c', String(parseInt(aiCfg.contextSize, 10) || 4096));

    const gpuMode = aiCfg.gpuMode || 'auto';
    args.push('--gpu', gpuMode);

    if (aiCfg.gpuLayers !== undefined && aiCfg.gpuLayers !== null && aiCfg.gpuLayers !== '') {
      args.push('-ngl', String(aiCfg.gpuLayers));
    } else {
      args.push('-ngl', 'auto');
    }

    if (aiCfg.threads) args.push('-t', String(aiCfg.threads));

    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      fs.writeFileSync(this.logPath, `[${new Date().toISOString()}] ${model.exe} ${args.join(' ')}\n`);
    } catch (_) {}

    this.state = 'starting';
    this.modelName = model.name;

    try {
      this.child = spawn(model.exe, args, {
        cwd: path.dirname(model.exe),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (err) {
      this.state = 'error';
      this.activePort = null;
      this.lastError = `Falha ao iniciar llamafile: ${err.message}`;
      return false;
    }

    const appendLog = (buf) => {
      try {
        fs.appendFileSync(this.logPath, buf);
      } catch (_) {}
    };
    this.child.stdout.on('data', appendLog);
    this.child.stderr.on('data', appendLog);
    this.child.on('error', (err) => {
      this.state = 'error';
      this.activePort = null;
      this.lastError = `Erro no processo llamafile: ${err.message}`;
      this.child = null;
    });
    this.child.on('exit', (code) => {
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
      if (!this.child) return false;
      const p = await this.ping(this.port);
      if (p === 'ok') {
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
    if (this.child) {
      try {
        this.child.kill();
      } catch (_) {}
      this.child = null;
    }
    this.activePort = null;
    this.state = 'offline';
  }
}

module.exports = LlamafileManager;
