#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const MocklabServer = require('../server');
const Events = require('../server/app/events');

const server = new MocklabServer();
server.start();

if (server.config.controlPanel !== false) {
  const events = new Events(server);
  events.start();
  console.log('Development mode: watching UI files for hot reload');
  fs.watch(path.join(__dirname, '..', 'ui'), { recursive: true }, () => {
    events.broadcastReload();
  });
} else {
  console.log('Development mode: control panel disabled');
}
