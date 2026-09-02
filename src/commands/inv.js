const INVENTORY = new Map([
    ['76561198874586215', ['The Frosty Ban Hammer', 'Empty Water Bottle']]
])
const INVENTORY_RESERVATIONS = new Map()
const { getCurrentInteraction } = require('../interactions');
const { pre, quote } = require('../chat-format');
const {
    configureSteamClient,
    normalizeFriendName,
    personaNameFor,
    resolveFriendsByName,
} = require('../steam-friends');
const pendingFriendSelections = new Map()

function friendSelectionMessage(candidates, prefix = '') {
    return pre([
        prefix || '🔎 I found more than one matching Steam friend:',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        ...candidates.map(
            (candidate, index) => `${index + 1}. 👤 ${candidate.name}`
        ),
        '',
        '🔢 Reply with the matching number or full name.',
        '🛑 Reply "cancel" to stop.',
    ])
}

function getInventory(steamId) {
    return [...(INVENTORY.get(String(steamId)) ?? [])]
}

function setInventory(steamId, items=[]) {
    INVENTORY.set(String(steamId), [...items])
}

function addInventoryItem(steamId, item) {
    const inventory = getInventory(steamId)
    inventory.push(item)
    setInventory(steamId, inventory)
}

function getReservations(steamId) {
    return Array.from(INVENTORY_RESERVATIONS.values()).filter(
        reservation => reservation.steamId === String(steamId)
    )
}

function getAvailableInventory(steamId) {
    const available = getInventory(steamId)

    for (const reservation of getReservations(steamId)) {
        const itemIndex = available.findIndex(
            item => item.toLowerCase() === reservation.item.toLowerCase()
        )

        if (itemIndex !== -1) {
            available.splice(itemIndex, 1)
        }
    }

    return available
}

function reserveInventoryItem(steamId, requestedItem, offerId) {
    const normalizedItem = String(requestedItem).trim().toLowerCase()
    const item = getAvailableInventory(steamId).find(
        inventoryItem => inventoryItem.toLowerCase() === normalizedItem
    )

    if (!item) {
        return null
    }

    INVENTORY_RESERVATIONS.set(String(offerId), {
        offerId: String(offerId),
        steamId: String(steamId),
        item,
    })
    return item
}

function releaseInventoryReservation(offerId) {
    return INVENTORY_RESERVATIONS.delete(String(offerId))
}

function transferReservedInventoryItem(offerId, toSteamId) {
    const reservation = INVENTORY_RESERVATIONS.get(String(offerId))
    if (!reservation) {
        return false
    }

    const sourceInventory = getInventory(reservation.steamId)
    const itemIndex = sourceInventory.findIndex(
        item => item.toLowerCase() === reservation.item.toLowerCase()
    )

    if (itemIndex === -1) {
        return false
    }

    const [item] = sourceInventory.splice(itemIndex, 1)
    const targetInventory = getInventory(toSteamId)
    targetInventory.push(item)

    setInventory(reservation.steamId, sourceInventory)
    setInventory(toSteamId, targetInventory)
    INVENTORY_RESERVATIONS.delete(String(offerId))
    return true
}

function clearInventoryReservations() {
    INVENTORY_RESERVATIONS.clear()
}

function transferInventoryItem(fromSteamId, toSteamId, requestedItem) {
    const sourceInventory = getInventory(fromSteamId)
    const normalizedItem = String(requestedItem).trim().toLowerCase()
    const itemIndex = sourceInventory.findIndex(
        item => item.toLowerCase() === normalizedItem
    )

    if (itemIndex === -1) {
        return false
    }

    const [item] = sourceInventory.splice(itemIndex, 1)
    const targetInventory = getInventory(toSteamId)
    targetInventory.push(item)

    setInventory(fromSteamId, sourceInventory)
    setInventory(toSteamId, targetInventory)
    return true
}

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


