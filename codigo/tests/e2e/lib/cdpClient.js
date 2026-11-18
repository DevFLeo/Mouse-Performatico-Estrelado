'use strict';

const fs = require('fs');
const path = require('path');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class CdpPage {
  constructor(targetInfo, wsUrl) {
    this.target = targetInfo;
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
    this.errors = [];
    this.consoleErrors = [];
    this.closed = false;
  }

  async connect(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch (_) {}
        reject(new Error(`CDP WebSocket connect timeout (${timeoutMs}ms) for ${this.wsUrl}`));
      }, timeoutMs);

      ws.addEventListener('open', async () => {
        clearTimeout(timer);
        try {
          await this.send('Runtime.enable');
          await this.send('Page.enable');
          resolve(this);
        } catch (err) {
          reject(err);
        }
      });

      ws.addEventListener('message', (event) => {
        let msg;
        try {
          msg = JSON.parse(String(event.data));
        } catch (_) {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const entry = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          clearTimeout(entry.timer);
          if (msg.error) {
            entry.reject(new Error(`CDP ${entry.method}: ${msg.error.message || JSON.stringify(msg.error)}`));
          } else {
            entry.resolve(msg.result);
          }
          return;
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          const details = msg.params && msg.params.exceptionDetails;
          const text =
            (details && (details.exception && details.exception.description)) ||
            (details && details.text) ||
            'Uncaught page exception';
          this.errors.push(text);
        } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params && msg.params.type === 'error') {
          const args = (msg.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
          this.consoleErrors.push(args);
        }
      });

      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(new Error(`CDP WebSocket closed before ${entry.method} completed`));
        }
        this.pending.clear();
      });

      ws.addEventListener('error', (err) => {
        clearTimeout(timer);
        if (this.pending.size === 0) {
          reject(new Error(`CDP WebSocket error: ${err && err.message ? err.message : 'unknown'}`));
        }
      });
    });
  }

  send(method, params = {}, timeoutMs = 10000) {
    if (!this.ws || this.closed) {
      return Promise.reject(new Error(`CDP page closed; cannot send ${method}`));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout (${timeoutMs}ms) on ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(fnOrExpression, ...args) {
    let expression;
    if (typeof fnOrExpression === 'function') {
      const serializedArgs = args.map((a) => JSON.stringify(a)).join(',');
      expression = `(${fnOrExpression.toString()})(${serializedArgs})`;
    } else {
      expression = String(fnOrExpression);
    }

    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true
    });

    if (res && res.exceptionDetails) {
      const desc =
        (res.exceptionDetails.exception && res.exceptionDetails.exception.description) ||
        res.exceptionDetails.text ||
        'Runtime.evaluate exception';
      throw new Error(`Page eval error: ${desc}`);
    }
    return res && res.result ? res.result.value : undefined;
  }

  async waitForSelector(selector, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = await this.eval((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      }, selector);
      if (found) return true;
      await sleep(75);
    }
    throw new Error(`Timeout (${timeoutMs}ms) waiting for visible selector: ${selector}`);
  }

  async waitForFunction(fn, args = [], timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    while (Date.now() < deadline) {
      try {
        const ok = await this.eval(fn, ...args);
        if (ok) return ok;
      } catch (err) {
        lastErr = err;
      }
      await sleep(75);
    }
    throw new Error(
      `Timeout (${timeoutMs}ms) waiting for predicate${lastErr ? `: ${lastErr.message}` : ''}`
    );
  }

  async getRect(selector) {
    const rect = await this.eval((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: r.x,
        y: r.y,
        width: r.width,
        height: r.height,
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2
      };
    }, selector);
    if (!rect) {
      throw new Error(`Element not found for getRect: ${selector}`);
    }
    return rect;
  }

  async hover(selector) {
    const r = await this.getRect(selector);
    await this.hoverAt(r.cx, r.cy);
    return r;
  }

  async hoverAt(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(x),
      y: Math.round(y),
      button: 'none',
      pointerType: 'mouse'
    });
  }

  async moveOutside() {
    await this.hoverAt(0, 0);
    await this.eval(() => {
      document.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      if (document.body) {
        document.body.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
      }
    });
  }

  async click(selector) {
    const r = await this.getRect(selector);
    await this.clickAt(r.cx, r.cy, 'left');
    return r;
  }

  async clickAt(x, y, button = 'left') {
    const rx = Math.round(x);
    const ry = Math.round(y);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: rx,
      y: ry,
      button: 'none',
      pointerType: 'mouse'
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rx,
      y: ry,
      button,
      clickCount: 1,
      pointerType: 'mouse'
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rx,
      y: ry,
      button,
      clickCount: 1,
      pointerType: 'mouse'
    });
  }

  async type(selector, text) {
    await this.eval((sel) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Input not found: ${sel}`);
      el.focus();
      if ('value' in el) el.value = '';
    }, selector);
    await this.send('Input.insertText', { text: String(text) });
    await this.eval((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, selector);
  }

  async pressKey(key, code, modifiers = 0) {
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: code || key,
      modifiers
    });
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: code || key,
      modifiers
    });
  }

  getErrors() {
    return [...this.errors, ...this.consoleErrors];
  }

  clearErrors() {
    this.errors = [];
    this.consoleErrors = [];
  }

  close() {
    this.closed = true;
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }
}

class ElectronSession {
  constructor(proc, port, userDataDir, processManager) {
    this.proc = proc;
    this.pid = proc.pid;
    this.port = port;
    this.userDataDir = userDataDir;
    this.processManager = processManager;
    this.stdout = '';
    this.stderr = '';
    this.pages = new Set();
    this.exitResult = null;
    this._exitPromise = new Promise((resolve) => {
      this.proc.once('close', (code, signal) => {
        this.exitResult = { code, signal };
        resolve(this.exitResult);
      });
    });
  }

  async listTargets() {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
    if (!res.ok) throw new Error(`CDP /json/list failed: HTTP ${res.status}`);
    return res.json();
  }

  async connectTarget(urlSubstring, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.exitResult) {
        throw new Error(
          `Electron exited prematurely (code=${this.exitResult.code}) before target ${urlSubstring} appeared. stderr=${this.stderr}`
        );
      }
      try {
        const targets = await this.listTargets();
        const match = targets.find((t) => {
          if (t.type !== 'page' || !t.webSocketDebuggerUrl) return false;
          if (!urlSubstring) return true;
          return String(t.url || '').includes(urlSubstring) || String(t.title || '').includes(urlSubstring);
        });
        if (match) {
          const page = new CdpPage(match, match.webSocketDebuggerUrl);
          await page.connect(Math.min(5000, timeoutMs));
          this.pages.add(page);
          return page;
        }
      } catch (_) {
        // Poll until ready
      }
      await sleep(100);
    }
    throw new Error(`Timeout (${timeoutMs}ms) finding CDP page matching "${urlSubstring}"`);
  }

  async waitForExit(timeoutMs = 6000) {
    if (this.exitResult) return this.exitResult;
    let timer;
    const res = await Promise.race([
      this._exitPromise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Electron PID ${this.pid} did not exit within ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
    clearTimeout(timer);
    return res;
  }

  async close() {
    for (const p of this.pages) {
      p.close();
    }
    this.pages.clear();
    if (!this.exitResult && this.pid) {
      this.processManager.killPidTreeSync(this.pid);
    }
  }
}

async function launchElectronWithCdp({
  electronExe,
  args,
  env,
  cwd,
  userDataDir,
  processManager,
  timeoutMs = 15000,
  verbose = false
}) {
  const proc = processManager.spawnProcess(electronExe, args, {
    env,
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  let resolvedPort = null;

  const portPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for DevTools listening port. stderr=${stderr.slice(-500)}`));
    }, timeoutMs);

    const onChunk = (chunk, isErr) => {
      const txt = chunk.toString('utf8');
      if (isErr) stderr += txt;
      else stdout += txt;
      if (verbose) process.stdout.write(txt);

      const m = (stderr + '\n' + stdout).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m && !resolvedPort) {
        resolvedPort = parseInt(m[1], 10);
        clearTimeout(timer);
        resolve(resolvedPort);
      }
    };

    proc.stdout.on('data', (c) => onChunk(c, false));
    proc.stderr.on('data', (c) => onChunk(c, true));

    proc.once('close', (code) => {
      if (!resolvedPort && userDataDir) {
        const activePortFile = path.join(userDataDir, 'DevToolsActivePort');
        if (fs.existsSync(activePortFile)) {
          const lines = fs.readFileSync(activePortFile, 'utf8').split(/\r?\n/);
          const p = parseInt(lines[0], 10);
          if (p > 0) {
            resolvedPort = p;
            clearTimeout(timer);
            resolve(p);
            return;
          }
        }
      }
      if (!resolvedPort) {
        clearTimeout(timer);
        reject(new Error(`Electron exited (code=${code}) before CDP ready. stderr=${stderr.slice(-500)}`));
      }
    });
  });

  const port = await portPromise;
  const session = new ElectronSession(proc, port, userDataDir, processManager);
  session.stdout = stdout;
  session.stderr = stderr;
  proc.stdout.on('data', (c) => {
    session.stdout += c.toString('utf8');
  });
  proc.stderr.on('data', (c) => {
    session.stderr += c.toString('utf8');
  });

  processManager.registerCleanup(() => session.close());
  return session;
}

module.exports = {
  CdpPage,
  ElectronSession,
  launchElectronWithCdp,
  sleep
};
