#!/usr/bin/env node

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { loadConfig, parseCliArgs, getHttpsOptions } = require('./app/config');
const MockStore = require('./app/mock');
const { fileName } = require('./app/fileName');
const { parseUrl } = require('./app/urlParser');
const { getMimeType, isBinaryType } = require('./app/fileTypeHelpers');

const colors = {
  reset: '\x1b[0m',
  white: '\x1b[37m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgWhite: '\x1b[47m',
  black: '\x1b[30m'
};

class MocklabServer {
  constructor(options = {}) {
    this.app = express();
    this.cliConfig = options.cliConfig || parseCliArgs(process.argv.slice(2));
    this.config = { ...loadConfig(process.cwd()), ...this.cliConfig };
    this.httpsOptions = getHttpsOptions(this.config, process.cwd());
    this.protocol = this.httpsOptions ? 'https' : 'http';
    this.mockDir = options.mockDir || path.join(process.cwd(), 'mocks');
    this.overlayBaseDir = options.overlayBaseDir || path.join(process.cwd(), 'overlays');
    this.store = new MockStore({
      mockDir: this.mockDir,
      overlayBaseDir: this.overlayBaseDir
    });

    if (!global.mocklabOverlay) global.mocklabOverlay = null;
    if (!global.mocklabRequestHistory) global.mocklabRequestHistory = [];
    if (!global.mocklabSequenceState) global.mocklabSequenceState = {};

    this.setupOverlay();
  }

  setupOverlay() {
    const overlay = this.config.overlay;
    if (!overlay) return;
    if (!this.store.overlayExists(overlay)) {
      this.overlayNotFound = true;
      delete this.config.overlay;
      return;
    }
    const source = this.cliConfig.overlay ? 'command line' : 'config';
    global.mocklabOverlay = overlay;
    this.resetSequenceStateForOverlay(overlay);
    console.log(`Overlay from ${source}: ${colors.cyan}${overlay}${colors.reset}`);
  }

  resetSequenceStateForOverlay(overlayName) {
    this.store.resetSequenceState(overlayName);
  }

  overlayExists(overlayName) {
    return this.store.overlayExists(overlayName);
  }

  getSearchDirectories() {
    return this.store.getSearchDirectories(global.mocklabOverlay);
  }

  findMockFile(requestPath, queryParams, method, extension) {
    this.store.mockDir = this.mockDir;
    this.store.overlayBaseDir = this.overlayBaseDir;
    return this.store.find(requestPath, queryParams, method, extension);
  }

  shouldSkipDisplay(requestPath) {
    const skipList = this.config.skipDisplayFor;
    return Array.isArray(skipList) && skipList.includes(requestPath);
  }

  parseFileMetadata(filePath) {
    const baseName = path.basename(filePath);
    const parsed = fileName(baseName);
    let delay = Number.isFinite(parsed.delay) ? parsed.delay : 0;
    let status = Number.isFinite(parsed.status) ? parsed.status : 200;
    if (delay > 600000) {
      console.warn('Delay ' + delay + 'ms exceeds maximum of 10 minutes. Using 600000ms instead.');
      delay = 600000;
    }
    if (status < 100 || status > 599) {
      console.warn('Invalid status code ' + status + '. Using 200 instead.');
      status = 200;
    }
    return { delay, status };
  }

  prepareResponseData(filePath, mimeType, extension) {
    let body = null;
    try {
      if (isBinaryType(extension)) {
        body = '[binary content]';
      } else if (extension === 'json') {
        body = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } else {
        body = fs.readFileSync(filePath, 'utf8');
      }
    } catch (err) {
      body = null;
    }
    return { headers: { 'content-type': mimeType }, body };
  }

  logRequest(uri, method, filePath, error, status, body, query, headers, responseHeaders, responseBody) {
    if (this.shouldSkipDisplay(uri.split('?')[0])) return;

    let relativeFilePath = '';
    if (filePath) {
      if (filePath.startsWith(this.overlayBaseDir)) {
        relativeFilePath = filePath.replace(this.overlayBaseDir, '/overlays');
      } else if (filePath.startsWith(this.mockDir)) {
        relativeFilePath = filePath.replace(this.mockDir, '/mocks');
      } else {
        relativeFilePath = filePath.replace(process.cwd(), '');
      }
    }

    const statusColored = (status >= 400 ? colors.red : colors.white) + status + colors.reset;
    const methodColored = colors.bgWhite + colors.black + ' ' + method + ' ' + colors.reset;
    const filePathColored = relativeFilePath ? colors.cyan + relativeFilePath + colors.reset : '';
    console.log([methodColored, statusColored, uri, filePathColored].filter(Boolean).join(' '));

    const ignoredHeaders = ['host', 'connection', 'accept-encoding', 'user-agent'];
    const filteredHeaders = headers
      ? Object.fromEntries(Object.entries(headers).filter(([key]) => !ignoredHeaders.includes(key.toLowerCase())))
      : null;

    global.mocklabRequestHistory.unshift({
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      uri,
      method,
      filePath: relativeFilePath || null,
      status,
      error,
      body: body && Object.keys(body).length > 0 ? body : null,
      query: query && Object.keys(query).length > 0 ? query : null,
      headers: filteredHeaders && Object.keys(filteredHeaders).length > 0 ? filteredHeaders : null,
      responseHeaders: responseHeaders && Object.keys(responseHeaders).length > 0 ? responseHeaders : null,
      responseBody: responseBody !== undefined && responseBody !== null ? responseBody : null
    });

    const limit = this.config.historyLimit || 100;
    if (global.mocklabRequestHistory.length > limit) {
      global.mocklabRequestHistory = global.mocklabRequestHistory.slice(0, limit);
    }
  }

  handleRequest(req, res, method) {
    const parsed = parseUrl(req);
    const mimeType = getMimeType(parsed.extension);
    const filePath = this.findMockFile(parsed.pathWithoutExtension, req.query, method, parsed.extension);

    if (!filePath) {
      const notFoundBody = { error: 'Mock file not found', path: parsed.requestPath, query: req.query, method };
      this.logRequest(parsed.uri, method, null, true, 404, req.body, req.query, req.headers,
        { 'content-type': 'application/json' }, notFoundBody);
      return res.status(404).json(notFoundBody);
    }

    const metadata = this.parseFileMetadata(filePath);
    const response = this.prepareResponseData(filePath, mimeType, parsed.extension);
    this.logRequest(parsed.uri, method, filePath, false, metadata.status, req.body, req.query, req.headers,
      response.headers, response.body);

    setTimeout(() => {
      try {
        if (isBinaryType(parsed.extension)) {
          return res.status(metadata.status).type(mimeType).send(fs.readFileSync(filePath));
        }
        if (parsed.extension === 'json') {
          return res.status(metadata.status).type(mimeType).send(JSON.parse(fs.readFileSync(filePath, 'utf8')));
        }
        return res.status(metadata.status).type(mimeType).send(fs.readFileSync(filePath, 'utf8'));
      } catch (err) {
        res.status(500).json({ error: 'Error reading mock file', message: err.message });
      }
    }, metadata.delay);
  }

  setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
    for (const httpMethod of ['get', 'post', 'put', 'delete', 'patch']) {
      this.app[httpMethod]('*', (req, res) => this.handleRequest(req, res, httpMethod.toUpperCase()));
    }
  }

  start() {
    this.setupRoutes();
    const server = this.httpsOptions
      ? https.createServer(this.httpsOptions, this.app)
      : http.createServer(this.app);
    server.listen(this.config.port, this.config.host, () => {
      const url = `${colors.cyan}${this.protocol}://${this.config.host}:${this.config.port}${colors.reset}`;
      console.log(`Mock server running at ${url}`);
      console.log(`Serving mocks from: ${colors.cyan}${this.mockDir}${colors.reset}`);
    });
    return server;
  }
}

module.exports = MocklabServer;