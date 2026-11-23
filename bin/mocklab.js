#!/usr/bin/env node

const MocklabServer = require('../server');
const Events = require('../server/app/events');

const server = new MocklabServer();
server.start();

if (server.config.controlPanel !== false) {
  new Events(server).start();
} else {
  console.log('Control panel disabled');
}
