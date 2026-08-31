'use strict';

require('dotenv').config({ quiet: true });

const path = require('node:path');
const SteamUser = require('steam-user');
const { getReply } = require('./message-handler');

const { STEAM_ACCOUNT_NAME, STEAM_PASSWORD } = process.env;

if (!STEAM_ACCOUNT_NAME || !STEAM_PASSWORD) {
  console.error(
    'Configure STEAM_ACCOUNT_NAME e STEAM_PASSWORD no arquivo .env antes de iniciar.',
  );
  process.exit(1);
}

const client = new SteamUser({
  autoRelogin: true,
  dataDirectory: path.join(__dirname, '..', 'data'),
});

client.on('loggedOn', () => {
  console.log(`Conectado à Steam como ${client.steamID.getSteamID64()}.`);
  client.setPersona(SteamUser.EPersonaState.Online);
});

client.chat.on('friendMessage', async (incoming) => {
  const friendId = incoming.steamid_friend;
  const friendId64 = friendId.getSteamID64();

  // A Steam recomenda confirmar cada mensagem recebida para não acumular
  // notificações não lidas na conta do bot.
  client.chat.ackFriendMessage(friendId, incoming.server_timestamp);

  const reply = getReply(incoming.message_no_bbcode ?? incoming.message);
  if (!reply) {
    return;
  }

  console.log(`Comando !hello recebido de ${friendId64}.`);

  try {
    await client.chat.sendFriendMessage(friendId, reply);
    console.log(`Resposta enviada para ${friendId64}.`);
  } catch (error) {
    console.error(`Falha ao responder ${friendId64}:`, error.message);
  }
});

client.on('disconnected', (eresult, message) => {
  const reason = SteamUser.EResult[eresult] ?? eresult;
  console.warn(`Desconectado da Steam (${reason})${message ? `: ${message}` : ''}.`);
});

client.on('error', (error) => {
  const result = error.eresult
    ? ` (${SteamUser.EResult[error.eresult] ?? error.eresult})`
    : '';
  console.error(`Erro da Steam${result}:`, error.message);
});

function shutdown(signal) {
  console.log(`Recebido ${signal}; encerrando.`);
  client.logOff();
  process.exit(0);
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

client.logOn({
  accountName: STEAM_ACCOUNT_NAME,
  password: STEAM_PASSWORD,
  machineName: 'steam-hello-bot',
});
