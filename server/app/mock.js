const fs = require('fs');
const path = require('path');
const { fileName } = require('./fileName');

class MockStore {
  constructor({ mockDir, overlayBaseDir }) {
    this.mockDir = mockDir;
    this.overlayBaseDir = overlayBaseDir;
  }

  overlayExists(name) {
    return Boolean(name) && fs.existsSync(path.join(this.overlayBaseDir, name));
  }

  getSearchDirectories(activeOverlay) {
    const directories = [];
    if (activeOverlay) directories.push(path.join(this.overlayBaseDir, activeOverlay));
    directories.push(this.mockDir);
    return directories;
  }

  resetSequenceState(overlayName) {
    if (!overlayName) return;
    const overlayDir = path.join(this.overlayBaseDir, overlayName);
    for (const key of Object.keys(global.mocklabSequenceState || {})) {
      const keyDir = key.split('|')[0];
      if (keyDir === overlayDir || keyDir.startsWith(overlayDir + path.sep)) {
        delete global.mocklabSequenceState[key];
      }
    }
  }

  resolveSequenced(candidates, stateKey) {
    if (!candidates.length) return null;
    const sequenced = candidates.filter(candidate => candidate.sequence !== null);
    if (!sequenced.length) return candidates[0].file;
    sequenced.sort((a, b) => a.sequence - b.sequence);
    const state = global.mocklabSequenceState;
    const index = (state[stateKey] || 0) % sequenced.length;
    state[stateKey] = index + 1;
    return sequenced[index].file;
  }

  parseFiles(files, extension) {
    const expectedExtension = (extension || 'json').toLowerCase();
    return files.filter(file => !file.startsWith('_')).map(file => ({
      file,
      metadata: fileName(file)
    })).filter(entry =>
      entry.metadata.ext && entry.metadata.ext.toLowerCase() === expectedExtension
    );
  }

  methodMatches(metadata, method) {
    return (metadata.method || 'GET') === method;
  }

  find(requestPath, queryParams, method, extension) {
    for (const baseRoot of this.getSearchDirectories(global.mocklabOverlay)) {
      const match = this.findInDirectory(baseRoot, requestPath, queryParams, method, extension);
      if (match) return match;
    }
    return null;
  }

  findInDirectory(baseRoot, requestPath, queryParams, method, extension) {
    if (queryParams && Object.keys(queryParams).length) {
      const queryMatch = this.findQueryParam(baseRoot, requestPath, queryParams, method, extension);
      if (queryMatch) return queryMatch;
    }

    const indexMatch = this.findIndex(baseRoot, requestPath, method, extension);
    if (indexMatch) return indexMatch;

    const exactMatch = this.findExact(baseRoot, requestPath, method, extension);
    if (exactMatch) return exactMatch;

    if (!extension || extension === 'json') {
      return this.findWildcard(baseRoot, requestPath, method, extension);
    }
    return null;
  }

  findQueryParam(baseRoot, requestPath, queryParams, method, extension) {
    const queryDir = path.join(baseRoot, requestPath);
    if (!fs.existsSync(queryDir)) return null;
    const files = this.parseFiles(fs.readdirSync(queryDir), extension);
    const exactMatches = files.filter(({ metadata }) => {
      if (!metadata.name.startsWith('[') || !metadata.name.endsWith(']')) return false;
      const equals = metadata.name.indexOf('=');
      if (equals < 0) return false;
      const name = metadata.name.slice(1, equals);
      const value = metadata.name.slice(equals + 1, -1);
      return Object.prototype.hasOwnProperty.call(queryParams, name)
        && String(queryParams[name]) === value
        && this.methodMatches(metadata, method);
    });

    if (exactMatches.length) {
      const winnerName = exactMatches[0].metadata.name;
      const candidates = exactMatches
        .filter(({ metadata }) => metadata.name === winnerName)
        .map(({ file, metadata }) => ({ file, sequence: metadata.sequence ?? null }));
      const equals = winnerName.indexOf('=');
      const paramName = winnerName.slice(1, equals);
      const paramValue = winnerName.slice(equals + 1, -1);
      const selected = this.resolveSequenced(candidates, queryDir + '|param=' + paramName + '=' + paramValue + '|' + method);
      if (selected) return path.join(queryDir, selected);
    }

    const paramMatches = files.filter(({ metadata }) => {
      const name = metadata.name;
      if (!name.startsWith('[') || !name.endsWith(']')) return false;
      const paramName = name.slice(1, -1);
      return !paramName.includes('=')
        && paramName !== '*'
        && Object.prototype.hasOwnProperty.call(queryParams, paramName)
        && this.methodMatches(metadata, method);
    });
    if (paramMatches.length) {
      const paramName = paramMatches[0].metadata.name.slice(1, -1);
      const candidates = paramMatches
        .filter(({ metadata }) => metadata.name === '[' + paramName + ']')
        .map(({ file, metadata }) => ({ file, sequence: metadata.sequence ?? null }));
      const selected = this.resolveSequenced(candidates, queryDir + '|param=' + paramName + '|' + method);
      if (selected) return path.join(queryDir, selected);
    }
    return null;
  }

  findIndex(baseRoot, requestPath, method, extension) {
    const ext = extension || 'json';
    const simple = path.join(baseRoot, requestPath, `index.${ext}`);
    if (fs.existsSync(simple)) return simple;

    const dir = path.join(baseRoot, requestPath);
    if (!fs.existsSync(dir)) return null;
    const candidates = this.parseFiles(fs.readdirSync(dir), ext)
      .filter(({ metadata }) => metadata.name.toLowerCase() === 'index'
        && this.methodMatches(metadata, method))
      .map(({ file, metadata }) => ({ file, sequence: metadata.sequence ?? null }));
    const selected = this.resolveSequenced(candidates, dir + '|index|' + method);
    return selected ? path.join(dir, selected) : null;
  }

  findExact(baseRoot, requestPath, method, extension) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const baseName = path.basename(requestPath);
    const ext = extension || 'json';
    if (!fs.existsSync(baseDir)) return null;

    const candidates = fs.readdirSync(baseDir).reduce((acc, file) => {
      if (file.startsWith('_')) return acc;
      const parsed = fileName(file);
      if (parsed.name !== baseName || parsed.ext !== ext) return acc;
      if ((parsed.method || 'GET') === method) {
        acc.push({ file, sequence: parsed.sequence ?? null });
      }
      return acc;
    }, []);

    const selected = this.resolveSequenced(candidates, baseDir + '|' + baseName + '|' + method);
    return selected ? path.join(baseDir, selected) : null;
  }

  findWildcard(baseRoot, requestPath, method, extension) {
    const baseDir = path.join(baseRoot, path.dirname(requestPath));
    const ext = extension || 'json';
    if (!fs.existsSync(baseDir)) return null;
    const candidates = this.parseFiles(fs.readdirSync(baseDir), ext)
      .filter(({ metadata }) => metadata.name === '[*]' && this.methodMatches(metadata, method))
      .map(({ file, metadata }) => ({ file, sequence: metadata.sequence ?? null }));
    const selected = this.resolveSequenced(candidates, baseDir + '|wildcard|' + method);
    return selected ? path.join(baseDir, selected) : null;
  }
}

module.exports = MockStore;
