#!/usr/bin/env node
const Mocklab = require('./mocklab');
const ControlPanel = require('./controlpanel');

// Global overlay variable that can be changed dynamically
global.mocklabOverlay = null;

// Global request history array
global.mocklabRequestHistory = [];

if (require.main === module) {
  const server = new Mocklab();
  server.start();

  if (server.config.controlPanel !== false) {
    const panel = new ControlPanel(server);
    panel.start();
  } else {
    console.log('Control panel disabled');
  }
}

module.exports = Mocklab;
