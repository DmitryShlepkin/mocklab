function fileName(name) {
    if (typeof name !== 'string' || name.length === 0) {
        return {};
    }

    const dotParts = name.split('.');
    const ext = dotParts.length > 1 ? dotParts.pop() : null;
    const result = ext ? { ext } : {};
    let dotPayload = false;

    if (dotParts.length > 1) {
        const trailing = dotParts.pop();
        if (trailing === 'headers') {
            result.headers = true;
        } else if (/^payload-\d+$/.test(trailing)) {
            result.payloadContent = parseInt(trailing.slice(trailing.lastIndexOf('-') + 1), 10);
            dotPayload = true;
        } else {
            dotParts.push(trailing);
        }
    }

    const settings = dotParts.join('.').split('-');
    const consumed = new Set();
    let recognized = false;

    for (let i = settings.length - 1; i > 0; i -= 2) {
        const key = settings[i - 1].toLowerCase();
        const value = settings[i];

        if (key === 'status' && /^\d+$/.test(value)) {
            result.status = parseInt(value, 10);
            recognized = true;
            consumed.add(i - 1);
            consumed.add(i);
        } else if (key === 'method') {
            result.method = value.toUpperCase();
            recognized = true;
            consumed.add(i - 1);
            consumed.add(i);
        } else if (key === 'delay' && /^\d+$/.test(value)) {
            result.delay = parseInt(value, 10);
            recognized = true;
            consumed.add(i - 1);
            consumed.add(i);
        } else if (key === 'sequence' && /^\d+$/.test(value)) {
            if (!dotPayload) {
                result.sequence = parseInt(value, 10);
            }
            recognized = true;
            consumed.add(i - 1);
            consumed.add(i);
        } else if (key === 'payload' && /^\d+$/.test(value)) {
            result.payload = parseInt(value, 10);
            recognized = true;
            consumed.add(i - 1);
            consumed.add(i);
        }
    }

    const nameParts = settings.filter((_, index) => !consumed.has(index));
    result.name = nameParts.join('-');

    if (!recognized) {
        result.status = 200;
        result.method = 'GET';
    }

    const ordered = { name: result.name };
    if (Object.prototype.hasOwnProperty.call(result, 'status')) ordered.status = result.status;
    if (Object.prototype.hasOwnProperty.call(result, 'method')) ordered.method = result.method;
    if (Object.prototype.hasOwnProperty.call(result, 'ext')) ordered.ext = result.ext;
    if (Object.prototype.hasOwnProperty.call(result, 'delay')) ordered.delay = result.delay;
    if (Object.prototype.hasOwnProperty.call(result, 'sequence')) ordered.sequence = result.sequence;
    if (Object.prototype.hasOwnProperty.call(result, 'headers')) ordered.headers = result.headers;
    if (Object.prototype.hasOwnProperty.call(result, 'payload')) ordered.payload = result.payload;
    if (Object.prototype.hasOwnProperty.call(result, 'payloadContent')) ordered.payloadContent = result.payloadContent;
    if (Object.prototype.hasOwnProperty.call(result, 'body')) ordered.body = result.body;

    return ordered;
}

module.exports = {
    fileName
};
