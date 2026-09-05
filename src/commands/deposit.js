'use strict';

const TradeOfferManager = require('steam-tradeoffer-manager');
const { code, pre, quote } = require('../chat-format');
const { addInventoryItem } = require('./inv');

const INVENTORIES = Object.freeze([
  Object.freeze({
    key: 'steam',
    label: 'Steam Community',
    appid: 753,
    contextid: '6',
    aliases: ['steam', 'steam community', 'community'],
  }),
  Object.freeze({
    key: 'tf2',
    label: 'Team Fortress 2 (TF2)',
    appid: 440,
    contextid: '2',
    aliases: ['tf2', 'team fortress 2', 'team fortress'],
  }),
  Object.freeze({
    key: 'cs2',
    label: 'Counter-Strike 2 (CS2)',
    appid: 730,
    contextid: '2',
    aliases: [
      'cs2',
      'csgo',
      'counter strike 2',
      'counter strike',
      'counter strike global offensive',
    ],
  }),
]);
const SELECTION_TTL_MS = 5 * 60 * 1000;
const { ETradeOfferState } = TradeOfferManager;
const CLOSED_OFFER_STATES = new Set([
  ETradeOfferState.Countered,
  ETradeOfferState.Expired,
  ETradeOfferState.Canceled,
  ETradeOfferState.Declined,
  ETradeOfferState.InvalidItems,
  ETradeOfferState.CanceledBySecondFactor,
]);

const pendingSelections = new Map();
const pendingDeposits = new Map();

let steamClient = null;
let tradeManager = null;
let managerReady = false;
let sessionListener = null;
let disconnectedListener = null;
let sentOfferChangedListener = null;
let sessionExpiredListener = null;

class DepositError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DepositError';
    this.code = code;
  }
}

function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function nameMatches(itemName, query) {
  const normalizedName = normalizeName(itemName);
  const normalizedQuery = normalizeName(query);

  if (!normalizedQuery) {
    return false;
  }

  if (normalizedName.includes(normalizedQuery)) {
    return true;
  }

  const nameWords = normalizedName.split(' ');
  const queryWords = normalizedQuery.split(' ');
  let nameIndex = 0;

  return queryWords.every((queryWord) => {
    while (
      nameIndex < nameWords.length &&
      !nameWords[nameIndex].startsWith(queryWord)
    ) {
      nameIndex += 1;
    }

    if (nameIndex === nameWords.length) {
      return false;
    }

    nameIndex += 1;
    return true;
  });
}

function parseRequest(tokens) {
  const parts = tokens.map((part) => String(part).trim()).filter(Boolean);

  if (parts.length === 0) {
    return { quantity: 1, itemQuery: '' };
  }

  const integerPattern = /^[+-]?\d+$/;
  let quantity = 1;

  if (integerPattern.test(parts[0])) {
    quantity = Number(parts.shift());
  } else if (parts.length > 1 && integerPattern.test(parts.at(-1))) {
    quantity = Number(parts.pop());
  }

  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new DepositError(
      'INVALID_QUANTITY',
      'Quantity must be a positive whole number.',
    );
  }

  return {
    quantity,
    itemQuery: parts.join(' ').trim(),
  };
}

function resolveInventoryChoice(value) {
  const normalizedValue = normalizeName(value);

  if (/^\d+$/.test(normalizedValue)) {
    return INVENTORIES[Number(normalizedValue) - 1] ?? null;
  }

  return INVENTORIES.find((inventory) =>
    inventory.aliases.some(
      (alias) => normalizeName(alias) === normalizedValue,
    ),
  ) ?? null;
}

function configureSteamClient(client, options = {}) {
  if (!client || typeof client.on !== 'function') {
    throw new TypeError('A Steam client with event support is required.');
  }

  if (steamClient && typeof steamClient.removeListener === 'function') {
    steamClient.removeListener('webSession', sessionListener);
    steamClient.removeListener('disconnected', disconnectedListener);
  }
  if (tradeManager && typeof tradeManager.removeListener === 'function') {
    tradeManager.removeListener('sentOfferChanged', sentOfferChangedListener);
    tradeManager.removeListener('sessionExpired', sessionExpiredListener);
  }

  steamClient = client;
  tradeManager = options.manager ?? new TradeOfferManager({
    steam: client,
    language: 'en',
    dataDirectory: null,
  });

  if (
    typeof tradeManager.setCookies !== 'function' ||
    typeof tradeManager.getUserInventoryContents !== 'function' ||
    typeof tradeManager.createOffer !== 'function' ||
    typeof tradeManager.on !== 'function'
  ) {
    throw new TypeError('A compatible Steam trade-offer manager is required.');
  }

  managerReady = false;
  sessionListener = (_sessionID, cookies) => {
    managerReady = false;
    tradeManager.setCookies(cookies, (error) => {
      if (error) {
        console.warn(`Could not initialize Steam trade offers: ${error.message}`);
        return;
      }
      managerReady = true;
    });
  };
  disconnectedListener = () => {
    managerReady = false;
  };
  sentOfferChangedListener = (offer) => {
    void handleSentOfferChanged(offer).catch((error) => {
      console.warn(`Could not update Steam deposit #${offer?.id}: ${error.message}`);
    });
  };
  sessionExpiredListener = () => {
    managerReady = false;
    if (typeof steamClient.webLogOn === 'function') {
      steamClient.webLogOn();
    }
  };

  steamClient.on('webSession', sessionListener);
  steamClient.on('disconnected', disconnectedListener);
  tradeManager.on('sentOfferChanged', sentOfferChangedListener);
  tradeManager.on('sessionExpired', sessionExpiredListener);
}

