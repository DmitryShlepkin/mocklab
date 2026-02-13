const mimeTypes = {
  'json': 'application/json',
  'txt': 'text/plain',
  'xml': 'application/xml',
  'html': 'text/html',
  'png': 'image/png',
  'jpeg': 'image/jpeg',
  'jpg': 'image/jpeg',
  'gif': 'image/gif',
  'pdf': 'application/pdf',
  'csv': 'text/csv',
  'js': 'application/javascript',
  'css': 'text/css'
};

// Binary file types that should be read as buffers
const binaryTypes = ['png', 'jpeg', 'jpg', 'gif', 'pdf'];

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

module.exports = {
  mimeTypes,
  getMimeType,
  isBinaryType,
  extractExtension,
  removeExtension
};
