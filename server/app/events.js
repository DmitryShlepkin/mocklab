const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { extractExtension, removeExtension } = require('./fileTypeHelpers');

class Events {
  constructor(mocklabInstance) {
    this.app = express();
    this.mocklab = mocklabInstance;
    this.port = (parseInt(mocklabInstance.config.port, 10) || 3232) + 1;
    this.host = mocklabInstance.config.host || 'localhost';
    this.eventClients = [];
    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(express.json());
    this.app.use((err, req, res, next) => {
      if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ ok: false, error: 'Request body must be valid JSON' });
      }
      return next(err);
    });
    this.app.use(express.static(path.join(__dirname, '../../ui')));
  }

  getAvailableOverlays() {
    const overlaysDir = this.mocklab.overlayBaseDir;
    try {
      if (!fs.existsSync(overlaysDir)) return [];
      return fs.readdirSync(overlaysDir).filter(entry =>
        fs.statSync(path.join(overlaysDir, entry)).isDirectory()
      );
    } catch (err) {
      return [];
    }
  }

  computeMockFilePath(uri, method) {
    method = (method || 'GET').toString().toUpperCase();
    const queryIndex = uri.indexOf('?');
    const rawPath = queryIndex >= 0 ? uri.slice(0, queryIndex) : uri;
    const queryString = queryIndex >= 0 ? uri.slice(queryIndex + 1) : '';
    let requestPath = rawPath === '/' || rawPath === '' ? '/index' : rawPath;
    if (!requestPath.startsWith('/')) requestPath = '/' + requestPath;

    const extension = extractExtension(requestPath) || 'json';
    const pathWithoutExtension = removeExtension(requestPath);
    const methodSuffix = method !== 'GET' ? '-method-' + method.toLowerCase() : '';
    const firstPair = queryString.split('&').filter(Boolean)[0];
    if (firstPair) {
      const equals = firstPair.indexOf('=');
      const name = equals >= 0 ? firstPair.slice(0, equals) : firstPair;
      const value = equals >= 0 ? firstPair.slice(equals + 1) : '';
      if (name) {
        const paramFile = value ? `[${name}=${value}]` : `[${name}]`;
        return path.join(pathWithoutExtension, paramFile + methodSuffix + '.' + extension)
          .replace(/^[/\\]+/, '');
      }
    }
    return (pathWithoutExtension + methodSuffix + '.' + extension).replace(/^[/\\]+/, '');
  }

  mockFileExists(uri, method) {
    try {
      const relativePath = this.computeMockFilePath(uri, method);
      const root = path.resolve(this.mocklab.mockDir);
      const target = path.resolve(root, relativePath);
      if (target !== root && !target.startsWith(root + path.sep)) return false;
      return fs.existsSync(target);
    } catch (err) {
      return false;
    }
  }

  serializeHistory() {
    return (global.mocklabRequestHistory || []).map(entry =>
      entry.filePath ? entry : { ...entry, mockExists: this.mockFileExists(entry.uri, entry.method) }
    );
  }

  statePayload() {
    return {
      history: this.serializeHistory(),
      overlay: global.mocklabOverlay || null,
      overlays: this.getAvailableOverlays()
    };
  }

  sendEvent(client, message) {
    client.write('data: ' + JSON.stringify(message) + '\n\n');
  }

  broadcast() {
    const message = { type: 'state', ...this.statePayload() };
    for (const client of this.eventClients) {
      try {
        this.sendEvent(client, message);
      } catch (err) {
        // A disconnected client will be removed when its request closes.
      }
    }
  }

  broadcastReload() {
    for (const client of this.eventClients) {
      try {
        this.sendEvent(client, { type: 'reload' });
      } catch (err) {
        // A disconnected client will be removed when its request closes.
      }
    }
  }

  patchGlobals() {
    const makeProxy = array => new Proxy(array, {
      set: (target, property, value) => {
        target[property] = value;
        if (property === 'length' || !Number.isNaN(Number(property))) this.broadcast();
        return true;
      }
    });

    let overlay = global.mocklabOverlay;
    Object.defineProperty(global, 'mocklabOverlay', {
      get: () => overlay,
      set: value => {
        overlay = value;
        this.broadcast();
      },
      configurable: true
    });

    let history = makeProxy(global.mocklabRequestHistory || []);
    Object.defineProperty(global, 'mocklabRequestHistory', {
      get: () => history,
      set: value => {
        history = makeProxy(Array.isArray(value) ? value : []);
        this.broadcast();
      },
      configurable: true
    });
  }

  setupRoutes() {
    this.app.get('/__events', (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();
      this.eventClients.push(res);
      this.sendEvent(res, { type: 'snapshot', ...this.statePayload() });
      req.on('close', () => {
        const index = this.eventClients.indexOf(res);
        if (index >= 0) this.eventClients.splice(index, 1);
      });
    });

    this.app.post('/__events', (req, res) => {
      const message = req.body;
      if (!message || typeof message.type !== 'string') {
        return res.status(400).json({ ok: false, error: 'Message type is required' });
      }

      if (message.type === 'set-overlay') {
        if (message.overlay !== null && message.overlay !== undefined && typeof message.overlay !== 'string') {
          return res.status(400).json({ ok: false, error: 'Overlay must be a string or null' });
        }
        global.mocklabOverlay = message.overlay && message.overlay.trim() ? message.overlay.trim() : null;
        if (global.mocklabOverlay) {
          this.mocklab.resetSequenceStateForOverlay(global.mocklabOverlay);
        }
        return res.json({ ok: true });
      }

      if (message.type === 'clear-history') {
        global.mocklabRequestHistory = [];
        return res.json({ ok: true });
      }

      if (message.type === 'add-mock') {
        return this.addMock(message, res);
      }

      return res.status(400).json({ ok: false, error: 'Unknown message type: ' + message.type });
    });

    this.app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../../ui/index.html'));
    });
  }

  addMock(message, res) {
    const { uri, method, content } = message;
    if (!uri || typeof uri !== 'string') {
      return res.status(400).json({ ok: false, error: 'Missing request URI' });
    }
    if (content === undefined) {
      return res.status(400).json({ ok: false, error: 'Missing mock content' });
    }

    const mockRoot = path.resolve(this.mocklab.mockDir);
    const target = path.resolve(mockRoot, this.computeMockFilePath(uri, method));
    if (target !== mockRoot && !target.startsWith(mockRoot + path.sep)) {
      return res.status(400).json({ ok: false, error: 'Resolved path is outside the mocks folder' });
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(content, null, 2) + '\n');
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'Failed to write file: ' + err.message });
    }

    const displayPath = path.relative(process.cwd(), target);
    console.log('Mock created: ' + displayPath);
    this.broadcast();
    return res.json({ ok: true, path: displayPath });
  }

  start() {
    this.patchGlobals();
    const httpsOptions = this.mocklab.httpsOptions;
    const server = httpsOptions
      ? https.createServer(httpsOptions, this.app)
      : http.createServer(this.app);
    server.listen(this.port, this.host, () => {
      const protocol = httpsOptions ? 'https' : 'http';
      console.log(`Control panel and events endpoint running at ${protocol}://${this.host}:${this.port}`);
    });
    return server;
  }
}

module.exports = Events;
