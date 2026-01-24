// Regex patterns for file matching

const patterns = {
  // Matches [paramName=value]-method-X-delay-X-status-X.json
  exactParamValue: /^\[([^=\]]+)=([^\]]+)\](-method-(get|post|put|delete|patch))?(-delay-\d+)?(-status-\d+)?\.json$/i,

  // Matches [paramName]-method-X-delay-X-status-X.json
  queryParam: /^\[([^\]=]+)\](-method-(get|post|put|delete|patch))?(-delay-\d+)?(-status-\d+)?\.json$/i,

  // Matches index-method-X-delay-X-status-X.json
  index: /^index(-method-(get|post|put|delete|patch))?(-delay-\d+)?(-status-\d+)?\.json$/i,

  // Matches [*]-method-X-delay-X-status-X.json
  wildcard: /^\[\*\](-method-(get|post|put|delete|patch))?(-delay-\d+)?(-status-\d+)?\.json$/i,

  // Matches -delay-123 in filename
  delay: /-delay-(\d+)/,

  // Matches -status-404 in filename
  status: /-status-(\d+)/
};

// Build a regex pattern for exact file name match
// Returns pattern: ^{escapedName}(-method-(get|post|put|delete|patch))?(-delay-\d+)?(-status-\d+)?\.json$
function buildExactFilePattern(escapedName) {
  const parts = [
    '^',
    escapedName,
    '(-method-(get|post|put|delete|patch))?',
    '(-delay-\\d+)?',
    '(-status-\\d+)?',
    '\\.json$'
  ];
  return parts.join('');
}

module.exports = {
  patterns,
  buildExactFilePattern
};
