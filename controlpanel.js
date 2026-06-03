const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { extractExtension, removeExtension } = require('./mime');

class ControlPanel {
  constructor(mocklabInstance) {
    this.app = express();
    this.mocklab = mocklabInstance;
    this.port = (parseInt(mocklabInstance.config.port) || 3232) + 1;
    this.host = mocklabInstance.config.host || 'localhost';
    this.sseClients = [];
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
  }

  getAvailableOverlays() {
    const overlaysDir = path.join(process.cwd(), 'overlays');
    try {
      if (!fs.existsSync(overlaysDir)) return [];
      return fs.readdirSync(overlaysDir).filter(f =>
        fs.statSync(path.join(overlaysDir, f)).isDirectory()
      );
    } catch (e) {
      return [];
    }
  }

  // Compute where a mock file should live so the given request resolves to it.
  // Mirrors the router resolution rules in mocklab.js (path → folder/file,
  // method suffix, query-param filenames).
  computeMockFilePath(uri, method) {
    method = (method || 'GET').toString().toUpperCase();

    const qIndex = uri.indexOf('?');
    const rawPath = qIndex >= 0 ? uri.slice(0, qIndex) : uri;
    const queryString = qIndex >= 0 ? uri.slice(qIndex + 1) : '';

    let requestPath = (rawPath === '/' || rawPath === '') ? '/index' : rawPath;
    if (!requestPath.startsWith('/')) requestPath = '/' + requestPath;

    const ext = extractExtension(requestPath) || 'json';
    const pathWithoutExt = removeExtension(requestPath);
    const methodSuffix = method !== 'GET' ? '-method-' + method.toLowerCase() : '';

    // Use the first query param to build a [name] / [name=value] filename
    let firstParam = null;
    if (queryString) {
      const pairs = queryString.split('&').filter(Boolean);
      if (pairs.length > 0) {
        const eq = pairs[0].indexOf('=');
        firstParam = eq >= 0
          ? { name: pairs[0].slice(0, eq), value: pairs[0].slice(eq + 1) }
          : { name: pairs[0], value: '' };
      }
    }

    if (firstParam && firstParam.name) {
      const fname = firstParam.value !== ''
        ? '[' + firstParam.name + '=' + firstParam.value + ']'
        : '[' + firstParam.name + ']';
      return path.join(pathWithoutExt, fname + methodSuffix + '.' + ext);
    }

    return pathWithoutExt + methodSuffix + '.' + ext;
  }

  // Does a mock file already exist at the location this request maps to?
  mockFileExists(uri, method) {
    try {
      const relPath = this.computeMockFilePath(uri, method);
      const targetAbs = path.resolve(path.join(this.mocklab.mockDir, relPath));
      const mockRoot = path.resolve(this.mocklab.mockDir);
      if (targetAbs !== mockRoot && !targetAbs.startsWith(mockRoot + path.sep)) return false;
      return fs.existsSync(targetAbs);
    } catch (e) {
      return false;
    }
  }

  // History for the client, with a `mockExists` flag on not-found entries so the
  // "Add Mock" button can stay hidden once a mock has been created (survives reloads).
  serializeHistory() {
    const history = global.mocklabRequestHistory || [];
    return history.map(e =>
      e.filePath ? e : { ...e, mockExists: this.mockFileExists(e.uri, e.method) }
    );
  }

  // Push current global state to all connected SSE clients
  broadcast() {
    const payload = JSON.stringify({
      history: this.serializeHistory(),
      overlay: global.mocklabOverlay || null,
      overlays: this.getAvailableOverlays()
    });
    this.sseClients.forEach(client => {
      try { client.write('data: ' + payload + '\n\n'); } catch (e) {}
    });
  }

  // Intercept writes to both globals so any change triggers a broadcast
  patchGlobals() {
    const self = this;

    // Proxy handler that broadcasts whenever the array is mutated
    const makeProxy = arr => new Proxy(arr, {
      set(target, prop, value) {
        target[prop] = value;
        if (prop === 'length' || !isNaN(Number(prop))) self.broadcast();
        return true;
      }
    });

    // Watch mocklabOverlay
    let _overlay = global.mocklabOverlay;
    Object.defineProperty(global, 'mocklabOverlay', {
      get() { return _overlay; },
      set(val) { _overlay = val; self.broadcast(); },
      configurable: true
    });

    // Watch mocklabRequestHistory — also wrap any replacement array in a Proxy
    let _history = makeProxy(global.mocklabRequestHistory || []);
    Object.defineProperty(global, 'mocklabRequestHistory', {
      get() { return _history; },
      set(val) {
        _history = makeProxy(Array.isArray(val) ? val : []);
        self.broadcast();
      },
      configurable: true
    });
  }

