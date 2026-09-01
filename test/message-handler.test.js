'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getReply, commandMap } = require('../src/message-handler');

test('exposes a commandMap without circular dependency', () => {
  assert.ok(commandMap instanceof Map);
  assert.ok(commandMap.has('!ping'));
  assert.equal(getReply('!ping'), 'Pong!');
});

test('responde ao comando !hello', () => {
  assert.equal(getReply('!hello'), 'Hello!');
});

test('aceita espaços e diferenças de maiúsculas', () => {
  assert.equal(getReply('  !HELLO  '), 'Hello!');
});

test('ignora mensagens que não são o comando', () => {
  assert.equal(getReply('oi !hello'), null);
  assert.equal(getReply('!help'), null);
  assert.equal(getReply(null), null);
});
