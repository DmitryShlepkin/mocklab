const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { patterns, buildExactFilePattern, buildPatternWithExtension } = require('./patterns');
const { getMimeType, isBinaryType, extractExtension, removeExtension } = require('./mime');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  white: '\x1b[37m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  bgWhite: '\x1b[47m',
  black: '\x1b[30m'
};

class Mocklab {
  constructor() {
    this.app = express();
    this.cliConfig = this.parseCliArgs();
    this.config = { ...this.loadConfig(), ...this.cliConfig };
    this.httpsOptions = this.getHttpsOptions();
    this.protocol = this.httpsOptions ? 'https' : 'http';
    this.mockDir = path.join(process.cwd(), 'mocks');
    this.overlayBaseDir = path.join(process.cwd(), 'overlays');

    // Initialize global variables if not already set
    if (!global.mocklabOverlay) {
      global.mocklabOverlay = null;
    }
    if (!global.mocklabRequestHistory) {
      global.mocklabRequestHistory = [];
    }
    if (!global.mocklabSequenceState) {
      global.mocklabSequenceState = {};
    }

    this.setupOverlay();
  }

  loadConfig() {
    const configPath = path.join(process.cwd(), 'mock.conf');
    const defaultConfig = {
      host: 'localhost',
      port: 3232,
      historyLimit: 100,
      controlPanel: true,
      skipDisplayFor: []
    };

    try {
      if (fs.existsSync(configPath)) {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const config = JSON.parse(configContent);
        return { ...defaultConfig, ...config };
      }
    } catch (err) {
      console.log('Using default configuration');
    }

    return defaultConfig;
  }

