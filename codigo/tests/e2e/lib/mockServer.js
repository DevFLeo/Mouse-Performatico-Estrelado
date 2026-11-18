'use strict';

const http = require('http');

class MockServer {
  constructor() {
    this.server = null;
    this.port = 0;
    this.requests = [];
    this.clickEvents = [];
    this.routeStatuses = new Map();
  }

  setRouteStatus(prefix, statusCode) {
    this.routeStatuses.set(prefix, statusCode);
  }

  clearRouteStatuses() {
    this.routeStatuses.clear();
  }

  async start() {
    if (this.server) return this.port;

    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const bodyRaw = Buffer.concat(chunks).toString('utf8');
        let bodyJson = null;
        try {
          if (bodyRaw && bodyRaw.trim().startsWith('{')) {
            bodyJson = JSON.parse(bodyRaw);
          }
        } catch (_) {}

        const parsedUrl = new URL(req.url || '/', `http://127.0.0.1:${this.port || 80}`);
        const reqPath = parsedUrl.pathname;

        if (reqPath === '/click-event' && req.method === 'POST') {
          if (bodyJson) this.clickEvents.push(bodyJson);
          res.writeHead(204);
          res.end();
          return;
        }

        this.requests.push({
          id: this.requests.length + 1,
          method: req.method,
          url: req.url,
          path: reqPath,
          query: Object.fromEntries(parsedUrl.searchParams.entries()),
          headers: req.headers,
          bodyRaw,
          bodyJson,
          timestamp: Date.now()
        });

        for (const [prefix, code] of this.routeStatuses.entries()) {
          if (reqPath.startsWith(prefix)) {
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, status: code }));
            return;
          }
        }

        if (reqPath === '/click-target') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>MPE E2E Click Target</title>
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: #040406; color: #F7F3E8; overflow: hidden; user-select: none; }
  #target { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; font: 700 14px sans-serif; }
</style>
</head>
<body>
  <div id="target">MPE TARGET</div>
  <script>
    window.__clicks = [];
    document.addEventListener('mousedown', (e) => {
      const evt = {
        x: e.screenX,
        y: e.screenY,
        clientX: e.clientX,
        clientY: e.clientY,
        button: e.button === 2 ? 'right' : 'left',
        timestamp: Date.now()
      };
      window.__clicks.push(evt);
      fetch('/click-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evt)
      }).catch(() => {});
    });
  </script>
</body>
</html>`);
          return;
        }

        if (reqPath.includes('/sendMessage') || reqPath.includes('/sendPhoto')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, result: { message_id: 100 + this.requests.length } }));
          return;
        }

        if (reqPath.startsWith('/status/')) {
          const code = parseInt(reqPath.split('/')[2], 10) || 500;
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: code < 400, status: code }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, path: reqPath }));
      });
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address();
        this.port = addr.port;
        resolve();
      });
    });

    return this.port;
  }

  url(p = '/') {
    const clean = p.startsWith('/') ? p : `/${p}`;
    return `http://127.0.0.1:${this.port}${clean}`;
  }

  getRequests(filterFn) {
    if (!filterFn) return [...this.requests];
    return this.requests.filter(filterFn);
  }

  getClickEvents() {
    return [...this.clickEvents];
  }

  clear() {
    this.requests = [];
    this.clickEvents = [];
  }

  async waitForRequest(predicate, timeoutMs = 6000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const hit = this.requests.find(predicate);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`MockServer timeout (${timeoutMs}ms) waiting for matching HTTP request`);
  }

  async waitForClickCount(minCount, timeoutMs = 8000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.clickEvents.length >= minCount) return [...this.clickEvents];
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(
      `MockServer timeout (${timeoutMs}ms) waiting for ${minCount} click events (got ${this.clickEvents.length})`
    );
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => {
      this.server.close(() => resolve());
    });
    this.server = null;
    this.port = 0;
  }
}

module.exports = { MockServer };
