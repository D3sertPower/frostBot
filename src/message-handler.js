'use strict';

const fs = require('fs');

const COMMANDS = new Map([
]);

const PREFIX = '!'

// Adiciona os comandos dinamicamente ao bot
const commandFiles = fs.readdirSync(`./src/commands/`).filter(file => file.endsWith('.js'));
  for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    var formattedCommandName = PREFIX + command.name
    COMMANDS.set(formattedCommandName, command)
  }

function handleCommand(text,friendSteamID) {
  /** 
   * Acha o comando certo e o executa com base na mensagem do usuário
   * 
   * @param {string} text - Texto que foi enviado pelo usuário 
   * @returns {string} - Resposta do comando efetuado ou nada se não encontrar
   * */ 
  var commandArgs = text.toLowerCase().slice(PREFIX.length).trim().split(/ +/);
  commandArgs.push(friendSteamID)
  // Primeiro tentamos achar o comando pelo nome direto
  if ((COMMANDS.get(PREFIX + commandArgs[0]) ?? null) != null) {
  var issuedCommand = COMMANDS.get(text.trim().toLowerCase())
  return issuedCommand.run(...commandArgs)
  }
  // Agora tentamos achar o comando pelo alias
  var issuedCommand = Array.from(COMMANDS.values()).find(cmd => 
  cmd.aliases?.some(alias => alias === commandArgs[0])
);
  if (issuedCommand != undefined) {
    return issuedCommand.run(...commandArgs)
  }
}
// Por agora criar um inventário mock que permite apenas eu passar itens
// de uma conta para outra.
// Inventário dicionário com userid do friend e lista com id dos itens
// Criar extensão do Chrome

function getReply(text, friendId64) {
  /** Puxa uma resposta do bot.
  * 
  * @param {string} text - Mensagem enviada pelo usuário
  * @returns {string} - Resposta do bot ou nada
  **/
  if (typeof text !== 'string') {
    return null;
  }
  return handleCommand(text,friendId64)
}

module.exports = { getReply, COMMANDS};
