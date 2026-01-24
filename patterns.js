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
  status: /-status-(\d+)/,

  // Matches special regex characters for escaping
  regexSpecialChars: /[.*+?^${}()|[\]\\]/g
};

function buildExactFilePattern(escapedName) {
  const p1 = '^';
  const p2 = escapedName;
  const p3 = '(-method-(get|post|put|delete|patch))?';
  const p4 = '(-delay-\\d+)?';
  const p5 = '(-status-\\d+)?';
  const p6 = '\\.json$';
  return p1 + p2 + p3 + p4 + p5 + p6;
}

module.exports = {
  patterns,
  buildExactFilePattern
};