function requireTradeManager() {
  if (!steamClient || !tradeManager || !managerReady) {
    throw new DepositError(
      'WEB_SESSION_NOT_READY',
      'The Steam web session is not ready yet. Please try again shortly.',
    );
  }

  return tradeManager;
}

async function notifyDepositOwner(steamID64, message) {
  if (!steamClient?.chat || typeof steamClient.chat.sendFriendMessage !== 'function') {
    return;
  }

  try {
    await steamClient.chat.sendFriendMessage(steamID64, message);
  } catch (error) {
    console.warn(`Could not notify depositor ${steamID64}: ${error.message}`);
  }
}

async function handleSentOfferChanged(offer) {
  const deposit = pendingDeposits.get(String(offer?.id ?? ''));
  if (!deposit || deposit.status !== 'pending') {
    return false;
  }

  if (offer.state === ETradeOfferState.Accepted) {
    for (let index = 0; index < deposit.quantity; index += 1) {
      addInventoryItem(deposit.steamID64, deposit.itemName);
    }

    deposit.status = 'credited';
    deposit.creditedAt = new Date();
    await notifyDepositOwner(
      deposit.steamID64,
      pre([
        '✅ DEPOSIT ACCEPTED AND CREDITED ❄️',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `📦 Added: ${deposit.quantity} x ${deposit.itemName}`,
        '🎒 Added to your internal inventory.',
        `🧾 Steam offer: #${deposit.tradeOfferID}`,
        '🚀 The item is now available through !sendoffer.',
      ]),
    );
    return true;
  }

  if (CLOSED_OFFER_STATES.has(offer.state)) {
    deposit.status = 'closed';
    deposit.closedAt = new Date();
    await notifyDepositOwner(
      deposit.steamID64,
      quote([
        '❌ Your Steam deposit offer closed without being credited.',
        `🧾 Steam offer: #${deposit.tradeOfferID}`,
        '🔒 No item was added to the internal inventory.',
      ]),
    );
  }

  return false;
}

function trackPendingDeposit(steamID64, group, quantity, inventoryType, offer) {
  pendingDeposits.set(offer.id, {
    tradeOfferID: offer.id,
    steamID64,
    itemName: group.name,
    quantity,
    inventoryKey: inventoryType.key,
    status: 'pending',
    createdAt: new Date(),
  });
}

async function fetchInventory(steamID64, inventoryType) {
  const manager = requireTradeManager();

  return new Promise((resolve, reject) => {
    manager.getUserInventoryContents(
      steamID64,
      inventoryType.appid,
      inventoryType.contextid,
      true,
      (error, inventory = []) => {
        if (error) {
          reject(new DepositError(
            'INVENTORY_UNAVAILABLE',
            `Steam could not read your ${inventoryType.label} inventory: ${error.message}`,
          ));
          return;
        }

        resolve(inventory.flatMap((item) => {
          const name = item.market_hash_name || item.name;
          if (!name) {
            return [];
          }

          return [{
            appid: Number(item.appid ?? inventoryType.appid),
            contextid: String(item.contextid ?? inventoryType.contextid),
            assetid: String(item.assetid ?? item.id),
            amount: Math.max(1, Number(item.amount) || 1),
            name,
          }];
        }));
      },
    );
  });
}

