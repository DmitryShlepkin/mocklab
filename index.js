#!/usr/bin/env node
const Mocklab = require('./mocklab');

// Global overlay variable that can be changed dynamically
global.mocklabOverlay = null;

// Global request history array
global.mocklabRequestHistory = [];

if (require.main === module) {
  const server = new Mocklab();
  server.start();
}

module.exports = Mocklab;
