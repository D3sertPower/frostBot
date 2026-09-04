const { pre } = require('../chat-format');
const { checkPermission } = require('../permissions')
module.exports = {
  name: 'help',
  aliases: ['h', 'ajuda'],
  description: 'Lists all commands and their properties.',

  run() {
    const requesterSteamID = Array.from(arguments).at(-1)
    const { COMMANDS } = require('../message-handler');
    const lines = [
      '📚 FROSTBOAT COMMAND DECK ❄️',
      '━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ];

    for (const command of COMMANDS.values()) {

      // A primeira perm é sempre a mais importante, condição para visualizar o comando no help.
      const perm = command?.perms?.[0]
      if (!checkPermission(requesterSteamID, perm)) {
      continue
      }

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