  setupRoutes() {
    // SSE stream — one persistent connection per browser tab, server pushes on every change
    this.app.get('/stream', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      this.sseClients.push(res);

      // Send current state immediately on connect
      const payload = JSON.stringify({
        history: this.serializeHistory(),
        overlay: global.mocklabOverlay || null,
        overlays: this.getAvailableOverlays()
      });
      res.write('data: ' + payload + '\n\n');

      req.on('close', () => {
        this.sseClients = this.sseClients.filter(c => c !== res);
      });
    });

    // Minimal mutation endpoint — the only way a browser can write to a Node global
    this.app.post('/set-overlay', (req, res) => {
      const { overlay } = req.body;
      global.mocklabOverlay = (overlay && overlay.trim()) ? overlay.trim() : null;
      console.log(global.mocklabOverlay
        ? 'Overlay set: ' + global.mocklabOverlay
        : 'Overlay cleared'
      );
      res.json({ ok: true });
    });

    this.app.post('/clear-history', (req, res) => {
      global.mocklabRequestHistory = [];
      res.json({ ok: true });
    });

    // Create a mock file from the panel — stored under mocks/ at the location
    // that the originating request would resolve to.
    this.app.post('/add-mock', (req, res) => {
      const { uri, method, content } = req.body || {};

      if (!uri || typeof uri !== 'string') {
        return res.status(400).json({ ok: false, error: 'Missing request URI' });
      }

      // Validate JSON before storing
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (e) {
        return res.status(400).json({ ok: false, error: 'Invalid JSON: ' + e.message });
      }

      const mockDir = this.mocklab.mockDir;
      const relPath = this.computeMockFilePath(uri, method);
      const targetAbs = path.resolve(path.join(mockDir, relPath));

      // Guard against path traversal — the file must stay inside mocks/
      const mockRoot = path.resolve(mockDir);
      if (targetAbs !== mockRoot && !targetAbs.startsWith(mockRoot + path.sep)) {
        return res.status(400).json({ ok: false, error: 'Resolved path is outside the mocks folder' });
      }

      try {
        fs.mkdirSync(path.dirname(targetAbs), { recursive: true });
        fs.writeFileSync(targetAbs, JSON.stringify(parsed, null, 2) + '\n');
      } catch (e) {
        return res.status(500).json({ ok: false, error: 'Failed to write file: ' + e.message });
      }

      const displayPath = path.relative(process.cwd(), targetAbs);
      console.log('Mock created: ' + displayPath);

      // Re-push history so every matching not-found entry hides its button now
      this.broadcast();
      res.json({ ok: true, path: displayPath });
    });

