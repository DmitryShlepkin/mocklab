const fs = require('fs');
const path = require('path');

function loadConfig(cwd) {
  const configPath = path.join(cwd, 'mock.conf');
  const defaults = {
    host: 'localhost',
    port: 3232,
    historyLimit: 100,
    controlPanel: true,
    skipDisplayFor: []
  };

  try {
    if (fs.existsSync(configPath)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(configPath, 'utf8')) };
    }
  } catch (err) {
    console.log('Using default configuration');
  }
  return defaults;
}

function parseCliArgs(args) {
  const supported = ['host', 'port', 'overlay', 'historyLimit', 'controlPanel'];
  const result = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const separator = arg.indexOf('=');
    if (!arg.startsWith('--') || separator === -1) continue;
    const key = arg.substring(2, separator);
    const value = arg.substring(separator + 1);
    if (!supported.includes(key)) continue;
    if (key === 'port' || key === 'historyLimit') {
      const number = parseInt(value, 10);
      if (!Number.isNaN(number)) result[key] = number;
    } else if (key === 'controlPanel') {
      result[key] = value !== 'false';
    } else {
      result[key] = value;
    }
  }
  return result;
}

function getHttpsOptions(config, cwd) {
  if (!config.https) return null;
  if (!config.https.key || !config.https.cert) return null;
  try {
    return {
      key: fs.readFileSync(path.resolve(cwd, config.https.key)),
      cert: fs.readFileSync(path.resolve(cwd, config.https.cert))
    };
  } catch (err) {
    console.warn(`Failed to read HTTPS key/cert: ${err.message}. Falling back to HTTP.`);
    return null;
  }
}

module.exports = { loadConfig, parseCliArgs, getHttpsOptions };
