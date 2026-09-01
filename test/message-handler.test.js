'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getReply, COMMANDS } = require('../src/message-handler');

test('expõe o registro de comandos sem dependência circular', async () => {
  assert.ok(COMMANDS instanceof Map);
  assert.ok(COMMANDS.has('!ping'));
  assert.equal(await getReply('!ping'), 'Pong!');
});

test('executa um comando pelo alias', async () => {
  assert.equal(await getReply('!p'), 'Pong!');
});

test('aceita espaços e diferenças de maiúsculas', async () => {
  assert.equal(await getReply('  !PING  '), 'Pong!');
});

test('ignora mensagens que não são comandos conhecidos', async () => {
  assert.equal(await getReply('oi !ping'), null);
  assert.equal(await getReply('!unknown'), null);
  assert.equal(await getReply(null), null);
});

test('sendoffer busca o inventário e cria uma transação', async () => {
  const reply = await getReply(
    '!sendoffer 76561198000000000 The Frosty Ban Hammer',
    '76561198874586215',
  );

  assert.match(reply, /Offer created successfully/);
  assert.match(reply, /Item: The Frosty Ban Hammer/);
  assert.match(reply, /From: 76561198874586215/);
  assert.match(reply, /To: 76561198000000000/);
});

test('sendoffer recusa item que não pertence ao usuário', async () => {
  const reply = await getReply(
    '!sendoffer 76561198000000000 Imaginary Item',
    '76561198874586215',
  );

  assert.match(reply, /was not found in your inventory/);
});
