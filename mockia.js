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
      port: 3232
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
        console.log('📦 Overlay from command line: ' + global.mockiaOverlay);
        return;
      }
    }

    if (this.config.overlay) {
      global.mockiaOverlay = this.config.overlay;
      console.log('📦 Overlay from config: ' + global.mockiaOverlay);
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
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const baseName = path.basename(requestPath);

    if (queryParams && Object.keys(queryParams).length > 0) {
      const queryDir = path.join(baseRoot, requestPath);

      try {
        if (fs.existsSync(queryDir)) {
          const files = fs.readdirSync(queryDir);

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
        }
      } catch (err) {
        // Directory not readable
      }
    }

    const indexPath = path.join(baseRoot, requestPath, 'index.json');
    if (fs.existsSync(indexPath) && !path.basename(indexPath).startsWith('_')) {
      return indexPath;
    }

    const indexDir = path.join(baseRoot, requestPath);
    if (fs.existsSync(indexDir)) {
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
    }

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
        const filePath = self.findMockFile(requestPath, req.query, httpMethod.toUpperCase());

        if (!filePath) {
          return res.status(404).json({
            error: 'Mock file not found',
            path: requestPath,
            query: req.query,
            method: httpMethod.toUpperCase()
          });
        }

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
      console.log('🚀 Mock server running at http://' + this.config.host + ':' + this.config.port);
      console.log('📁 Serving mocks from: ' + this.mockDir);
      if (global.mockiaOverlay) {
        console.log('📦 Active overlay: ' + global.mockiaOverlay);
      }
      console.log('⚙️  Configuration: ' + JSON.stringify(this.config, null, 2));
    });
  }
}

module.exports = Mockia;
