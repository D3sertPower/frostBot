'use strict';

const { code, pre, quote } = require('../chat-format');
const { setGroup, checkPermission } = require('../permissions')
const { resolveFriendsByName } = require('../steam-friends')
module.exports = {
  name: 'setgroup',
  aliases: ['addgroup','setargrupo','sg'],
  args: ['[group]', '[name]'],
  description: 'Sets a group for an user.',
  async run() {
    // [0] -> COMMAND
    // [1] -> ARGS[0] -> GROUP
    // [2] -> ARGS[1] -> NAME
    // [3] -> REQUESTER STEAM ID
    const args = Array.from(arguments)
    const requesterSteamId = String(args.at(-1) ?? '')
    const candidates = await resolveFriendsByName(args[2])

    if (args.length < 4) {
      return pre([
        '👀 You didn\'t specify all necessary arguments.',
        '📝 Usage: !setgroup <group> <name>'
    ]);
    }

    if (candidates.length === 0) {
    return quote([
      '🧶 No user was found with this name.',
      'Try again.'
    ])
    }
    
    let targetSID64 = candidates[0].steamID64
    let targetName = candidates[0].name
    
    if (!checkPermission(requesterSteamId, "SET_GROUPS")) {
      return code([
        '🧨 What are you trying to do, kid?',
        'You are not allowed to use this command.'
      ])
    }
    else {
      try {
      await setGroup(targetSID64, args[1])  
      }
      catch(e) {
      return code([
        '❌ Something wrong happened',
        e
      ])      
      }
      return pre([
        `✅ GRUPO DE ${targetName} atualizado com sucesso.`
      ])
    } 
  }
}