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

function buildPatternWithExtension(patternBase, extension) {
  const ext = extension || 'json';
  const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const jsonPart = '\\.json$';
  const extPart = '\\.' + escapedExt + '$';
  const newSource = patternBase.source.replace(jsonPart, extPart);
  return new RegExp(newSource, patternBase.flags);
}

function buildExactFilePattern(escapedName, extension) {
  const ext = extension || 'json';
  const escapedExt = ext.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const part1 = '^';
  const part2 = escapedName;
  const part3 = '(-method-(get|post|put|delete|patch))?';
  const part4 = '(-delay-\\d+)?';
  const part5 = '(-status-\\d+)?';
  const part6 = '\\.' + escapedExt + '$';
  return part1 + part2 + part3 + part4 + part5 + part6;
}

module.exports = {
  patterns,
  buildExactFilePattern,
  buildPatternWithExtension
};
