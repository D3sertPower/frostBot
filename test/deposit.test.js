'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { getReply } = require('../src/message-handler');
const deposit = require('../src/commands/deposit');
const { getInventory, setInventory } = require('../src/commands/inv');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function inventoryResponse(items, appid = 440, contextid = '2') {
  return {
    success: 1,
    assets: items.map((item, index) => ({
      appid,
      contextid,
      assetid: String(1000 + index),
      classid: String(2000 + index),
      instanceid: '0',
      amount: String(item.amount ?? 1),
    })),
    descriptions: items.map((item, index) => ({
      classid: String(2000 + index),
      instanceid: '0',
      market_hash_name: item.name,
      tradable: item.tradable ?? 1,
    })),
    more_items: 0,
  };
}

function configureMockSteam(fetchMock) {
  const client = new EventEmitter();
  deposit.configureSteamClient(client, {
    fetchImpl: fetchMock,
    webApiKey: 'test-web-api-key',
  });
  client.emit('webSession', 'session-123', [
    'sessionid=session-123; Path=/',
    'steamLoginSecure=secret; Path=/',
  ]);
}

test('deposit sends an offer after inventory selection for one partial-name match', async () => {
  const calls = [];
  configureMockSteam(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).includes('/inventory/')) {
      return jsonResponse(inventoryResponse([
        { name: 'Mann Co. Supply Crate Key' },
        { name: 'Mann Co. Supply Crate Key' },
        { name: 'Refined Metal' },
      ]));
    }

    return jsonResponse({ tradeofferid: '987654321' });
  });

  const inventoryQuestion = await getReply(
    '!deposit 2 mann co. supp',
    '76561198874586215',
  );

  assert.match(inventoryQuestion, /^\/pre 🧭/);
  assert.match(inventoryQuestion, /Which inventory should I use/i);
  assert.match(inventoryQuestion, /Steam Community/);
  assert.match(inventoryQuestion, /Team Fortress 2/);
  assert.match(inventoryQuestion, /Counter-Strike 2/);
  assert.equal(calls.length, 0, 'no inventory is requested before selection');

  const invalidChoice = await getReply('something else', '76561198874586215');
  assert.match(invalidChoice, /did not recognize that inventory/i);
  assert.equal(calls.length, 0, 'an invalid selection must not request inventory');

  const reply = await getReply('tf2', '76561198874586215');

  assert.match(reply, /^\/pre ✅ DEPOSIT OFFER SENT/);
  assert.match(reply, /Trade offer: #987654321/i);
  assert.match(reply, /2 x Mann Co\. Supply Crate Key/);
  assert.match(reply, /Inventory: Team Fortress 2/);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/inventory\/76561198874586215\/440\/2/);

  const form = calls[1].options.body;
  const offer = JSON.parse(form.get('json_tradeoffer'));
  assert.equal(form.get('partner'), '76561198874586215');
  assert.deepEqual(offer.me.assets, []);
  assert.deepEqual(
    offer.them.assets.map((asset) => asset.assetid),
    ['1000', '1001'],
  );
});

