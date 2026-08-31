'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getReply } = require('../src/message-handler');

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
