module.exports = {
  name: 'help',
  aliases: ['h', 'ajuda'],
  description: 'Lists all commands and their properties.',

  run() {
    const { COMMANDS } = require('../message-handler');

    let message = 'Here is the list with all commands:\n';

    for (const command of COMMANDS.values()) {
      message += `\n${command.name}:\n`;
      message += `aliases: ${command.aliases.join(', ')}\n`;
      message += `${command.description}\n`;
    }

    return message;
  }
};