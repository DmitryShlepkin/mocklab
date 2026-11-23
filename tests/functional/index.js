const assert = require('node:assert/strict');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { before, describe, test } = require('node:test');
const request = require('supertest');
const Mocklab = require('../../mocklab');

let app;

before(() => {
  const mocklab = new Mocklab();
  mocklab.mockDir = path.join(__dirname, 'mocks');
  mocklab.setupRoutes();
  app = mocklab.app;
});

describe('Mocks', () => {
  test('Call /missing server should respond with 404 and error message', async () => {
    const response = await request(app)
      .get('/missing')
      .expect(404)
      .expect('Content-Type', /application\/json/);

    assert.deepEqual(response.body, {
      error: 'Mock file not found',
      path: '/missing',
      query: {},
      method: 'GET'
    });
  });

  test('Call /case1/test server should respond with mock data test equal true', async () => {
    const response = await request(app)
      .get('/case1/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: true });
  });

  test('Call /case2/test server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case2/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });

  test('Call /case3/test server should respond with mock data wildcard equal true', async () => {
    const response = await request(app)
      .get('/case3/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { wildcard: true });
  });

  test('Call /case4/test server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case4/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });

  test('Call /case5/test server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case5/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });

  test('Call /case6/test server should respond with mock data test equal true', async () => {
    const response = await request(app)
      .get('/case6/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: true });
  });

  test('Call /case7/test server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case7/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });
});

describe('Query Params', () => {
  test('Call /case8/test?test1=true server should respond with mock data test1 equal true', async () => {
    const response = await request(app)
      .get('/case8/test?test1=true')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test1: true });
  });

  test('Call /case8/test?test2=true server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case8/test?test2=true')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });

  test('Call /case9/test?test=1 server should respond with mock data test equal 1', async () => {
    const response = await request(app)
      .get('/case9/test?test=1')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: 1 });
  });

  test('Call /case9/test?test=2 server should respond with mock data index equal true', async () => {
    const response = await request(app)
      .get('/case9/test?test=2')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { index: true });
  });

  test('Call /case10/test?test=1 server should respond with mock data test equal 1', async () => {
    const response = await request(app)
      .get('/case10/test?test=1')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: 1 });
  });

  test('Call /case10/test?test=true server should respond with mock data test equal true', async () => {
    const response = await request(app)
      .get('/case10/test?test=true')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: true });
  });
});

describe('Filename Params', () => {
  test('Call POST /case11/test server should respond with mock data test equal true', async () => {
    const response = await request(app)
      .post('/case11/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { test: true });
  });

  test('Call GET /case11/test server should respond with 404 error', async () => {
    const response = await request(app)
      .get('/case11/test')
      .expect(404)
      .expect('Content-Type', /application\/json/);
  });

  test('Call /case12/test server should respond with 405 error', async () => {
    const response = await request(app)
      .get('/case12/test')
      .expect(405)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { error: true });
  });

  test('Call /case13/test server should respond with 1s delay', async () => {
    const startedAt = performance.now();
    const response = await request(app)
      .get('/case13/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    const elapsed = performance.now() - startedAt;

    assert.deepEqual(response.body, { test: true });
    assert.ok(
      elapsed >= 1000 && elapsed <= 1250,
      `Expected response in 1000–1250ms, got ${elapsed.toFixed(1)}ms`
    );
  });

  test('Call /case14/test server should respond with sequence', async () => {
    const response1 = await request(app)
      .get('/case14/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response1.body, { sequence: 1 });
    const response2 = await request(app)
      .get('/case14/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response2.body, { sequence: 2 });
    const response3 = await request(app)
      .get('/case14/test')
      .expect(200)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response3.body, { sequence: 1 });
  });

  test('Call POST /case15/test server should respond with mock data test equal true', async () => {
    const response = await request(app)
      .post('/case15/test')
      .expect(500)
      .expect('Content-Type', /application\/json/);
    assert.deepEqual(response.body, { error: true });
  });

  test('Call POST /case16/test server should respond with 1s delay', async () => {
    const startedAt = performance.now();
    const response = await request(app)
      .post('/case16/test')
      .expect(500)
      .expect('Content-Type', /application\/json/);
    const elapsed = performance.now() - startedAt;

    assert.deepEqual(response.body, { error: true });
    assert.ok(
      elapsed >= 1000 && elapsed <= 1250,
      `Expected response in 1000–1250ms, got ${elapsed.toFixed(1)}ms`
    );
  });

  test('Call POST /case17/test server should respond with 0.5s delay', async () => {
    const startedAt1 = performance.now();
    const response1 = await request(app)
      .post('/case17/test')
      .expect(500)
      .expect('Content-Type', /application\/json/);
    const elapsed1 = performance.now() - startedAt1;

    assert.deepEqual(response1.body, { sequence: 1 });
    assert.ok(
      elapsed1 >= 500 && elapsed1 <= 750,
      `Expected response in 500–750ms, got ${elapsed1.toFixed(1)}ms`
    );

    const startedAt2 = performance.now();
    const response2 = await request(app)
      .post('/case17/test')
      .expect(500)
      .expect('Content-Type', /application\/json/);
    const elapsed2 = performance.now() - startedAt2;

    assert.deepEqual(response2.body, { sequence: 2 });
    assert.ok(
      elapsed2 >= 500 && elapsed2 <= 750,
      `Expected response in 500–750ms, got ${elapsed2.toFixed(1)}ms`
    );
  });
});