'use strict';

const { randomUUID: uuidv4 } = require('node:crypto');
const { callInteraction } = require('../interactions');

const ACTIVE_OFFERS = new Map();

class Offer {
  constructor(transactionId, item, offeror, offeree) {
    this.transaction_id = transactionId;
    this.item = item;
    this.offeror_sid = offeror;
    this.offeree_sid = offeree;
    this.status = 'created';
    this.created_at = new Date();
  }
}

function findItem(inventory, requestedItem) {
  const normalizedItem = requestedItem.trim().toLowerCase();

  return inventory.find(
    (item) => item.toLowerCase() === normalizedItem,
  ) ?? null;
}

module.exports = {
  name: 'sendoffer',
  aliases: ['s', 'send', 'soffer', 'enviaroferta'],
  args: ['<friend steam id>', '<item name>'],
  description: 'Send an offer to someone',

  async run() {
    const args = Array.from(arguments);
    const offeree = args[1];
    const offeror = args.at(-1);
    const requestedItem = args.slice(2, -1).join(' ').trim();

    if (!offeree) {
      return "You didn't specify who you're sending the offer to.";
    }

    if (offeree === offeror) {
      return "You can't send an offer to yourself.";
    }

    const inventoryResult = await callInteraction(
      'inventory',
      ['inventory', offeror],
      {
        mode: 'result',
        metadata: { returnType: 'raw' },
      },
    );

    if (!inventoryResult.ok) {
      return `Could not read your inventory: ${inventoryResult.code}`;
    }

    const inventory = inventoryResult.value;

    if (inventory.length === 0) {
      return 'Your inventory is empty.';
    }

    if (!requestedItem) {
      return [
        'Specify which item you want to offer.',
        'Usage: !sendoffer <steam id> <item name>',
        `Your items: ${inventory.join(', ')}`,
      ].join('\n');
    }

    const item = findItem(inventory, requestedItem);

    if (!item) {
      return [
        `Item '${requestedItem}' was not found in your inventory.`,
        `Your items: ${inventory.join(', ')}`,
      ].join('\n');
    }

    const transactionId = uuidv4();
    const tradeOffer = new Offer(transactionId, item, offeror, offeree);

    ACTIVE_OFFERS.set(transactionId, tradeOffer);

    return [
      'Offer created successfully.',
      `Transaction: ${tradeOffer.transaction_id}`,
      `Item: ${tradeOffer.item}`,
      `From: ${tradeOffer.offeror_sid}`,
      `To: ${tradeOffer.offeree_sid}`,
      `Status: ${tradeOffer.status}`,
    ].join('\n');
  },

  ACTIVE_OFFERS,
  Offer,
};
