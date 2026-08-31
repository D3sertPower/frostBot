'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const SteamUser = require('steam-user');

test('steam-user expõe o cliente de mensagens esperado', () => {
  const client = new SteamUser({ dataDirectory: null, autoRelogin: false });

  assert.equal(typeof client.logOn, 'function');
  assert.equal(typeof client.chat.on, 'function');
  assert.equal(typeof client.chat.sendFriendMessage, 'function');
  assert.equal(typeof client.chat.ackFriendMessage, 'function');
});
