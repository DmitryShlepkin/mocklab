const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { fileName } = require('../../server/app/fileName');

describe('fileName', () => {
  test('Pass empty string returns an empty object', () => {
    assert.deepEqual(fileName(''), {});
  });

  test('Pass name `profile.json`', () => {
    assert.deepEqual(fileName('profile.json'), {
      name: 'profile',
      status: 200,
      method: 'GET',
      ext: 'json'
    });
  });

  test('Pass name `profile-status-500.json`', () => {
    assert.deepEqual(fileName('profile-status-500.json'), {
      name: 'profile',
      status: 500,
      ext: 'json'
    });
  });

  test('Pass name `profile-status-500-method-post.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json'
    });
  });

  test('Pass name `profile-method-post-status-500.json`', () => {
    assert.deepEqual(fileName('profile-method-post-status-500.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json'
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000-sequence-1.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000-sequence-1.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000,
      sequence: 1
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000-sequence-1.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000.headers.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000.headers.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000,
      headers: true
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000-sequence-1.payload-1.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000-sequence-1.payload-1.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000,
      payloadContent: 1
    });
  });

  test('Pass name `profile-status-500-method-post-delay-1000-payload-1.json`', () => {
    assert.deepEqual(fileName('profile-status-500-method-post-delay-1000-payload-1.json'), {
      name: 'profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000,
      payload: 1
    });
  });

   test('Pass name `user-profile-status-500-method-post-delay-1000.json`', () => {
    assert.deepEqual(fileName('user-profile-status-500-method-post-delay-1000.json'), {
      name: 'user-profile',
      status: 500,
      method: 'POST',
      ext: 'json',
      delay: 1000
    });
  });

});