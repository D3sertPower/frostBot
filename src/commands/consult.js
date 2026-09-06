const { quote, code, pre } = require('../chat-format');
const { apiUsers, resetUserToken } = require('./bptoken')

let shouldReturn = false

async function fetchLegacyBPAPI(apikey, sku) {
  let url = 'https://backpack.tf/api/classifieds/listings/snapshot?appid=440'
  url += `&sku=${sku}`
  url += `&token=${apikey}`
  try {
    const response = await fetch(url);
    
    // Check if the response status is OK (200-299)
    if (!response.ok) {
      if (response.status == 401) {
        let toDeleteSteamID = [...apiUsers.entries()].find(([_, val]) => val === apikey)?.[0];
        console.log(toDeleteSteamID)
        resetUserToken(toDeleteSteamID)
        throw new Error('You provided an invalid access token. We resetted it')
      }
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json(); // Parse JSON datada
    return data.listings?.[0]
  } catch (error) {
    console.error('Fetch error:', error);
    console.log(url)
    shouldReturn = true
    return code([
      '❌ Something wrong happend',
      error
    ])
  }
}

function capitalizeSentence(str) {
  return str
    .split(" ")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function invalidItemMessage() {
  return code([
        '🧨 Please type a valid TF2 item.'
      ])
}

module.exports = {
  name: 'tfconsult',
  aliases: ['contf','consultatf'],
  description: 'Returns the best sell offer in backpack.tf for the provided item.',
  async run() {
   const args = Array.from(arguments)
   const requesterSteamID = args.at(-1)
   const splicedArgs = args.slice(1,-1)

   if (!apiUsers.has(requesterSteamID)) {
    return code([
      '🧨 You do not have any backpack.tf access token set.',
      '➡ Setup your access token using !bptoken'
    ])
   }

   let SKU = ''
   let shallowArgs = splicedArgs.slice(0,-1)
   for (const arg of splicedArgs) {
    if (typeof(arg) != "string") {
      return invalidItemMessage()
    }
    SKU += capitalizeSentence(arg)
    if (shallowArgs.includes(arg)) {
      SKU += '%20'
    }
   }
   let resp = await fetchLegacyBPAPI(apiUsers.get(requesterSteamID), SKU)
   let details = resp?.details
   let traderSteamID = resp?.steamid

   if (JSON.stringify(traderSteamID) == undefined && shouldReturn == true) {
    shouldReturn = false
    return resp
   }

   if (JSON.stringify(traderSteamID) == undefined && shouldReturn == false) {
    return invalidItemMessage()
   }

   traderSteamID = JSON.stringify(traderSteamID).replace(/"/g, "");
   return `https://steamcommunity.com/profiles/${traderSteamID} 
   ${details}
   `
  }
}
