'use strict';

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
const INVENTORY_PAGE_SIZE = 2000;
const MAX_INVENTORY_PAGES = 20;
const SELECTION_TTL_MS = 5 * 60 * 1000;
const STEAM_ID64_BASE = 76561197960265728n;

const pendingSelections = new Map();
const pendingDeposits = new Map();

let steamClient = null;
let fetchImpl = globalThis.fetch;
let webApiKey = null;
let webSession = null;
let sessionListener = null;
let disconnectedListener = null;
let inventoryChangedListener = null;
let reconcilePromise = null;

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

  if (options.fetchImpl !== undefined) {
    if (typeof options.fetchImpl !== 'function') {
      throw new TypeError('fetchImpl must be a function.');
    }
    fetchImpl = options.fetchImpl;
  } else {
    fetchImpl = globalThis.fetch;
  }

  webApiKey = options.webApiKey ?? process.env.STEAM_WEB_API_KEY ?? null;

  if (steamClient && typeof steamClient.removeListener === 'function') {
    steamClient.removeListener('webSession', sessionListener);
    steamClient.removeListener('disconnected', disconnectedListener);
    steamClient.removeListener('newItems', inventoryChangedListener);
    steamClient.removeListener('tradeOffers', inventoryChangedListener);
  }

  steamClient = client;
  webSession = null;
  sessionListener = (sessionID, cookies) => {
    webSession = {
      sessionID,
      cookies: Array.isArray(cookies) ? [...cookies] : [],
    };
  };
  disconnectedListener = () => {
    webSession = null;
  };
  inventoryChangedListener = () => {
    void reconcilePendingDeposits().catch((error) => {
      console.warn(`Could not reconcile Steam deposits: ${error.message}`);
    });
  };

  steamClient.on('webSession', sessionListener);
  steamClient.on('disconnected', disconnectedListener);
  steamClient.on('newItems', inventoryChangedListener);
  steamClient.on('tradeOffers', inventoryChangedListener);
}

function requireWebSession() {
  if (!steamClient || !webSession || typeof fetchImpl !== 'function') {
    throw new DepositError(
      'WEB_SESSION_NOT_READY',
      'The Steam web session is not ready yet. Please try again shortly.',
    );
  }

  return webSession;
}

function cookieHeader(session) {
  return session.cookies
    .map((cookie) => cookie.split(';', 1)[0])
    .join('; ');
}

async function readJsonResponse(response, operation) {
  let body;

  try {
    body = await response.json();
  } catch {
    throw new DepositError(
      'INVALID_STEAM_RESPONSE',
      `Steam returned an invalid response while ${operation}.`,
    );
  }

  if (!response.ok) {
    const detail = body?.strError || body?.error || `HTTP ${response.status}`;
    throw new DepositError(
      'STEAM_REQUEST_FAILED',
      `Steam rejected the request while ${operation}: ${detail}`,
    );
  }

  return body;
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

async function readTradeOfferState(tradeOfferID) {
  const url = new URL(
    'https://api.steampowered.com/IEconService/GetTradeOffer/v1/',
  );
  url.searchParams.set('key', webApiKey);
  url.searchParams.set('tradeofferid', tradeOfferID);
  url.searchParams.set('language', 'english');

  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
  });
  const body = await readJsonResponse(response, 'checking a deposit offer');
  return Number(body.response?.offer?.trade_offer_state ?? 0);
}

