const assert = require('node:assert/strict');
const { test } = require('node:test');

const { inventoryValue } = require('./inventory.cjs');

test('inventory value includes each item quantity', () => {
	assert.equal(inventoryValue([{ unitPrice: 3, quantity: 4 }, { unitPrice: 13, quantity: 2 }]), 38);
});

test('an empty inventory has zero value', () => {
	assert.equal(inventoryValue([]), 0);
});
