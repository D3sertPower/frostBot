const { pre } = require('../chat-format');

module.exports = {
  name: 'help',
  aliases: ['h', 'ajuda'],
  description: 'Lists all commands and their properties.',

  run() {
    const { COMMANDS } = require('../message-handler');

    const lines = [
      '📚 FROSTBOAT COMMAND DECK ❄️',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    for (const command of COMMANDS.values()) {
      const usage = command.args?.length
        ? `!${command.name} ${command.args.join(' ')}`
        : `!${command.name}`;

      lines.push(
        '',
        `🔹 ${usage}`,
        `   🔁 Aliases: ${command.aliases.map((alias) => `!${alias}`).join(', ') || 'none'}`,
        `   💬 ${command.description}`,
      );
    }

    lines.push('', '💡 Type any command exactly as shown above.');
    return pre(lines);
  }
};