function groupMatchingItems(inventory, itemQuery) {
  const exactMatches = inventory.filter(
    (item) => normalizeName(item.name) === normalizeName(itemQuery),
  );
  const matchingAssets = exactMatches.length > 0
    ? exactMatches
    : inventory.filter((item) => nameMatches(item.name, itemQuery));
  const groups = new Map();

  for (const item of matchingAssets) {
    const key = normalizeName(item.name);
    const group = groups.get(key) ?? {
      name: item.name,
      assets: [],
      available: 0,
    };
    group.assets.push(item);
    group.available += item.amount;
    groups.set(key, group);
  }

  return Array.from(groups.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function chooseAssets(group, quantity) {
  const chosen = [];
  let remaining = quantity;

  for (const asset of group.assets) {
    if (remaining === 0) {
      break;
    }

    const amount = Math.min(asset.amount, remaining);
    chosen.push({
      appid: asset.appid,
      contextid: asset.contextid,
      assetid: asset.assetid,
      amount: String(amount),
    });
    remaining -= amount;
  }

  if (remaining > 0) {
    throw new DepositError(
      'INSUFFICIENT_QUANTITY',
      `You only have ${group.available} tradable ${group.name}${group.available === 1 ? '' : 's'}.`,
    );
  }

  return chosen;
}

async function sendDepositOffer(steamID64, group, quantity, inventoryType) {
  const manager = requireTradeManager();
  const requestedAssets = chooseAssets(group, quantity);

  let offer;
  try {
    offer = manager.createOffer(steamID64);
    const addedCount = offer.addTheirItems(requestedAssets);
    if (addedCount !== requestedAssets.length) {
      throw new Error('Some requested assets could not be added to the offer.');
    }
    offer.setMessage(
      `❄️ FrostBot deposit • ${inventoryType.label} • ${quantity} x ${group.name}`,
    );
  } catch (error) {
    throw new DepositError(
      'TRADE_OFFER_INVALID',
      `The Steam trade offer could not be prepared: ${error.message}`,
    );
  }

  const status = await new Promise((resolve, reject) => {
    offer.send((error, result) => {
      if (error) {
        reject(new DepositError(
          'TRADE_OFFER_REJECTED',
          `Steam did not create the trade offer: ${error.message}`,
        ));
        return;
      }
      resolve(result);
    });
  });

  return {
    id: String(offer.id),
    needsConfirmation: status === 'pending' ||
      offer.state === ETradeOfferState.CreatedNeedsConfirmation,
  };
}

function selectionMessage(matches, quantity, prefix = '') {
  const lines = matches.map(
    (match, index) =>
      `${index + 1}. 📦 ${match.name} • ${match.available} tradable available`,
  );

  return pre([
    prefix || '🔍 I found more than one matching item:',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...lines,
    '',
    `🔢 Reply with an index or more of the item name to deposit ${quantity}.`,
    '🛑 Reply "cancel" to stop.',
  ]);
}

function inventorySelectionMessage(quantity, itemQuery, prefix = '') {
  return pre([
    prefix || `🧭 Which inventory should I use for ${quantity} x ${itemQuery}?`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    ...INVENTORIES.map(
      (inventory, index) => `${index + 1}. 🎒 ${inventory.label}`,
    ),
    '',
    '🔢 Reply with an index or inventory name.',
    '🛑 Reply "cancel" to stop.',
  ]);
}

function successMessage(group, quantity, offer, inventoryType) {
  const lines = [
    '✅ DEPOSIT OFFER SENT ❄️',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    `🧾 Trade offer: #${offer.id}`,
    `📦 Requested: ${quantity} x ${group.name}`,
    `🎒 Inventory: ${inventoryType.label}`,
    '🔄 Ledger: credits automatically after Steam acceptance.',
  ];

  if (offer.needsConfirmation) {
    lines.push('⏳ Status: awaiting confirmation on the bot account.');
  } else {
    lines.push('🚀 Status: ready—open Steam to review and accept it!');
  }

  return pre(lines);
}

function friendlyError(error) {
  if (error instanceof DepositError) {
    return quote([
      '❌ DEPOSIT COULD NOT BE COMPLETED',
      `🧊 ${error.message}`,
      '🔄 Check the details and try again.',
    ]);
  }

  return quote([
    '💥 Something unexpected interrupted the deposit.',
    `🧩 ${error.message}`,
    '🔄 Please try again in a moment.',
  ]);
}

function beginDeposit(steamID64, itemQuery, quantity) {
  pendingSelections.delete(steamID64);
  pendingSelections.set(steamID64, {
    stage: 'inventory',
    createdAt: Date.now(),
    itemQuery,
    quantity,
  });
  return inventorySelectionMessage(quantity, itemQuery);
}

async function depositFromInventory(
  steamID64,
  itemQuery,
  quantity,
  inventoryType,
) {
  const inventory = await fetchInventory(steamID64, inventoryType);

  if (inventory.length === 0) {
    return quote([
      `📭 Your ${inventoryType.label} inventory has no tradable items.`,
      '🧊 Try another inventory or add a tradable item first.',
    ]);
  }

  const matches = groupMatchingItems(inventory, itemQuery);

  if (matches.length === 0) {
    return quote([
      '🔍 No matching tradable item was found. ❌',
      `📦 Search: ${itemQuery}`,
      `🎒 Inventory: ${inventoryType.label}`,
      '💡 Try a shorter or more precise item name.',
    ]);
  }

  if (matches.length === 1) {
    const offer = await sendDepositOffer(
      steamID64,
      matches[0],
      quantity,
      inventoryType,
    );
    trackPendingDeposit(steamID64, matches[0], quantity, inventoryType, offer);
    return successMessage(matches[0], quantity, offer, inventoryType);
  }

  pendingSelections.set(steamID64, {
    stage: 'item',
    createdAt: Date.now(),
    inventoryType,
    itemQuery,
    matches,
    quantity,
  });
  return selectionMessage(matches, quantity);
}

function getPending(steamID64) {
  const pending = pendingSelections.get(steamID64);

  if (pending && Date.now() - pending.createdAt > SELECTION_TTL_MS) {
    pendingSelections.delete(steamID64);
    return null;
  }

  return pending ?? null;
}

async function continueDeposit(text, steamID64) {
  const pending = getPending(steamID64);
  if (!pending) {
    return null;
  }

  const response = String(text).trim();
  if (normalizeName(response) === 'cancel') {
    pendingSelections.delete(steamID64);
    return quote('🛑 Deposit cancelled. No items or offers were changed. ❄️');
  }

  if (pending.stage === 'inventory') {
    const inventoryType = resolveInventoryChoice(response);
    if (!inventoryType) {
      return inventorySelectionMessage(
        pending.quantity,
        pending.itemQuery,
        '❓ I did not recognize that inventory. Choose one of these:',
      );
    }

    pendingSelections.delete(steamID64);

    try {
      return await depositFromInventory(
        steamID64,
        pending.itemQuery,
        pending.quantity,
        inventoryType,
      );
    } catch (error) {
      return friendlyError(error);
    }
  }

  let narrowedMatches;
  if (/^\d+$/.test(response)) {
    const match = pending.matches[Number(response) - 1];
    narrowedMatches = match ? [match] : [];
  } else {
    narrowedMatches = groupMatchingItems(
      pending.matches.flatMap((match) => match.assets),
      response,
    );

    if (narrowedMatches.length === 0) {
      narrowedMatches = groupMatchingItems(
        pending.matches.flatMap((match) => match.assets),
        `${pending.itemQuery} ${response}`,
      );
    }
  }

  if (narrowedMatches.length !== 1) {
    const matchesToShow = narrowedMatches.length > 1
      ? narrowedMatches
      : pending.matches;

    if (narrowedMatches.length > 1) {
      pending.matches = narrowedMatches;
      pending.itemQuery = `${pending.itemQuery} ${response}`.trim();
    }

    return selectionMessage(
      matchesToShow,
      pending.quantity,
      '🧩 That did not identify one item. Choose from these matches:',
    );
  }

  pendingSelections.delete(steamID64);

  try {
    const offer = await sendDepositOffer(
      steamID64,
      narrowedMatches[0],
      pending.quantity,
      pending.inventoryType,
    );
    trackPendingDeposit(
      steamID64,
      narrowedMatches[0],
      pending.quantity,
      pending.inventoryType,
      offer,
    );
    return successMessage(
      narrowedMatches[0],
      pending.quantity,
      offer,
      pending.inventoryType,
    );
  } catch (error) {
    return friendlyError(error);
  }
}

module.exports = {
  name: 'deposit',
  aliases: ['dep', 'depositar'],
  args: ['<quantity>', '<item name>'],
  description: 'Ask the bot to send a deposit offer for a Steam, TF2, or CS2 item.',

  async run() {
    const args = Array.from(arguments);
    const steamID64 = String(args.at(-1) ?? '');

    if (!steamID64) {
      return quote('🚫 I need a Steam user before I can create a deposit offer. 🧊');
    }

    try {
      const { quantity, itemQuery } = parseRequest(args.slice(1, -1));
      if (!itemQuery) {
        return code([
          '📦 Tell me which item you want to deposit.',
          '🧊 Usage: !deposit <quantity> <item name>',
          '✨ Example: !deposit 2 Mann Co. Supply Crate Key',
        ]);
      }

      return beginDeposit(steamID64, itemQuery, quantity);
    } catch (error) {
      return friendlyError(error);
    }
  },

  configureSteamClient,
  continue: continueDeposit,
  hasPending(steamID64) {
    return Boolean(getPending(steamID64));
  },

  // Exported for focused tests without exposing these as additional commands.
  _test: {
    chooseAssets,
    groupMatchingItems,
    INVENTORIES,
    nameMatches,
    normalizeName,
    parseRequest,
    pendingDeposits,
    pendingSelections,
    handleSentOfferChanged,
    resolveInventoryChoice,
  },
};