  // Parse supported --key=value command line arguments.
  // Returned values take priority over mock.conf entries.
  parseCliArgs() {
    const supported = ['host', 'port', 'overlay', 'historyLimit', 'controlPanel'];
    const cliConfig = {};
    const args = process.argv.slice(2);

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const separatorIndex = arg.indexOf('=');
      if (!arg.startsWith('--') || separatorIndex === -1) {
        continue;
      }

      const key = arg.substring(2, separatorIndex);
      const value = arg.substring(separatorIndex + 1);
      if (supported.indexOf(key) === -1) {
        continue;
      }

      if (key === 'port' || key === 'historyLimit') {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed)) {
          console.warn('Ignoring invalid value for --' + key + ': ' + value);
          continue;
        }
        cliConfig[key] = parsed;
      } else if (key === 'controlPanel') {
        cliConfig[key] = value !== 'false';
      } else {
        cliConfig[key] = value;
      }
    }

    return cliConfig;
  }

  // Read TLS key/cert from config when HTTPS is enabled.
  // Config shape: "https": { "key": "./key.pem", "cert": "./cert.pem" }
  // Returns null (plain HTTP) when not configured or on failure.
  getHttpsOptions() {
    const cfg = this.config.https;
    if (!cfg) {
      return null;
    }

    if (!cfg.key || !cfg.cert) {
      console.warn('HTTPS is enabled but "key" and/or "cert" path is missing. Falling back to HTTP.');
      return null;
    }

    try {
      return {
        key: fs.readFileSync(path.resolve(process.cwd(), cfg.key)),
        cert: fs.readFileSync(path.resolve(process.cwd(), cfg.cert))
      };
    } catch (err) {
      console.warn('Failed to read HTTPS key/cert: ' + err.message + '. Falling back to HTTP.');
      return null;
    }
  }

  setupOverlay() {
    const overlay = this.config.overlay;
    if (!overlay) {
      return;
    }

    if (!this.overlayExists(overlay)) {
      this.overlayNotFound = true;
      delete this.config.overlay;
      return;
    }

    const source = this.cliConfig.overlay ? 'command line' : 'config';
    global.mocklabOverlay = overlay;
    this.resetSequenceStateForOverlay(overlay);
    console.log('Overlay from ' + source + ': ' + colors.cyan + overlay + colors.reset);
  }

  overlayExists(overlayName) {
    if (!overlayName) {
      return false;
    }
    return fs.existsSync(path.join(this.overlayBaseDir, overlayName));
  }

  // Applying an overlay always starts its sequences from the first file,
  // regardless of where a previous activation left off.
  resetSequenceStateForOverlay(overlayName) {
    if (!overlayName) {
      return;
    }

    const overlayDir = path.join(this.overlayBaseDir, overlayName);
    const prefix = overlayDir + path.sep;
    const state = global.mocklabSequenceState;

    Object.keys(state).forEach(function(key) {
      const keyDir = key.split('|')[0];
      if (keyDir === overlayDir || keyDir.startsWith(prefix)) {
        delete state[key];
      }
    });
  }

  getSearchDirectories(requestPath) {
    const directories = [];

    if (global.mocklabOverlay) {
      const overlayDir = path.join(this.overlayBaseDir, global.mocklabOverlay);
      directories.push(overlayDir);
    }

    directories.push(this.mockDir);

    return directories;
  }

  escapeRegex(str) {
    const specialChars = patterns.regexSpecialChars;
    const escaped = str.replace(specialChars, '\\$&');
    return escaped;
  }

  // Picks a file from a set of candidates that all match the same route.
  // Candidates tagged with a sequence number rotate round-robin (tracked per
  // stateKey in global.mocklabSequenceState); the first plain candidate wins otherwise.
  resolveSequencedMatch(candidates, stateKey) {
    if (candidates.length === 0) {
      return null;
    }

    const sequenced = candidates.filter(c => c.sequence !== null);
    if (sequenced.length === 0) {
      return candidates[0].file;
    }

    sequenced.sort((a, b) => a.sequence - b.sequence);
    const state = global.mocklabSequenceState;
    const index = (state[stateKey] || 0) % sequenced.length;
    state[stateKey] = index + 1;
    return sequenced[index].file;
  }

  prepareResponseData(filePath, mimeType, extension) {
    const headers = { 'content-type': mimeType };
    let body = null;
    try {
      if (isBinaryType(extension)) {
        body = '[binary content]';
      } else if (extension === 'json') {
        const content = fs.readFileSync(filePath, 'utf8');
        body = JSON.parse(content);
      } else {
        body = fs.readFileSync(filePath, 'utf8');
      }
    } catch (err) {
      body = null;
    }
    return { headers, body };
  }

  shouldSkipDisplay(requestPath) {
    const skipList = this.config.skipDisplayFor;
    return Array.isArray(skipList) && skipList.includes(requestPath);
  }

  logRequest(uri, method, filePath, error, status, body, query, headers, responseHeaders, responseBody) {
    if (this.shouldSkipDisplay(uri.split('?')[0])) {
      return;
    }

    let relativeFilePath = '';

    if (filePath) {
      const projectRoot = process.cwd();
      if (filePath.startsWith(this.overlayBaseDir)) {
        relativeFilePath = filePath.replace(this.overlayBaseDir, '/overlays');
      } else if (filePath.startsWith(this.mockDir)) {
        relativeFilePath = filePath.replace(this.mockDir, '/mocks');
      } else {
        relativeFilePath = filePath.replace(projectRoot, '');
      }
    }

    // Prepare colored output parts
    const methodColored = colors.bgWhite + colors.black + ' ' + method + ' ' + colors.reset;
    const statusColor = (status >= 400) ? colors.red : colors.white;
    const statusColored = statusColor + status + colors.reset;
    const filePathColored = relativeFilePath ? colors.cyan + relativeFilePath + colors.reset : '';

    const parts = [methodColored, statusColored, uri];
    if (filePathColored) {
      parts.push(filePathColored);
    }

    console.log(parts.join(' '));

    // Filter out noisy/internal headers
    const ignoredHeaders = ['host', 'connection', 'accept-encoding', 'user-agent'];
    const filteredHeaders = headers
      ? Object.fromEntries(
          Object.entries(headers).filter(([k]) => !ignoredHeaders.includes(k.toLowerCase()))
        )
      : null;

    const requestEntry = {
      id: Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      uri: uri,
      method: method,
      filePath: relativeFilePath || null,
      status: status,
      error: error,
      body: (body && Object.keys(body).length > 0) ? body : null,
      query: (query && Object.keys(query).length > 0) ? query : null,
      headers: (filteredHeaders && Object.keys(filteredHeaders).length > 0) ? filteredHeaders : null,
      responseHeaders: (responseHeaders && Object.keys(responseHeaders).length > 0) ? responseHeaders : null,
      responseBody: (responseBody !== undefined && responseBody !== null) ? responseBody : null
    };

    global.mocklabRequestHistory.unshift(requestEntry);

    const limit = this.config.historyLimit || 100;
    if (global.mocklabRequestHistory.length > limit) {
      global.mocklabRequestHistory = global.mocklabRequestHistory.slice(0, limit);
    }
  }

  findMockFile(requestPath, queryParams, method, extension) {
    const searchDirs = this.getSearchDirectories(requestPath);

    for (let i = 0; i < searchDirs.length; i++) {
      const searchBase = searchDirs[i];
      const filePath = this.findMockFileInDirectory(searchBase, requestPath, queryParams, method, extension);
      if (filePath) {
        return filePath;
      }
    }

    return null;
  }

  findMockFileInDirectory(baseRoot, requestPath, queryParams, method, extension) {
    // Priority 1 & 2: Check for query parameter matches
    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryFile = this.findQueryParamFile(baseRoot, requestPath, queryParams, method, extension);
      if (queryFile) {
        return queryFile;
      }
    }

    // Priority 3 & 4: Check for index files
    const indexFile = this.findIndexFile(baseRoot, requestPath, method, extension);
    if (indexFile) {
      return indexFile;
    }

    // Priority 5: Check for exact file match
    const exactFile = this.findExactFile(baseRoot, requestPath, method, extension);
    if (exactFile) {
      return exactFile;
    }

    // Priority 6: Check for wildcard file (only for JSON or when no extension specified)
    if (!extension || extension === 'json') {
      const wildcardFile = this.findWildcardFile(baseRoot, requestPath, method, extension);
      if (wildcardFile) {
        return wildcardFile;
      }
    }

    return null;
  }

  findQueryParamFile(baseRoot, requestPath, queryParams, method, extension) {
    const queryDir = path.join(baseRoot, requestPath);
    const ext = extension || 'json';

    try {
      if (!fs.existsSync(queryDir)) {
        return null;
      }

      const files = fs.readdirSync(queryDir);
      const exactParamPattern = buildPatternWithExtension(patterns.exactParamValue, ext);
      const queryParamPattern = buildPatternWithExtension(patterns.queryParam, ext);

      // Priority 1: Check for exact param value match [paramName=value].ext
      // First pass mirrors the old .find() to pick which paramName=value wins,
      // second pass gathers every file sharing that same paramName=value so a
      // sequence set (e.g. [id=1]-sequence-1.json, [id=1]-sequence-2.json) rotates as a group.
      const exactParamWinner = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }
        const matchResult = file.match(exactParamPattern);
        if (!matchResult) {
          return false;
        }
        const fileMethod = matchResult[4] ? matchResult[4].toUpperCase() : 'GET';
        return queryParams.hasOwnProperty(matchResult[1]) &&
               String(queryParams[matchResult[1]]) === matchResult[2] &&
               fileMethod === method;
      });

      if (exactParamWinner) {
        const winnerMatch = exactParamWinner.match(exactParamPattern);
        const paramName = winnerMatch[1];
        const paramValue = winnerMatch[2];

        const exactParamCandidates = files.reduce(function(acc, file) {
          if (file.startsWith('_')) {
            return acc;
          }
          const matchResult = file.match(exactParamPattern);
          if (matchResult && matchResult[1] === paramName && matchResult[2] === paramValue) {
            const fileMethod = matchResult[4] ? matchResult[4].toUpperCase() : 'GET';
            if (fileMethod === method) {
              acc.push({ file: file, sequence: matchResult[8] ? parseInt(matchResult[8], 10) : null });
            }
          }
          return acc;
        }, []);

        const exactParamMatch = this.resolveSequencedMatch(
          exactParamCandidates,
          queryDir + '|param=' + paramName + '=' + paramValue + '|' + method
        );

        if (exactParamMatch) {
          return path.join(queryDir, exactParamMatch);
        }
      }

      // Priority 2: Check for any param name match [paramName].ext
      const queryParamWinner = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }
        const matchResult = file.match(queryParamPattern);
        if (!matchResult || matchResult[1] === '*') {
          return false;
        }
        const fileMethod = matchResult[3] ? matchResult[3].toUpperCase() : 'GET';
        return queryParams.hasOwnProperty(matchResult[1]) && fileMethod === method;
      });

      if (queryParamWinner) {
        const paramName = queryParamWinner.match(queryParamPattern)[1];

        const queryParamCandidates = files.reduce(function(acc, file) {
          if (file.startsWith('_')) {
            return acc;
          }
          const matchResult = file.match(queryParamPattern);
          if (matchResult && matchResult[1] === paramName) {
            const fileMethod = matchResult[3] ? matchResult[3].toUpperCase() : 'GET';
            if (fileMethod === method) {
              acc.push({ file: file, sequence: matchResult[7] ? parseInt(matchResult[7], 10) : null });
            }
          }
          return acc;
        }, []);

        const queryParamMatch = this.resolveSequencedMatch(
          queryParamCandidates,
          queryDir + '|param=' + paramName + '|' + method
        );

        if (queryParamMatch) {
          return path.join(queryDir, queryParamMatch);
        }
      }

    } catch (err) {
      // Directory not readable
    }

    return null;
  }

  findIndexFile(baseRoot, requestPath, method, extension) {
    const ext = extension || 'json';

    // Priority 3: Check for simple index.ext
    const indexPath = path.join(baseRoot, requestPath, 'index.' + ext);
    if (fs.existsSync(indexPath) && !path.basename(indexPath).startsWith('_')) {
      return indexPath;
    }

    // Priority 4: Check for index with method/delay/status
    const indexDir = path.join(baseRoot, requestPath);
    if (!fs.existsSync(indexDir)) {
      return null;
    }

    try {
      const files = fs.readdirSync(indexDir);
      const indexPattern = buildPatternWithExtension(patterns.index, ext);

      const candidates = files.reduce(function(acc, file) {
        if (file.startsWith('_')) {
          return acc;
        }
        const match = file.match(indexPattern);
        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          if (fileMethod === method) {
            acc.push({ file: file, sequence: match[6] ? parseInt(match[6], 10) : null });
          }
        }
        return acc;
      }, []);

      const indexMatch = this.resolveSequencedMatch(candidates, indexDir + '|index|' + method);

      if (indexMatch) {
        return path.join(indexDir, indexMatch);
      }
    } catch (err) {
      // Directory not readable
    }

    return null;
  }

  findExactFile(baseRoot, requestPath, method, extension) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const baseName = path.basename(requestPath);
    const ext = extension || 'json';

    // For non-json extensions, only look for exact file match (no patterns)
    if (extension && extension !== 'json') {
      const exactFileName = baseName + '.' + ext;
      const exactFilePath = path.join(baseDir, exactFileName);

      if (fs.existsSync(exactFilePath) && !path.basename(exactFilePath).startsWith('_')) {
        return exactFilePath;
      }
      return null;
    }

    // JSON file search with method/delay/status patterns
    try {
      const files = fs.readdirSync(baseDir);
      const self = this;
      const escapedName = this.escapeRegex(baseName);
      const patternString = buildExactFilePattern(escapedName, ext);
      const regex = new RegExp(patternString, 'i');

      const candidates = files.reduce(function(acc, file) {
        if (file.startsWith('_')) {
          return acc;
        }

        const match = file.match(regex);

        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          if (fileMethod === method) {
            acc.push({ file: file, sequence: match[6] ? parseInt(match[6], 10) : null });
          }
        }
        return acc;
      }, []);

      const exactMatch = self.resolveSequencedMatch(candidates, baseDir + '|' + baseName + '|' + method);

      if (exactMatch) {
        return path.join(baseDir, exactMatch);
      }
    } catch (err) {
      // Directory not readable
    }

    return null;
  }

  findWildcardFile(baseRoot, requestPath, method, extension) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const ext = extension || 'json';

    // Wildcard only works for JSON files
    if (extension && extension !== 'json') {
      return null;
    }

    try {
      const files = fs.readdirSync(baseDir);

      const wildcardPattern = buildPatternWithExtension(patterns.wildcard, ext);

      const candidates = files.reduce(function(acc, file) {
        if (file.startsWith('_')) {
          return acc;
        }

        const match = file.match(wildcardPattern);

        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          if (fileMethod === method) {
            acc.push({ file: file, sequence: match[6] ? parseInt(match[6], 10) : null });
          }
        }
        return acc;
      }, []);

      const wildcardMatch = this.resolveSequencedMatch(candidates, baseDir + '|wildcard|' + method);

      if (wildcardMatch) {
        return path.join(baseDir, wildcardMatch);
      }
    } catch (err) {
      // Directory not readable
    }

    return null;
  }

  parseFileMetadata(filePath) {
    const fileName = path.basename(filePath, '.json');

    const delayMatch = fileName.match(patterns.delay);
    let delay = delayMatch ? parseInt(delayMatch[1], 10) : 0;

    if (delay > 600000) {
      console.warn('Delay ' + delay + 'ms exceeds maximum of 10 minutes. Using 600000ms instead.');
      delay = 600000;
    }

    const statusMatch = fileName.match(patterns.status);
    let status = statusMatch ? parseInt(statusMatch[1], 10) : 200;

    if (status < 100 || status > 599) {
      console.warn('Invalid status code ' + status + '. Using 200 instead.');
      status = 200;
    }

    return { delay, status };
  }

  handleRequest(req, res, method) {
    const requestPath = req.path === '/' ? '/index' : req.path;
    const extension = extractExtension(requestPath) || 'json';
    const pathWithoutExtension = removeExtension(requestPath);
    const mimeType = getMimeType(extension);

    const queryString = Object.keys(req.query).length > 0
      ? '?' + Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&')
      : '';
    const uri = requestPath + queryString;
    const filePath = this.findMockFile(pathWithoutExtension, req.query, method, extension);

    if (!filePath) {
      const notFoundBody = {
        error: 'Mock file not found',
        path: requestPath,
        query: req.query,
        method: method
      };
      const notFoundHeaders = { 'content-type': 'application/json' };
      this.logRequest(uri, method, null, true, 404, req.body, req.query, req.headers, notFoundHeaders, notFoundBody);
      return res.status(404).json(notFoundBody);
    }

    const metadata = this.parseFileMetadata(filePath);
    const { headers: responseHeaders, body: responseBody } = this.prepareResponseData(filePath, mimeType, extension);
    this.logRequest(uri, method, filePath, false, metadata.status, req.body, req.query, req.headers, responseHeaders, responseBody);
    this.sendMockResponse(res, filePath, mimeType, extension, metadata);
  }

  sendMockResponse(res, filePath, mimeType, extension, metadata) {
    try {
      if (!metadata) {
        metadata = this.parseFileMetadata(filePath);
      }
      const isBinary = isBinaryType(extension);
      const isJson = extension === 'json';

      if (isBinary) {
        // Read binary files as buffer
        const content = fs.readFileSync(filePath);
        setTimeout(function() {
          res.status(metadata.status).type(mimeType).send(content);
        }, metadata.delay);
      } else if (isJson) {
        // Parse JSON files
        const content = fs.readFileSync(filePath, 'utf8');
        const jsonData = JSON.parse(content);
        setTimeout(function() {
          res.status(metadata.status).type(mimeType).send(jsonData);
        }, metadata.delay);
      } else {
        // Send text files as-is (xml, html, txt, css, js, csv)
        const content = fs.readFileSync(filePath, 'utf8');
        setTimeout(function() {
          res.status(metadata.status).type(mimeType).send(content);
        }, metadata.delay);
      }
    } catch (err) {
      res.status(500).json({
        error: 'Error reading mock file',
        message: err.message
      });
    }
  }

  setupRoutes() {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    const methods = ['get', 'post', 'put', 'delete', 'patch'];
    const self = this;

    methods.forEach(function(httpMethod) {
      self.app[httpMethod]('*', function(req, res) {
        self.handleRequest(req, res, httpMethod.toUpperCase());
      });
    });
  }

  start() {
    this.setupRoutes();

    const server = this.httpsOptions
      ? https.createServer(this.httpsOptions, this.app)
      : http.createServer(this.app);

    server.listen(this.config.port, this.config.host, () => {
      const url = colors.cyan + this.protocol + '://' + this.config.host + ':' + this.config.port + colors.reset;
      const mocksPath = colors.cyan + this.mockDir + colors.reset;
      console.log('Mock server running at ' + url);
      console.log('Serving mocks from: ' + mocksPath);
      if (global.mocklabOverlay) {
        console.log('Active overlay: ' + colors.cyan + global.mocklabOverlay + colors.reset);
      } else if (this.overlayNotFound) {
        console.log('Active overlay: ' + colors.red + 'Overlay Not Found' + colors.reset);
      }
      if (Object.keys(this.cliConfig).length > 0) {
        console.log('Command Line Args: ' + JSON.stringify(this.cliConfig, null, 2));
      }
      console.log('Configuration: ' + JSON.stringify(this.config, null, 2));
    });
  }
}

module.exports = Mocklab;
