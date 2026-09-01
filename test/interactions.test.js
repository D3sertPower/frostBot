'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  configureInteractions,
  executeCommand,
  getCurrentInteraction,
  invokeCommand,
} = require('../src/interactions');

test('um comando pode chamar outro e receber um resultado estruturado', async () => {
  const commands = new Map();

  commands.set('!inventory', {
    name: 'inventory',
    aliases: ['inv'],
    run(steamID) {
      return [`item:${steamID}`];
    },
  });

  commands.set('!offer', {
    name: 'offer',
    aliases: [],
    async run(steamID) {
      const inventoryResult = await invokeCommand(
        'inventory',
        [steamID],
        { mode: 'result' },
      );

      return {
        calledCommand: inventoryResult.command,
        items: inventoryResult.value,
        stack: getCurrentInteraction().stack,
      };
    },
  });

  configureInteractions(commands);

  const result = await executeCommand('offer', ['123'], { mode: 'result' });

  assert.equal(result.ok, true);
  assert.equal(result.value.calledCommand, 'inventory');
  assert.deepEqual(result.value.items, ['item:123']);
  assert.deepEqual(result.value.stack, ['offer']);
});

test('detecta interação circular entre comandos', async () => {
  const commands = new Map();

  commands.set('!first', {
    name: 'first',
    aliases: [],
    run() {
      return invokeCommand('second');
    },
  });

  commands.set('!second', {
    name: 'second',
    aliases: [],
    run() {
      return invokeCommand('first');
    },
  });

  configureInteractions(commands);

  const result = await executeCommand('first', [], {
    mode: 'result',
    throwOnError: false,
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CIRCULAR_INTERACTION');
});