function spyInventory(steamId, isSelf=false, ownerName='') {
    var inv = INVENTORY.get(steamId)
    const returnType = getCurrentInteraction()?.metadata?.returnType;

    if (returnType === 'raw') {
        return inv ? [...inv] : [];
    }

    if (returnType === 'available') {
        return getAvailableInventory(steamId);
    }

    const title = isSelf
        ? '🎒 YOUR INVENTORY'
        : `🔎 ${ownerName ? `${ownerName.toUpperCase()}’S ` : ''}INVENTORY`;
    if (inv != undefined) {
        const remainingReservations = getReservations(steamId)
        let displayedPendingCount = 0
        const itemLines = inv.map((item, index) => {
          const reservationIndex = remainingReservations.findIndex(
            reservation => reservation.item.toLowerCase() === item.toLowerCase()
          )

          if (reservationIndex !== -1) {
            remainingReservations.splice(reservationIndex, 1)
            displayedPendingCount += 1
            return `${index + 1}. 🔒 ${item} — pending offer`
          }

          return `${index + 1}. 📦 ${item} — available`
        })
        const pendingCount = displayedPendingCount
        const availableCount = inv.length - pendingCount

        return pre([
          `${title} ❄️`,
          '━━━━━━━━━━━━━━━━━━━━',
          ...itemLines,
          '',
          `✅ Available: ${availableCount}`,
          `🔒 Pending offers: ${pendingCount}`,
        ]);
    } else {
        return quote(
          ownerName
            ? `📭 ${ownerName}’s inventory is empty—nothing but cold air here. ❄️`
            : '📭 This inventory is empty—nothing but cold air here. ❄️'
        )
    }
}

async function continueFriendSelection(text, requesterSteamId) {
    const requesterKey = String(requesterSteamId)
    const pending = pendingFriendSelections.get(requesterKey)
    if (!pending) {
        return null
    }

    const response = String(text).trim()
    if (normalizeFriendName(response) === 'cancel') {
        pendingFriendSelections.delete(requesterKey)
        return quote('🛑 Inventory lookup cancelled. ❄️')
    }

    let selected = null
    if (/^\d+$/.test(response)) {
        selected = pending.candidates[Number(response) - 1] ?? null
    } else {
        const matches = pending.candidates.filter(
            candidate => normalizeFriendName(candidate.name) === normalizeFriendName(response)
        )
        selected = matches.length === 1 ? matches[0] : null
    }

    if (!selected) {
        return friendSelectionMessage(
            pending.candidates,
            '🧩 That did not identify one friend. Choose from this list:',
        )
    }

    pendingFriendSelections.delete(requesterKey)
    return spyInventory(selected.steamID64, false, selected.name)
}

module.exports = {
  name: 'inventory',
  aliases: ['i','inv','inventario'],
  args: ['[friend name]'],
  description: 'See your inventory or another Steam friend\'s inventory, including pending-offer locks.',
  async run() {
    const args = Array.from(arguments)
    const requesterSteamId = String(args.at(-1) ?? '')
    const friendQuery = args.slice(1, -1).join(' ').trim()

    if (!friendQuery) {
      return spyInventory(requesterSteamId, true)
    }

    if (/^\d{17}$/.test(friendQuery)) {
      const ownerName = personaNameFor(friendQuery)
      return spyInventory(friendQuery, false, ownerName)
    }

    const candidates = await resolveFriendsByName(friendQuery, requesterSteamId)
    if (candidates.length === 0) {
      return quote([
        `🔍 I could not find a Steam friend matching “${friendQuery}”.`,
        '💡 Use their current persona name and try again.',
      ])
    }

    if (candidates.length > 1) {
      pendingFriendSelections.set(requesterSteamId, { candidates })
      return friendSelectionMessage(candidates)
    }

    return spyInventory(candidates[0].steamID64, false, candidates[0].name)
  },
  configureSteamClient,
  continue: continueFriendSelection,
  hasPending(steamId) {
    return pendingFriendSelections.has(String(steamId))
  },
  updateInventory,
  spyInventory,
  addInventoryItem,
  clearInventoryReservations,
  getAvailableInventory,
  getInventory,
  getReservations,
  releaseInventoryReservation,
  reserveInventoryItem,
  setInventory,
  transferInventoryItem,
  transferReservedInventoryItem,
  _test: {
    pendingFriendSelections,
    resolveFriendsByName,
  }
}
