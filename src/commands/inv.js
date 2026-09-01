const INVENTORY = new Map([
    ['76561198874586215', ['The Frosty Ban Hammer', 'Empty Water Bottle']]
])
const { getCurrentInteraction } = require('../interactions');
// TODO: O INVENTÁRIO É CARREGADO DE UM BANCO DE DADOS REAL
function updateInventory(steamId, item=[], alreadyExists=false) {
    /**Função para criar/atualizar um inventário
     * Se não houver inventário para o usuário, é criado um.
     * Para atualizar o inventário, deve-se indicar que o inv já existe
     * 
     * @param {string} steamID - SteamId64 do usuário
     * @param {array|string} item - itens (vazio na inicialização) ou item a ser adicionado 
     * @param {boolean} alreadyExists - Este usuário já tem um inventário? 
     * @returns {void} - A função apenas atualiza os inventários, não há retornos.
     */
    if (alreadyExists) {
        var inv = INVENTORY.get(steamId)
        inv.push(item)
        INVENTORY.set(steamId, inv)
        console.log(INVENTORY)
        return
     }
    INVENTORY.set(steamId,item)
    console.log(`Inventário atualizado para o usuário ${steamId}`)
    console.log(INVENTORY.get(steamId))
}


function spyInventory(steamId, isSelf=false) {
    var inv = INVENTORY.get(steamId)
    const returnType = getCurrentInteraction()?.metadata?.returnType;

    if (returnType === 'raw') {
        return inv ? [...inv] : [];
    }

    var invMessage = "Inventory: "
    if (isSelf) {invMessage = "Your inventory: "}
    if (inv != undefined) {
        inv.forEach(item => {
        invMessage = invMessage + '\n' + item
    })
    } else {
        return 'There is nothing in this inventory.'
    }
    return invMessage;
}

module.exports = {
  name: 'inventory',
  aliases: ['i','inv','inventario'],
  args: ['(friend name) or (friend steam id)'],
  description: 'See your inventory or someone else\'s inventory',
  run() {
    if (!(isNaN(arguments[1])) && (arguments.length > 2)) {
    var steamID = arguments[1]
    return spyInventory(steamID)
    }
    else {
    // Pequena gambiarra porque não é possível usar o método at direto em arguments:
    const hackArray = Array.from(arguments)
    var friendSteamID = hackArray.at(-1)
    var steamID = friendSteamID
    return spyInventory(steamID, true)
    }
  },
  updateInventory,
  spyInventory
}