async function reconcilePendingDeposits() {
  if (!webApiKey || pendingDeposits.size === 0) {
    return { checked: 0, credited: 0 };
  }

  if (reconcilePromise) {
    return reconcilePromise;
  }

  reconcilePromise = (async () => {
    let checked = 0;
    let credited = 0;
    const terminalFailureStates = new Set([4, 5, 6, 7, 8, 10]);

    for (const deposit of pendingDeposits.values()) {
      if (deposit.status !== 'pending') {
        continue;
      }

      const state = await readTradeOfferState(deposit.tradeOfferID);
      checked += 1;

      if (state === 3) {
        for (let index = 0; index < deposit.quantity; index += 1) {
          addInventoryItem(deposit.steamID64, deposit.itemName);
        }

        deposit.status = 'credited';
        deposit.creditedAt = new Date();
        credited += 1;
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
      } else if (terminalFailureStates.has(state)) {
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
    }

    return { checked, credited };
  })();

  try {
    return await reconcilePromise;
  } finally {
    reconcilePromise = null;
  }
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
  const session = requireWebSession();
  const assets = [];
  const descriptions = new Map();
  let startAssetID = null;

  for (let page = 0; page < MAX_INVENTORY_PAGES; page += 1) {
    const url = new URL(
      `https://steamcommunity.com/inventory/${steamID64}/${inventoryType.appid}/${inventoryType.contextid}`,
    );
    url.searchParams.set('l', 'english');
    url.searchParams.set('count', String(INVENTORY_PAGE_SIZE));
    if (startAssetID) {
      url.searchParams.set('start_assetid', startAssetID);
    }

    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/json',
        Cookie: cookieHeader(session),
      },
    });
    const body = await readJsonResponse(
      response,
      `reading your ${inventoryType.label} inventory`,
    );

    if (body.success !== 1 && body.success !== true) {
      throw new DepositError(
        'INVENTORY_UNAVAILABLE',
        `Steam could not read your ${inventoryType.label} inventory. Make sure the bot can view it and try again.`,
      );
    }

    assets.push(...(body.assets ?? []));
    for (const description of body.descriptions ?? []) {
      descriptions.set(
        `${description.classid}_${description.instanceid ?? '0'}`,
        description,
      );
    }

    if (!body.more_items) {
      break;
    }

    const nextAssetID = String(body.last_assetid ?? '');
    if (!nextAssetID || nextAssetID === startAssetID) {
      throw new DepositError(
        'INVENTORY_PAGINATION_FAILED',
        'Steam returned an incomplete inventory. Please try again.',
      );
    }
    startAssetID = nextAssetID;

    if (page === MAX_INVENTORY_PAGES - 1) {
      throw new DepositError(
        'INVENTORY_TOO_LARGE',
        `The ${inventoryType.label} inventory is too large to process safely.`,
      );
    }
  }

  return assets.flatMap((asset) => {
    const description = descriptions.get(
      `${asset.classid}_${asset.instanceid ?? '0'}`,
    );

    const name = description?.market_hash_name || description?.name;
    if (
      !name ||
      (description.tradable !== 1 && description.tradable !== true)
    ) {
      return [];
    }

    return [{
      appid: Number(asset.appid ?? inventoryType.appid),
      contextid: String(asset.contextid ?? inventoryType.contextid),
      assetid: String(asset.assetid),
      amount: Math.max(1, Number(asset.amount) || 1),
      name,
    }];
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

function accountIDFromSteamID64(steamID64) {
  try {
    const accountID = BigInt(steamID64) - STEAM_ID64_BASE;
    return accountID >= 0n ? accountID.toString() : String(steamID64);
  } catch {
    return String(steamID64);
  }
}

async function sendDepositOffer(steamID64, group, quantity, inventoryType) {
  const session = requireWebSession();
  const requestedAssets = chooseAssets(group, quantity);
  const partnerAccountID = accountIDFromSteamID64(steamID64);
  const tradeOffer = {
    newversion: true,
    version: requestedAssets.length + 1,
    me: { assets: [], currency: [], ready: false },
    them: { assets: requestedAssets, currency: [], ready: false },
  };
  const form = new URLSearchParams({
    sessionid: session.sessionID,
    serverid: '1',
    partner: String(steamID64),
    tradeoffermessage: `❄️ FrostBot deposit • ${inventoryType.label} • ${quantity} x ${group.name}`,
    json_tradeoffer: JSON.stringify(tradeOffer),
    captcha: '',
    trade_offer_create_params: '{}',
  });

  const response = await fetchImpl(
    'https://steamcommunity.com/tradeoffer/new/send',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Cookie: cookieHeader(session),
        Origin: 'https://steamcommunity.com',
        Referer: `https://steamcommunity.com/tradeoffer/new/?partner=${partnerAccountID}`,
      },
      body: form,
    },
  );
  const body = await readJsonResponse(response, 'sending the trade offer');

  if (!body.tradeofferid) {
    throw new DepositError(
      'TRADE_OFFER_REJECTED',
      `Steam did not create the trade offer${body.strError ? `: ${body.strError}` : '.'}`,
    );
  }

  return {
    id: String(body.tradeofferid),
    needsConfirmation: Boolean(
      body.needs_mobile_confirmation || body.needs_email_confirmation,
    ),
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
  if (!webApiKey) {
    throw new DepositError(
      'DEPOSIT_TRACKING_UNAVAILABLE',
      'Deposit tracking is not configured. The bot operator must set STEAM_WEB_API_KEY.',
    );
  }

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
    reconcilePendingDeposits,
    resolveInventoryChoice,
  },
};
