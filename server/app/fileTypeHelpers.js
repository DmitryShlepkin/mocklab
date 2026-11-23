const { mimeTypes, binaryTypes } = require('./fileTypes');

function getMimeType(extension) {
  const ext = extension ? extension.toLowerCase() : 'json';
  return mimeTypes[ext] || 'application/json';
}

function isBinaryType(extension) {
  const ext = extension ? extension.toLowerCase() : 'json';
  return binaryTypes.includes(ext);
}

function extractExtension(urlPath) {
  const match = urlPath.match(/\.([a-z0-9]+)$/i);
  return match ? match[1] : null;
}

function removeExtension(urlPath) {
  return urlPath.replace(/\.[a-z0-9]+$/i, '');
}

module.exports = { getMimeType, isBinaryType, extractExtension, removeExtension };
