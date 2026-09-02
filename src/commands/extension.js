const { quote } = require('../chat-format');

module.exports = {
  name: 'extensions',
  aliases: ['ext','e'],
  description: 'Gets the browser extension link.',
  run() {
    return quote([
      '🧩 FrostBoat Browser Extension',
      '🔗 Get it here: https://example.com',
      '✨ Faster access, fewer clicks, same frosty experience.',
    ])
  }
}
