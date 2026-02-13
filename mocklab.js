const express = require('express');
const fs = require('fs');
const path = require('path');
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
    this.config = this.loadConfig();
    this.mockDir = path.join(process.cwd(), 'mocks');
    this.overlayBaseDir = path.join(process.cwd(), 'overlays');

    // Initialize global variables if not already set
    if (!global.mocklabOverlay) {
      global.mocklabOverlay = null;
    }
    if (!global.mocklabRequestHistory) {
      global.mocklabRequestHistory = [];
    }

    this.setupOverlay();
  }

  loadConfig() {
    const configPath = path.join(process.cwd(), 'mock.conf');
    const defaultConfig = {
      host: 'localhost',
      port: 3232,
      historyLimit: 100
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

  setupOverlay() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--overlay=')) {
        global.mocklabOverlay = arg.substring(10);
        console.log('Overlay from command line: ' + colors.cyan + global.mocklabOverlay + colors.reset);
        return;
      }
    }

    if (this.config.overlay) {
      global.mocklabOverlay = this.config.overlay;
      console.log('Overlay from config: ' + colors.cyan + global.mocklabOverlay + colors.reset);
    }
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

  logRequest(uri, method, filePath, error) {
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
    const uriColored = uri;
    const filePathColored = relativeFilePath ? colors.cyan + relativeFilePath + colors.reset : '';
    const errorColored = error ? colors.red + 'Error' + colors.reset : '';

    // Build final message using string interpolation
    const parts = [methodColored, uriColored];
    if (filePathColored) {
      parts.push(filePathColored);
    }
    if (errorColored) {
      parts.push(errorColored);
    }

    console.log(parts.join(' '));

    const requestEntry = {
      uri: uri,
      method: method,
      filePath: relativeFilePath || null,
      error: error
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
      const exactParamMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const matchResult = file.match(exactParamPattern);

        if (matchResult) {
          const paramName = matchResult[1];
          const paramValue = matchResult[2];
          const fileMethod = matchResult[4] ? matchResult[4].toUpperCase() : 'GET';

          return queryParams.hasOwnProperty(paramName) &&
                 String(queryParams[paramName]) === paramValue &&
                 fileMethod === method;
        }
        return false;
      });

      if (exactParamMatch) {
        return path.join(queryDir, exactParamMatch);
      }

      // Priority 2: Check for any param name match [paramName].ext
      const queryParamMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const matchResult = file.match(queryParamPattern);

        if (matchResult && matchResult[1] !== '*') {
          const paramName = matchResult[1];
          const fileMethod = matchResult[3] ? matchResult[3].toUpperCase() : 'GET';
          return queryParams.hasOwnProperty(paramName) && fileMethod === method;
        }
        return false;
      });

      if (queryParamMatch) {
        return path.join(queryDir, queryParamMatch);
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

      const indexMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }
        const match = file.match(indexPattern);
        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          return fileMethod === method;
        }
        return false;
      });

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

      const exactMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const escapedName = self.escapeRegex(baseName);
        const patternString = buildExactFilePattern(escapedName, ext);
        const regex = new RegExp(patternString, 'i');
        const match = file.match(regex);

        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          return fileMethod === method;
        }
        return false;
      });

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

      const wildcardMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const match = file.match(wildcardPattern);

        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          const methodMatches = fileMethod === method;
          return methodMatches;
        }
        return false;
      });

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
      this.logRequest(uri, method, null, true);
      return res.status(404).json({
        error: 'Mock file not found',
        path: requestPath,
        query: req.query,
        method: method
      });
    }

    this.logRequest(uri, method, filePath, false);
    this.sendMockResponse(res, filePath, mimeType, extension);
  }

  sendMockResponse(res, filePath, mimeType, extension) {
    try {
      const metadata = this.parseFileMetadata(filePath);
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

    this.app.listen(this.config.port, this.config.host, () => {
      const url = colors.cyan + 'http://' + this.config.host + ':' + this.config.port + colors.reset;
      const mocksPath = colors.cyan + this.mockDir + colors.reset;
      const overlayName = colors.cyan + global.mocklabOverlay + colors.reset;

      console.log('Mock server running at ' + url);
      console.log('Serving mocks from: ' + mocksPath);
      if (global.mocklabOverlay) {
        console.log('Active overlay: ' + overlayName);
      }
      console.log('Configuration: ' + JSON.stringify(this.config, null, 2));
    });
  }
}

module.exports = Mocklab;