test('deposit waits for an index when partial text matches multiple item types', async () => {
  const calls = [];
  configureMockSteam(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).includes('/inventory/')) {
      return jsonResponse(inventoryResponse([
        { name: 'Mann Co. Supply Crate Key' },
        { name: 'Mann Co. Supply Crate Series #30' },
      ]));
    }

    return jsonResponse({ tradeofferid: '123456789' });
  });

  const steamID64 = '76561198874586216';
  const inventoryQuestion = await getReply('!deposit mann co. supp', steamID64);
  assert.match(inventoryQuestion, /Which inventory should I use/i);
  assert.equal(calls.length, 0);

  const question = await getReply('2', steamID64);

  assert.match(question, /more than one matching item/i);
  assert.match(question, /1\. 📦 Mann Co\. Supply Crate Key/);
  assert.match(question, /2\. 📦 Mann Co\. Supply Crate Series #30/);
  assert.equal(calls.length, 1, 'an ambiguous command must not send an offer');

  const reply = await getReply('2', steamID64);

  assert.match(reply, /Trade offer: #123456789/i);
  assert.match(reply, /Mann Co\. Supply Crate Series #30/);
  assert.equal(calls.length, 2);
});

test('deposit accepts more item-name text to resolve a pending match', async () => {
  const calls = [];
  configureMockSteam(async (url, options = {}) => {
    calls.push({ url: String(url), options });

    if (String(url).includes('/inventory/')) {
      return jsonResponse(inventoryResponse([
        { name: 'Mann Co. Supply Crate Key' },
        { name: 'Mann Co. Supply Crate Series #30' },
      ]));
    }

    return jsonResponse({ tradeofferid: '246813579' });
  });

  const steamID64 = '76561198874586218';
  await getReply('!deposit mann co. supp', steamID64);
  await getReply('Team Fortress 2', steamID64);
  const reply = await getReply('crate key', steamID64);

  assert.match(reply, /Trade offer: #246813579/i);
  assert.match(reply, /Mann Co\. Supply Crate Key/);
  assert.equal(calls.length, 2);
});

test('deposit validates quantities before calling Steam', async () => {
  let called = false;
  configureMockSteam(async () => {
    called = true;
    throw new Error('should not be called');
  });

  const reply = await getReply(
    '!deposit 0 Mann Co. Supply Crate Key',
    '76561198874586217',
  );

  assert.match(reply, /^\/quote ❌/);
  assert.match(reply, /Quantity must be a positive whole number/);
  assert.equal(called, false);
});

for (const scenario of [
  {
    choice: 'steam',
    appid: 753,
    contextid: '6',
    item: 'Steam Gems',
    steamID64: '76561198874586219',
  },
  {
    choice: 'cs2',
    appid: 730,
    contextid: '2',
    item: 'Fracture Case',
    steamID64: '76561198874586220',
  },
]) {
  test(`deposit reads only the selected ${scenario.choice} inventory`, async () => {
    const calls = [];
    configureMockSteam(async (url, options = {}) => {
      calls.push({ url: String(url), options });

      if (String(url).includes('/inventory/')) {
        return jsonResponse(inventoryResponse(
          [{ name: scenario.item }],
          scenario.appid,
          scenario.contextid,
        ));
      }

      return jsonResponse({ tradeofferid: `${scenario.appid}123` });
    });

    await getReply(`!deposit ${scenario.item}`, scenario.steamID64);
    assert.equal(calls.length, 0);

    const reply = await getReply(scenario.choice, scenario.steamID64);

    assert.match(reply, new RegExp(`Trade offer: #${scenario.appid}123`, 'i'));
    assert.match(
      calls[0].url,
      new RegExp(`/inventory/${scenario.steamID64}/${scenario.appid}/${scenario.contextid}`),
    );

    const offer = JSON.parse(calls[1].options.body.get('json_tradeoffer'));
    assert.equal(offer.them.assets[0].appid, scenario.appid);
    assert.equal(offer.them.assets[0].contextid, scenario.contextid);
  });
}

test('accepted Steam deposits are credited once to the internal inventory', async () => {
  const steamID64 = '76561198874586221';
  const notifications = [];
  const client = new EventEmitter();
  client.chat = {
    async sendFriendMessage(recipient, message) {
      notifications.push({ recipient: String(recipient), message });
    },
  };

  deposit._test.pendingDeposits.clear();
  setInventory(steamID64, []);
  deposit.configureSteamClient(client, {
    webApiKey: 'test-web-api-key',
    fetchImpl: async (url) => {
      const requestedURL = String(url);

      if (requestedURL.includes('api.steampowered.com')) {
        return jsonResponse({
          response: { offer: { trade_offer_state: 3 } },
        });
      }

      if (requestedURL.includes('/inventory/')) {
        return jsonResponse(inventoryResponse([
          { name: 'Mann Co. Supply Crate Key' },
          { name: 'Mann Co. Supply Crate Key' },
        ]));
      }

      return jsonResponse({ tradeofferid: '555000111' });
    },
  });
  client.emit('webSession', 'session-123', [
    'sessionid=session-123; Path=/',
    'steamLoginSecure=secret; Path=/',
  ]);

  await getReply('!deposit 2 Mann Co. Supply Crate Key', steamID64);
  await getReply('tf2', steamID64);

  assert.deepEqual(getInventory(steamID64), []);
  assert.equal(deposit._test.pendingDeposits.get('555000111').status, 'pending');

  const firstCheck = await deposit._test.reconcilePendingDeposits();
  const secondCheck = await deposit._test.reconcilePendingDeposits();

  assert.deepEqual(firstCheck, { checked: 1, credited: 1 });
  assert.deepEqual(secondCheck, { checked: 0, credited: 0 });
  assert.deepEqual(getInventory(steamID64), [
    'Mann Co. Supply Crate Key',
    'Mann Co. Supply Crate Key',
  ]);
  assert.equal(deposit._test.pendingDeposits.get('555000111').status, 'credited');
  assert.match(notifications[0].message, /DEPOSIT ACCEPTED AND CREDITED/);
});
