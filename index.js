#!/usr/bin/env node

const Mockia = require('./Mockia');

// Global overlay variable that can be changed dynamically
global.mockiaOverlay = null;

// Global request history array
global.mockiaRequestHistory = [];

if (require.main === module) {
  const server = new Mockia();
  server.start();
}

module.exports = Mockia;
