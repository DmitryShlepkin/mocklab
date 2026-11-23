const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const request = require('supertest');
const Events = require('../../server/app/events');

const createEvents = mockDir => {
  global.mocklabOverlay = null;
  global.mocklabRequestHistory = [];
  return new Events({
    config: { port: 3232, host: 'localhost' },
    overlayBaseDir: mockDir,
    mockDir,
    resetSequenceStateForOverlay() {}
  });
};

describe('/__events', () => {
  test('sends a JSON snapshot over the event stream', async t => {
    const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklab-events-'));
    t.after(() => fs.rmSync(mockDir, { recursive: true, force: true }));
    const events = createEvents(mockDir);
    const server = events.app.listen(0);
    t.after(() => server.close());
    const port = server.address().port;

    await new Promise((resolve, reject) => {
      const eventRequest = http.get({ port, path: '/__events' }, response => {
        assert.equal(response.headers['content-type'], 'text/event-stream');
        response.once('data', chunk => {
          try {
            const dataLine = chunk.toString().split('\n').find(line => line.startsWith('data: '));
            const message = JSON.parse(dataLine.slice(6));
            assert.equal(message.type, 'snapshot');
            assert.deepEqual(message, { type: 'snapshot', history: [], overlay: null, overlays: [] });
            resolve();
          } catch (error) {
            reject(error);
          } finally {
            eventRequest.destroy();
          }
        });
      });
      eventRequest.once('error', error => {
        if (error.code !== 'ECONNRESET') reject(error);
      });
    });
  });

  test('accepts JSON action messages and returns JSON', async t => {
    const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklab-events-'));
    t.after(() => fs.rmSync(mockDir, { recursive: true, force: true }));
    const events = createEvents(mockDir);

    global.mocklabRequestHistory = [{ uri: '/users/1' }];
    const response = await request(events.app)
      .post('/__events')
      .send({ type: 'clear-history' });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.deepEqual(global.mocklabRequestHistory, []);
  });

  test('rejects unknown message types with a JSON error', async () => {
    const events = createEvents(os.tmpdir());
    const response = await request(events.app)
      .post('/__events')
      .send({ type: 'unknown' });

    assert.equal(response.status, 400);
    assert.equal(response.headers['content-type'].startsWith('application/json'), true);
    assert.deepEqual(response.body, { ok: false, error: 'Unknown message type: unknown' });
  });

  test('writes add-mock content from the JSON message', async t => {
    const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mocklab-events-'));
    t.after(() => fs.rmSync(mockDir, { recursive: true, force: true }));
    const events = createEvents(mockDir);

    const response = await request(events.app)
      .post('/__events')
      .send({
        type: 'add-mock',
        uri: '/users/1',
        method: 'GET',
        content: { id: 1, name: 'Example' }
      });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(mockDir, 'users/1.json'), 'utf8')), {
      id: 1,
      name: 'Example'
    });
  });

  test('returns a JSON error for malformed JSON', async () => {
    const events = createEvents(os.tmpdir());
    const response = await request(events.app)
      .post('/__events')
      .set('Content-Type', 'application/json')
      .send('{"type":');

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { ok: false, error: 'Request body must be valid JSON' });
  });
});
