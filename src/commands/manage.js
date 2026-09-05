'use strict';

const { code, pre, quote } = require('../chat-format');
const { checkPermission, accessDeniedMessage } = require('../permissions')

const MANAGER_MODE_USERS = new Array

module.exports = {
  name: 'manage',
  aliases: ['gerenciar','man','mg'],
  description: 'Withdraw any items from the bot.',
  perms: ['MANAGE_TRADES'], // Preferably an admin-only permission, as this allows to manage items in the bot's inventory.
  run() {
    const requesterSteamID = Array.from(arguments).at(-1)
    if (!checkPermission(requesterSteamID, "MANAGE_TRADES")) {
      return accessDeniedMessage()
    }
    else {
    var IS_IN_MANAGER_MODE = MANAGER_MODE_USERS.includes(requesterSteamID)
    if (IS_IN_MANAGER_MODE) {
      var idx = MANAGER_MODE_USERS.indexOf(requesterSteamID)
      MANAGER_MODE_USERS.splice(idx, 1)
      return pre([
        '🔧 You\'re no longer in manager mode.'
      ])
    }
    else {
      MANAGER_MODE_USERS.push(requesterSteamID)
      return pre([
        '🔨 You are in manager mode now',
        '',
        'You may withdraw any items',
        'Type !manage again when you\'re done.'
      ])
    }
    } 
  },
  MANAGER_MODE_USERS
}