    // Serve the SPA
    this.app.get('*', (req, res) => res.send(this.getHTML()));
  }

  getHTML() {
    const mocklabPort = this.mocklab.config.port || 3232;
    const mocklabHost = this.mocklab.config.host || 'localhost';
    const mocklabProtocol = this.mocklab.protocol || 'http';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Mocklab Control Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"><\/script>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg: #0a0a0f; --surface: #111118; --surface2: #18181f;
    --border: #ffffff0f; --border-hi: #ffffff1a;
    --text: #e8e8f0; --text-dim: #8888aa; --text-dimmer: #444466;
    --accent: #7fff6e; --accent-dim: #7fff6e20; --accent-glow: #7fff6e44;
    --red: #ff5e5e; --red-dim: #ff5e5e20;
    --amber: #ffcc5e; --blue: #5eb8ff;
    --mono: 'Space Mono', monospace; --sans: 'DM Sans', sans-serif;
    --r: 6px; --r-sm: 3px;
  }
  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: var(--sans); }
  #app { display: grid; grid-template-rows: auto 1fr; height: 100%; overflow: hidden; }

  /* ── Header ── */
  header {
    display: flex; align-items: center; gap: 14px;
    padding: 0 22px; height: 50px;
    border-bottom: 1px solid var(--border); background: var(--surface); flex-shrink: 0;
  }
  .logo {
    font-family: var(--mono); font-size: 12px; font-weight: 700;
    letter-spacing: .1em; color: var(--accent); display: flex; align-items: center; gap: 8px;
  }
  .logo-dot {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--accent); box-shadow: 0 0 8px var(--accent-glow);
    animation: blink 2s ease-in-out infinite;
  }
  @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
  .header-sep { flex: 1; }
  .conn-dot {
    width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    background: var(--accent); box-shadow: 0 0 6px var(--accent-glow); transition: background .3s;
  }
  .conn-dot.off { background: var(--red); box-shadow: 0 0 6px #ff5e5e40; }
  .mocklab-link {
    font-family: var(--mono); font-size: 11px; color: var(--text-dim);
    text-decoration: none; padding: 4px 10px;
    border: 1px solid var(--border-hi); border-radius: var(--r-sm);
    transition: color .15s, border-color .15s;
  }
  .mocklab-link:hover { color: var(--accent); border-color: var(--accent); }

  /* ── Layout ── */
  main { display: grid; grid-template-columns: 256px 1fr; overflow: hidden; }

  /* ── Sidebar ── */
  aside {
    border-right: 1px solid var(--border); background: var(--surface);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .sb-block { padding: 16px; border-bottom: 1px solid var(--border); }
  .sb-label {
    font-family: var(--mono); font-size: 9px; letter-spacing: .18em;
    text-transform: uppercase; color: var(--text-dimmer); margin-bottom: 11px;
  }

  /* Overlay label row */
  .ov-label-row {
    display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px;
  }
  .ov-label-row .sb-label { margin-bottom: 0; }
  .btn-ov-filter {
    background: transparent; border: 1px solid transparent; border-radius: var(--r-sm);
    color: var(--text-dimmer); cursor: pointer; padding: 2px 5px; line-height: 1;
    transition: color .15s, border-color .15s;
  }
  .btn-ov-filter:hover { color: var(--text); border-color: var(--border-hi); }
  .btn-ov-filter.on { color: var(--accent); border-color: var(--accent); }

  /* Overlay filter */
  .ov-filter-wrap { position: relative; margin-bottom: 6px; }
  .ov-filter {
    width: 100%; font-family: var(--mono); font-size: 12px;
    padding: 6px 28px 6px 10px; background: var(--surface2);
    border: 1px solid var(--border-hi); border-radius: var(--r);
    color: var(--text); outline: none; transition: border-color .15s;
    box-sizing: border-box;
  }
  .ov-filter::placeholder { color: var(--text-dimmer); }
  .ov-filter:focus { border-color: var(--accent); }
  .ov-filter-clear {
    position: absolute; right: 7px; top: 50%; transform: translateY(-50%);
    background: transparent; border: none; color: var(--text-dimmer);
    cursor: pointer; font-size: 13px; line-height: 1; padding: 0;
    transition: color .15s;
  }
  .ov-filter-clear:hover { color: var(--text); }

  /* Overlay select */
  .ov-select {
    width: 100%; font-family: var(--mono); font-size: 12px;
    padding: 8px 28px 8px 10px; background: var(--surface2);
    border: 1px solid var(--border-hi); border-radius: var(--r);
    color: var(--text); outline: none; cursor: pointer; transition: border-color .15s;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%238888aa'/%3E%3C/svg%3E");
    background-repeat: no-repeat; background-position: right 10px center;
  }
  .ov-select:focus { border-color: var(--accent); }
  .ov-select option { background: #18181f; }

  .ov-active {
    margin-top: 10px; display: flex; align-items: center;
    gap: 8px; font-family: var(--mono); font-size: 11px; min-height: 22px;
  }
  .ov-name { color: var(--accent); flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ov-none { color: var(--text-dimmer); font-style: italic; }

  .btn {
    font-family: var(--mono); font-size: 10px; padding: 3px 8px;
    border-radius: var(--r-sm); cursor: pointer; transition: background .15s; flex-shrink: 0;
  }
  .btn-red   { background: var(--red-dim); color: var(--red); border: 1px solid #ff5e5e50; }
  .btn-red:hover { background: #ff5e5e30; }

  /* Stats */
  .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .stat { background: var(--surface2); border: 1px solid var(--border); border-radius: var(--r); padding: 10px; }
  .stat-n { font-family: var(--mono); font-size: 20px; font-weight: 700; line-height: 1; margin-bottom: 3px; }
  .stat-l { font-size: 9px; color: var(--text-dimmer); letter-spacing: .06em; }
  .c-g { color: var(--accent); } .c-r { color: var(--red); }
  .c-a { color: var(--amber); } .c-w { color: var(--text); }

  /* ── Log pane ── */
  .log-pane { display: flex; flex-direction: column; overflow: hidden; }
  .log-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 9px 14px; border-bottom: 1px solid var(--border);
    background: var(--surface); flex-shrink: 0; flex-wrap: wrap;
  }
  .bar-title { font-family: var(--mono); font-size: 9px; letter-spacing: .15em; color: var(--text-dimmer); }
  .fbtns { display: flex; gap: 3px; }
  .fbtn {
    font-family: var(--mono); font-size: 10px; padding: 3px 8px;
    border-radius: var(--r-sm); border: 1px solid var(--border-hi);
    background: transparent; color: var(--text-dim); cursor: pointer; transition: all .12s;
  }
  .fbtn:hover { color: var(--text); }
  .fbtn.on { background: var(--surface2); color: var(--text); border-color: #ffffff22; }
  .search {
    font-family: var(--mono); font-size: 12px; padding: 5px 10px;
    background: var(--surface2); border: 1px solid var(--border-hi);
    border-radius: var(--r-sm); color: var(--text);
    width: 180px; outline: none; transition: border-color .15s; margin-left: auto;
  }
  .search::placeholder { color: var(--text-dimmer); }
  .search:focus { border-color: #ffffff20; }
  .btn-refresh {
    font-family: var(--mono); font-size: 10px; padding: 5px 11px;
    border-radius: var(--r-sm); border: 1px solid var(--border-hi);
    background: transparent; color: var(--text-dim); cursor: pointer;
    display: flex; align-items: center; gap: 5px; transition: all .15s;
  }
  .btn-refresh:hover { color: var(--accent); border-color: var(--accent); }
  .btn-refresh.spin svg { animation: rot .5s linear infinite; }
  .btn-clear:hover { color: var(--red); border-color: var(--red); }
  @keyframes rot { to { transform: rotate(360deg); } }

  /* Entries */
  .log-list {
    flex: 1; overflow-y: auto; padding: 6px;
    display: flex; flex-direction: column; gap: 2px;
  }
  .log-list::-webkit-scrollbar { width: 5px; }
  .log-list::-webkit-scrollbar-thumb { background: #ffffff10; border-radius: 3px; }

  .entry {
    border-radius: var(--r-sm); border: 1px solid transparent;
    cursor: pointer; transition: background .1s, border-color .1s;
  }
  .entry:hover    { background: var(--surface2); border-color: var(--border-hi); }
  .entry.open     { background: var(--surface2); border-color: var(--border-hi); }
  .entry.is-err .entry-row { border-left: 2px solid var(--red); border-radius: var(--r-sm) 0 0 var(--r-sm); }
  .entry.is-err { border-color: #ff5e5e18; }

  .entry-row {
    display: grid; grid-template-columns: 56px 44px 1fr auto;
    align-items: center; gap: 10px; padding: 7px 10px;
  }
  .badge {
    font-family: var(--mono); font-size: 9px; font-weight: 700;
    letter-spacing: .06em; padding: 2px 4px; border-radius: 2px; text-align: center;
  }
  .b-GET    { background:#5eb8ff14; color:var(--blue); }
  .b-POST   { background:#7fff6e14; color:var(--accent); }
  .b-PUT    { background:#ffcc5e14; color:var(--amber); }
  .b-DELETE { background:#ff5e5e14; color:var(--red); }
  .b-PATCH  { background:#cc88ff14; color:#cc88ff; }
  .status { font-family: var(--mono); font-size: 11px; text-align: center; }
  .ok  { color: var(--accent); } .err { color: var(--red); }
  .uri { font-family: var(--mono); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag-err {
    font-family: var(--mono); font-size: 9px; letter-spacing: .06em;
    padding: 2px 5px; border-radius: 2px;
    background: var(--red-dim); color: var(--red); flex-shrink: 0;
  }

  /* Expanded detail */
  .detail {
    padding: 0 10px 10px; border-top: 1px solid var(--border);
    display: flex; flex-direction: column; gap: 8px; margin-top: 2px;
  }
  .d-row { display: flex; flex-direction: column; gap: 3px; }
  .d-label { font-family: var(--mono); font-size: 9px; letter-spacing: .12em; color: var(--text-dimmer); }
  .d-val {
    font-family: var(--mono); font-size: 11px; color: var(--text-dim);
    background: var(--bg); border: 1px solid var(--border);
    border-radius: var(--r-sm); padding: 6px 8px;
    white-space: pre-wrap; word-break: break-all; max-height: 150px; overflow-y: auto;
  }
  .d-val::-webkit-scrollbar { width: 4px; }
  .d-val::-webkit-scrollbar-thumb { background: #ffffff0e; border-radius: 2px; }
  .d-val-tall { max-height: 280px; }

  .empty {
    flex: 1; display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    gap: 10px; color: var(--text-dimmer); font-family: var(--mono); font-size: 12px;
  }
  .empty-ico { font-size: 26px; opacity: .2; }

  /* Toast */
  .toast {
    position: fixed; bottom: 18px; right: 18px;
    font-family: var(--mono); font-size: 12px; padding: 8px 16px;
    background: var(--surface2); border: 1px solid var(--border-hi); border-radius: var(--r);
    color: var(--accent); box-shadow: 0 4px 18px #00000055;
    animation: tin .2s ease; z-index: 999;
  }
  @keyframes tin { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }

  /* Add Mock button (in detail footer) */
  .detail-foot { margin-top: 2px; }
  .btn-add-mock {
    align-self: flex-start; font-family: var(--mono); font-size: 11px; letter-spacing: .04em;
    padding: 7px 14px; border-radius: var(--r-sm); cursor: pointer;
    background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent-glow);
    transition: background .15s, border-color .15s;
  }
  .btn-add-mock:hover { background: #7fff6e30; border-color: var(--accent); }

  /* Add Mock modal */
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: #000000aa; backdrop-filter: blur(2px);
    display: flex; align-items: center; justify-content: center; padding: 20px;
    animation: tin .15s ease;
  }
  .modal {
    width: 100%; max-width: 560px; max-height: 90vh; display: flex; flex-direction: column;
    background: var(--surface); border: 1px solid var(--border-hi); border-radius: var(--r);
    box-shadow: 0 16px 50px #000000aa; overflow: hidden;
  }
  .modal-head {
    display: flex; align-items: center; gap: 10px;
    padding: 12px 16px; border-bottom: 1px solid var(--border);
  }
  .modal-title {
    font-family: var(--mono); font-size: 11px; letter-spacing: .15em;
    color: var(--accent); flex: 1;
  }
  .modal-close {
    background: transparent; border: none; color: var(--text-dimmer);
    cursor: pointer; font-size: 15px; line-height: 1; padding: 2px 4px; transition: color .15s;
  }
  .modal-close:hover { color: var(--text); }
  .modal-body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .modal-meta {
    display: flex; flex-direction: column; gap: 6px;
    font-family: var(--mono); font-size: 11px;
  }
  .modal-meta-row { display: flex; align-items: center; gap: 8px; }
  .modal-uri { color: var(--text-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .modal-dest {
    display: flex; gap: 8px; align-items: baseline;
    font-family: var(--mono); font-size: 11px; color: var(--text-dimmer);
  }
  .modal-dest b { color: var(--accent); font-weight: 400; word-break: break-all; }
  .modal-input {
    width: 100%; min-height: 220px; resize: vertical;
    font-family: var(--mono); font-size: 12px; line-height: 1.5;
    padding: 10px 12px; background: var(--bg); color: var(--text);
    border: 1px solid var(--border); border-radius: var(--r-sm);
    outline: none; transition: border-color .15s;
  }
  .modal-input:focus { border-color: var(--border-hi); }
  .modal-input.invalid { border-color: var(--red); }
  .modal-error {
    font-family: var(--mono); font-size: 11px; color: var(--red);
    background: var(--red-dim); border: 1px solid #ff5e5e30;
    border-radius: var(--r-sm); padding: 7px 10px; word-break: break-word;
  }
  .modal-actions {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 12px 16px; border-top: 1px solid var(--border);
  }
  .modal-btn {
    font-family: var(--mono); font-size: 11px; padding: 7px 14px;
    border-radius: var(--r-sm); cursor: pointer; transition: background .15s, border-color .15s;
  }
  .modal-btn-ghost {
    background: transparent; color: var(--text-dim); border: 1px solid var(--border-hi);
  }
  .modal-btn-ghost:hover { color: var(--text); border-color: #ffffff22; }
  .modal-btn-go {
    background: var(--accent-dim); color: var(--accent); border: 1px solid var(--accent-glow);
  }
  .modal-btn-go:hover { background: #7fff6e30; border-color: var(--accent); }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="logo"><div class="logo-dot"></div>MOCKLAB</div>
    <div class="conn-dot" :class="{ off: !connected }" :title="connected ? 'Live' : 'Reconnecting…'"></div>
    <div class="header-sep"></div>
    <a class="mocklab-link" href="${mocklabProtocol}://${mocklabHost}:${mocklabPort}" target="_blank">↗ mocklab :${mocklabPort}</a>
  </header>

  <main>
    <aside>
      <!-- Overlay -->
      <div class="sb-block">
        <div class="ov-label-row">
          <div class="sb-label">Overlay</div>
          <button class="btn-ov-filter" :class="{ on: showOverlayFilter }" @click="showOverlayFilter = !showOverlayFilter" title="Filter by name">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 2.5h10M3 6h6M5 9.5h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
        <div v-if="showOverlayFilter" class="ov-filter-wrap">
          <input class="ov-filter" v-model="overlayFilter" placeholder="Filter by name…" />
          <button v-if="overlayFilter" class="ov-filter-clear" @click="overlayFilter = ''" title="Clear filter">✕</button>
        </div>
        <select class="ov-select" v-model="selectedOverlay" @change="applyOverlay">
          <option value="">— none —</option>
          <option v-for="ov in filteredOverlays" :key="ov" :value="ov">{{ ov }}</option>
        </select>
        <div class="ov-active">
          <template v-if="currentOverlay">
            <span class="ov-name" :title="currentOverlay">◈ {{ currentOverlay }}</span>
            <button class="btn btn-red" @click.stop="clearOverlay">✕ clear</button>
          </template>
          <span v-else class="ov-none">no active overlay</span>
        </div>
      </div>

      <!-- Stats -->
      <div class="sb-block">
        <div class="sb-label">Stats</div>
        <div class="stats-grid">
          <div class="stat"><div class="stat-n c-w">{{ history.length }}</div><div class="stat-l">TOTAL</div></div>
          <div class="stat"><div class="stat-n c-r">{{ errorCount }}</div><div class="stat-l">ERRORS</div></div>
          <div class="stat"><div class="stat-n c-g">{{ successCount }}</div><div class="stat-l">SUCCESS</div></div>
          <div class="stat"><div class="stat-n c-a">{{ uniquePaths }}</div><div class="stat-l">UNIQUE</div></div>
        </div>
      </div>
    </aside>

    <!-- Request log -->
    <div class="log-pane">
      <div class="log-bar">
        <span class="bar-title">REQUESTS</span>
        <div class="fbtns">
          <button v-for="m in ['ALL','GET','POST','PUT','DELETE','PATCH']" :key="m"
            class="fbtn" :class="{ on: methodFilter === m }" @click="methodFilter = m">{{ m }}</button>
        </div>
        <input class="search" v-model="search" placeholder="filter path…" />
        <button class="btn-refresh" :class="{ spin: refreshing }" @click="refresh" title="Refresh list">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M10.5 6A4.5 4.5 0 1 1 6 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M10.5 1.5v4.5H6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          REFRESH
        </button>
        <button class="btn-refresh btn-clear" @click="clearHistory" title="Clear request history">
          CLEAR
        </button>
      </div>

      <div class="log-list">
        <template v-if="filteredHistory.length > 0">
          <div v-for="entry in filteredHistory" :key="entry.id"
            class="entry" :class="{ 'is-err': entry.status >= 400, open: openId === entry.id }"
            @click="openId = openId === entry.id ? null : entry.id">

            <div class="entry-row">
              <span class="badge" :class="'b-' + entry.method">{{ entry.method }}</span>
              <span class="status" :class="entry.status >= 400 ? 'err' : 'ok'">{{ entry.status }}</span>
              <span class="uri" :title="entry.uri">{{ entry.uri }}</span>
              <span v-if="entry.status >= 400" class="tag-err">{{ entry.status }}</span>
            </div>

            <div v-if="openId === entry.id" class="detail">
              <div class="d-row">
                <span class="d-label">FILE PATH</span>
                <div class="d-val">{{ entry.filePath || '—' }}</div>
              </div>
              <div class="d-row" v-if="hasContent(entry.body)">
                <span class="d-label">BODY</span>
                <div class="d-val">{{ fmt(entry.body) }}</div>
              </div>
              <div class="d-row" v-if="hasContent(entry.query)">
                <span class="d-label">QUERY PARAMS</span>
                <div class="d-val">{{ fmt(entry.query) }}</div>
              </div>
              <div class="d-row" v-if="hasContent(entry.headers)">
                <span class="d-label">REQUEST HEADERS</span>
                <div class="d-val">{{ fmt(entry.headers) }}</div>
              </div>
              <div class="d-row" v-if="hasContent(entry.responseHeaders)">
                <span class="d-label">RESPONSE HEADERS</span>
                <div class="d-val">{{ fmt(entry.responseHeaders) }}</div>
              </div>
              <div class="d-row" v-if="hasContent(entry.responseBody)">
                <span class="d-label">RESPONSE BODY</span>
                <div class="d-val d-val-tall">{{ fmt(entry.responseBody) }}</div>
              </div>
              <div class="d-row detail-foot" v-if="!entry.filePath && !entry.mockExists">
                <button class="btn-add-mock" @click.stop="openAddMock(entry)">+ Add Mock</button>
              </div>
            </div>
          </div>
        </template>
        <div v-else class="empty">
          <div class="empty-ico">⬡</div>
          <span>no requests yet</span>
        </div>
      </div>
    </div>
  </main>

  <!-- Add Mock modal -->
  <div v-if="showAddMock" class="modal-backdrop" @click.self="closeAddMock">
    <div class="modal">
      <div class="modal-head">
        <span class="modal-title">ADD MOCK</span>
        <button class="modal-close" @click="closeAddMock" title="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="modal-meta">
          <div class="modal-meta-row">
            <span class="badge" :class="'b-' + addMockMethod">{{ addMockMethod }}</span>
            <span class="modal-uri" :title="addMockUri">{{ addMockUri }}</span>
          </div>
          <div class="modal-dest">→ <b>{{ addMockTarget }}</b></div>
        </div>
        <textarea
          class="modal-input"
          :class="{ invalid: addMockError }"
          v-model="addMockJson"
          spellcheck="false"
          placeholder='{\n  "message": "hello"\n}'></textarea>
        <div v-if="addMockError" class="modal-error">{{ addMockError }}</div>
      </div>
      <div class="modal-actions">
        <button class="modal-btn modal-btn-ghost" @click="closeAddMock">Cancel</button>
        <button class="modal-btn modal-btn-go" @click="submitAddMock">Save Mock</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast">{{ toast }}</div>
</div>

<script>
const { createApp, ref, computed, onMounted, onUnmounted } = Vue;
createApp({
  setup() {
    const history = ref([]);
    const overlays = ref([]);
    const currentOverlay = ref(null);
    const selectedOverlay = ref('');
    const methodFilter = ref('ALL');
    const search = ref('');
    const overlayFilter = ref('');
    const showOverlayFilter = ref(false);
    const connected = ref(false);
    const refreshing = ref(false);
    const openId = ref(null);
    const toast = ref('');
    const showAddMock = ref(false);
    const addMockEntry = ref(null);
    const addMockJson = ref('');
    const addMockError = ref('');
    let toastTimer = null;
    let es = null;

    const showToast = msg => {
      toast.value = msg;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.value = '', 2400);
    };

    const fmt = val => {
      if (!val) return '—';
      try { return JSON.stringify(val, null, 2); } catch { return String(val); }
    };

    const hasContent = val => val && (typeof val === 'object' ? Object.keys(val).length > 0 : !!val);

    // SSE connection — server pushes globals on every change
    const connect = () => {
      es = new EventSource('/stream');
      es.onopen = () => connected.value = true;
      es.onmessage = e => {
        const d = JSON.parse(e.data);
        history.value   = d.history;
        currentOverlay.value = d.overlay;
        overlays.value  = d.overlays;
        selectedOverlay.value = d.overlay || '';
      };
      es.onerror = () => {
        connected.value = false;
        es.close();
        setTimeout(connect, 2000);
      };
    };

    const applyOverlay = () => {
      const val = selectedOverlay.value || null;
      fetch('/set-overlay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay: val })
      });
      showToast(val ? 'Overlay → ' + val : 'Overlay cleared');
    };

    const clearOverlay = () => { selectedOverlay.value = ''; applyOverlay(); };

    const clearHistory = () => {
      fetch('/clear-history', { method: 'POST' });
    };

    // Mirror of the server's path resolution — preview where the mock will land
    const computeTargetPath = (uri, method) => {
      if (!uri) return '';
      method = (method || 'GET').toUpperCase();
      const qIndex = uri.indexOf('?');
      const rawPath = qIndex >= 0 ? uri.slice(0, qIndex) : uri;
      const queryString = qIndex >= 0 ? uri.slice(qIndex + 1) : '';
      let requestPath = (rawPath === '/' || rawPath === '') ? '/index' : rawPath;
      if (!requestPath.startsWith('/')) requestPath = '/' + requestPath;
      const extMatch = requestPath.match(/\.([a-z0-9]+)$/i);
      const ext = extMatch ? extMatch[1] : 'json';
      const pathWithoutExt = requestPath.replace(/\.[a-z0-9]+$/i, '');
      const methodSuffix = method !== 'GET' ? '-method-' + method.toLowerCase() : '';
      let firstParam = null;
      if (queryString) {
        const pairs = queryString.split('&').filter(Boolean);
        if (pairs.length) {
          const eq = pairs[0].indexOf('=');
          firstParam = eq >= 0
            ? { name: pairs[0].slice(0, eq), value: pairs[0].slice(eq + 1) }
            : { name: pairs[0], value: '' };
        }
      }
      let rel;
      if (firstParam && firstParam.name) {
        const fn = firstParam.value !== ''
          ? '[' + firstParam.name + '=' + firstParam.value + ']'
          : '[' + firstParam.name + ']';
        rel = pathWithoutExt + '/' + fn + methodSuffix + '.' + ext;
      } else {
        rel = pathWithoutExt + methodSuffix + '.' + ext;
      }
      return 'mocks' + rel;
    };

    const addMockUri    = computed(() => addMockEntry.value ? addMockEntry.value.uri : '');
    const addMockMethod = computed(() => addMockEntry.value ? addMockEntry.value.method : 'GET');
    const addMockTarget = computed(() =>
      addMockEntry.value ? computeTargetPath(addMockEntry.value.uri, addMockEntry.value.method) : ''
    );

    const openAddMock = entry => {
      addMockEntry.value = entry;
      addMockError.value = '';
      // Seed with the existing response body if it's JSON, otherwise an empty object
      const seed = entry && entry.responseBody && typeof entry.responseBody === 'object' && entry.status < 400
        ? entry.responseBody
        : {};
      addMockJson.value = JSON.stringify(seed, null, 2);
      showAddMock.value = true;
    };

    const closeAddMock = () => {
      showAddMock.value = false;
      addMockEntry.value = null;
      addMockError.value = '';
    };

    const submitAddMock = async () => {
      // Validate JSON client-side first
      try {
        JSON.parse(addMockJson.value);
      } catch (e) {
        addMockError.value = 'Invalid JSON: ' + e.message;
        return;
      }
      try {
        const resp = await fetch('/add-mock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uri: addMockEntry.value.uri,
            method: addMockEntry.value.method,
            content: addMockJson.value
          })
        });
        const data = await resp.json();
        if (!resp.ok || !data.ok) {
          addMockError.value = data.error || 'Failed to save mock';
          return;
        }
        showToast('Mock saved → ' + data.path);
        closeAddMock();
      } catch (e) {
        addMockError.value = 'Request failed: ' + e.message;
      }
    };

    // Refresh = collapse open row + re-render list (data is always live via SSE)
    const refresh = () => {
      refreshing.value = true;
      openId.value = null;
      history.value = [...history.value];
      setTimeout(() => refreshing.value = false, 500);
    };

    const filteredOverlays = computed(() => {
      const q = overlayFilter.value.trim().toLowerCase();
      if (!q) return overlays.value;
      return overlays.value.filter(ov => ov.toLowerCase().includes(q));
    });

    const filteredHistory = computed(() => {
      let h = history.value;
      if (methodFilter.value !== 'ALL') h = h.filter(e => e.method === methodFilter.value);
      if (search.value.trim()) {
        const q = search.value.trim().toLowerCase();
        h = h.filter(e => e.uri.toLowerCase().includes(q));
      }
      return h;
    });

    const errorCount   = computed(() => history.value.filter(e => e.error).length);
    const successCount = computed(() => history.value.filter(e => !e.error).length);
    const uniquePaths  = computed(() => new Set(history.value.map(e => e.uri.split('?')[0])).size);

    onMounted(connect);
    onUnmounted(() => es && es.close());

    return {
      history, overlays, currentOverlay, selectedOverlay,
      methodFilter, search, overlayFilter, showOverlayFilter, connected, refreshing, openId, toast,
      filteredHistory, filteredOverlays, errorCount, successCount, uniquePaths,
      applyOverlay, clearOverlay, refresh, clearHistory, fmt, hasContent,
      showAddMock, addMockJson, addMockError, addMockUri, addMockMethod, addMockTarget,
      openAddMock, closeAddMock, submitAddMock
    };
  }
}).mount('#app');
<\/script>
</body>
</html>`;
  }

  start() {
    this.patchGlobals();

    const httpsOptions = this.mocklab.httpsOptions;
    const protocol = httpsOptions ? 'https' : 'http';
    const server = httpsOptions
      ? https.createServer(httpsOptions, this.app)
      : http.createServer(this.app);

    server.listen(this.port, this.host, () => {
      const c = { reset: '\x1b[0m', cyan: '\x1b[36m' };
      console.log('Control panel running at ' + c.cyan + protocol + '://' + this.host + ':' + this.port + c.reset);
    });
  }
}

module.exports = ControlPanel;
