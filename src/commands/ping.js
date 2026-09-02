const { code } = require('../chat-format');

module.exports = {
  name: 'ping',
  aliases: ['p'],
  description: 'Sends a ping message to the bot, test if the bot is working!',
  run() {
    return code('🏓 Pong! FrostBoat is online and COLD!')
  }
}
