'use strict';

const fs = require('fs');
const {
  configureInteractions,
  executeCommand,
  resolveCommand,
} = require('./interactions');

const COMMANDS = new Map([
]);

const PREFIX = '!'

// Adiciona os comandos dinamicamente ao bot
const commandFiles = fs.readdirSync(`./src/commands/`).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    const formattedCommandName = PREFIX + command.name.toLowerCase();
    COMMANDS.set(formattedCommandName, command);
  }

configureInteractions(COMMANDS);

async function handleCommand(text, friendSteamID) {
  /** 
   * Acha o comando certo e o executa com base na mensagem do usuário
   * 
   * @param {string} text - Texto que foi enviado pelo usuário 
   * @returns {string} - Resposta do comando efetuado ou nada se não encontrar
   * */ 
  const normalizedText = text.trim();

  if (!normalizedText.startsWith(PREFIX)) {
    return null;
  }

  const commandArgs = normalizedText
    .slice(PREFIX.length)
    .trim()
    .split(/ +/);
  const issuedCommand = resolveCommand(commandArgs[0]);

  if (!issuedCommand) {
    return null;
  }

  commandArgs.push(friendSteamID);

  return executeCommand(issuedCommand, commandArgs, {
    metadata: { friendSteamID, source: 'steam-message' },
  });
}
// Por agora criar um inventário mock que permite apenas eu passar itens
// de uma conta para outra.
// Inventário dicionário com userid do friend e lista com id dos itens
// Criar extensão do Chrome

async function getReply(text, friendId64) {
  /** Puxa uma resposta do bot.
  * 
  * @param {string} text - Mensagem enviada pelo usuário
  * @returns {string} - Resposta do bot ou nada
  **/
  if (typeof text !== 'string') {
    return null;
  }
  return handleCommand(text, friendId64);
}

module.exports = { getReply, COMMANDS};
