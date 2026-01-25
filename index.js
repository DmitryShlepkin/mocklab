#!/usr/bin/env node

const Mocklab = require('./mocklab');

// Global overlay variable that can be changed dynamically
global.mockiaOverlay = null;

// Global request history array
global.mockiaRequestHistory = [];

if (require.main === module) {
  const server = new Mocklab();
  server.start();
}

module.exports = Mocklab;
