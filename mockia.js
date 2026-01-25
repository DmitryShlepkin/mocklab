const express = require('express');
const fs = require('fs');
const path = require('path');
const { patterns, buildExactFilePattern } = require('./patterns');

class Mockia {
  constructor() {
    this.app = express();
    this.config = this.loadConfig();
    this.mockDir = path.join(process.cwd(), 'mocks');
    this.overlayBaseDir = path.join(process.cwd(), 'overlays');
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
        global.mockiaOverlay = arg.substring(10);
        console.log('Overlay from command line: ' + global.mockiaOverlay);
        return;
      }
    }

    if (this.config.overlay) {
      global.mockiaOverlay = this.config.overlay;
      console.log('Overlay from config: ' + global.mockiaOverlay);
    }
  }

  getSearchDirectories(requestPath) {
    const directories = [];

    if (global.mockiaOverlay) {
      const overlayDir = path.join(this.overlayBaseDir, global.mockiaOverlay);
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

    const errorLabel = error ? 'Error' : '';
    console.log(method + ' ' + uri + (relativeFilePath ? ' ' + relativeFilePath : '') + (errorLabel ? ' ' + errorLabel : ''));

    const requestEntry = {
      uri: uri,
      method: method,
      filePath: relativeFilePath || null,
      error: error
    };

    global.mockiaRequestHistory.unshift(requestEntry);

    const limit = this.config.historyLimit || 100;
    if (global.mockiaRequestHistory.length > limit) {
      global.mockiaRequestHistory = global.mockiaRequestHistory.slice(0, limit);
    }
  }

  findMockFile(requestPath, queryParams, method) {
    const searchDirs = this.getSearchDirectories(requestPath);

    for (let i = 0; i < searchDirs.length; i++) {
      const searchBase = searchDirs[i];
      const filePath = this.findMockFileInDirectory(searchBase, requestPath, queryParams, method);
      if (filePath) {
        return filePath;
      }
    }

    return null;
  }

  findMockFileInDirectory(baseRoot, requestPath, queryParams, method) {
    // Priority 1 & 2: Check for query parameter matches
    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryFile = this.findQueryParamFile(baseRoot, requestPath, queryParams, method);
      if (queryFile) {
        return queryFile;
      }
    }

    // Priority 3 & 4: Check for index files
    const indexFile = this.findIndexFile(baseRoot, requestPath, method);
    if (indexFile) {
      return indexFile;
    }

    // Priority 5: Check for exact file match
    const exactFile = this.findExactFile(baseRoot, requestPath, method);
    if (exactFile) {
      return exactFile;
    }

    // Priority 6: Check for wildcard file
    const wildcardFile = this.findWildcardFile(baseRoot, requestPath, method);
    if (wildcardFile) {
      return wildcardFile;
    }

    return null;
  }

  findQueryParamFile(baseRoot, requestPath, queryParams, method) {
    const queryDir = path.join(baseRoot, requestPath);

    try {
      if (!fs.existsSync(queryDir)) {
        return null;
      }

      const files = fs.readdirSync(queryDir);

      // Priority 1: Check for exact param value match [paramName=value].json
      const exactParamMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const matchResult = file.match(patterns.exactParamValue);

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

      // Priority 2: Check for any param name match [paramName].json
      const queryParamMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const matchResult = file.match(patterns.queryParam);

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

  findIndexFile(baseRoot, requestPath, method) {
    // Priority 3: Check for simple index.json
    const indexPath = path.join(baseRoot, requestPath, 'index.json');
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
      const indexMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }
        const match = file.match(patterns.index);
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

  findExactFile(baseRoot, requestPath, method) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const baseName = path.basename(requestPath);

    try {
      const files = fs.readdirSync(baseDir);
      const self = this;

      const exactMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const escapedName = self.escapeRegex(baseName);
        const patternString = buildExactFilePattern(escapedName);
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
      // Directory doesn't exist
    }

    return null;
  }

  findWildcardFile(baseRoot, requestPath, method) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));

    try {
      const files = fs.readdirSync(baseDir);

      const wildcardMatch = files.find(function(file) {
        if (file.startsWith('_')) {
          return false;
        }

        const match = file.match(patterns.wildcard);

        if (match) {
          const fileMethod = match[2] ? match[2].toUpperCase() : 'GET';
          return fileMethod === method;
        }
        return false;
      });

      if (wildcardMatch) {
        return path.join(baseDir, wildcardMatch);
      }
    } catch (err) {
      // Directory doesn't exist
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

  setupRoutes() {
    const methods = ['get', 'post', 'put', 'delete', 'patch'];
    const self = this;

    methods.forEach(function(httpMethod) {
      self.app[httpMethod]('*', function(req, res) {
        const requestPath = req.path === '/' ? '/index' : req.path;
        const queryString = Object.keys(req.query).length > 0
          ? '?' + Object.keys(req.query).map(key => key + '=' + req.query[key]).join('&')
          : '';
        const uri = requestPath + queryString;
        const filePath = self.findMockFile(requestPath, req.query, httpMethod.toUpperCase());

        if (!filePath) {
          self.logRequest(uri, httpMethod.toUpperCase(), null, true);
          return res.status(404).json({
            error: 'Mock file not found',
            path: requestPath,
            query: req.query,
            method: httpMethod.toUpperCase()
          });
        }

        self.logRequest(uri, httpMethod.toUpperCase(), filePath, false);

        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const jsonData = JSON.parse(content);
          const metadata = self.parseFileMetadata(filePath);

          setTimeout(function() {
            res.status(metadata.status).json(jsonData);
          }, metadata.delay);
        } catch (err) {
          res.status(500).json({
            error: 'Error reading mock file',
            message: err.message
          });
        }
      });
    });
  }

  start() {
    this.setupRoutes();

    this.app.listen(this.config.port, this.config.host, () => {
      console.log('Mock server running at http://' + this.config.host + ':' + this.config.port);
      console.log('Serving mocks from: ' + this.mockDir);
      if (global.mockiaOverlay) {
        console.log('Active overlay: ' + global.mockiaOverlay);
      }
      console.log('Configuration: ' + JSON.stringify(this.config, null, 2));
    });
  }
}

module.exports = Mockia;
