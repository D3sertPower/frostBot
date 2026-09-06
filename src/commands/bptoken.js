const fs = require('fs')
const apiUsers = new Map([])
const { pre } = require('../chat-format')
try {
  const apiKeys = fs.readFileSync('./data/apikeys.json', 'utf-8')
  var apiData = JSON.parse(apiKeys)
  Object.entries(apiData).forEach(([steamID, apiKey]) => {
    apiUsers.set(steamID, apiKey)
  });

} catch (error) {

  console.error('Error:', error);
}

function writeKeys() {
  let apiUsersJson = JSON.stringify(Object.fromEntries(apiUsers), null, 2)
   fs.writeFileSync('./data/apikeys.json', apiUsersJson, 'utf-8')
}

function resetUserToken(steamid) {
  apiUsers.delete(steamid)
  writeKeys()
}

module.exports = {
  name: 'bptoken',
  description: 'Setup your backpack.tf token.',
  aliases: [],
  async run() {
   const args = Array.from(arguments)
   const requesterSteamID = args.at(-1)
   const splicedArgs = args.slice(1,-1)

   if (splicedArgs.length > 1) {
    return
   }

   if (splicedArgs.length == 0) {
   return `https://next.backpack.tf/account/api-access - log in on your steam, get an access token.
   
   Type !bptoken {accesstoken} to add your bp token.
   `
   }
   apiUsers.set(requesterSteamID, splicedArgs[0])
   writeKeys()
   return pre([
    '✅ Access token added'
   ])
  },
  apiUsers, resetUserToken
}
