#!/usr/bin/env node

const Mockia = require('./mockia');

// Global overlay variable that can be changed dynamically
global.mockiaOverlay = null;

if (require.main === module) {
  const server = new Mockia();
  server.start();
}

module.exports = Mockia;
