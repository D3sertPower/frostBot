'use strict';

const COMMANDS = new Map([
  ['!hello', 'Hello!'],
]);

function getReply(text) {
  if (typeof text !== 'string') {
    return null;
  }

  return COMMANDS.get(text.trim().toLowerCase()) ?? null;
}

module.exports = { getReply };
