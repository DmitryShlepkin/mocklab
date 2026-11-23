const { extractExtension, removeExtension } = require('./fileTypeHelpers');

function parseUrl(req) {
  const requestPath = req.path === '/' ? '/index' : req.path;
  const extension = extractExtension(requestPath) || 'json';
  const pathWithoutExtension = removeExtension(requestPath);
  const queryEntries = Object.keys(req.query);
  const queryString = queryEntries.length
    ? '?' + queryEntries.map(key => `${key}=${req.query[key]}`).join('&')
    : '';

  return {
    requestPath,
    extension,
    pathWithoutExtension,
    queryString,
    uri: requestPath + queryString
  };
}

module.exports = { parseUrl };
