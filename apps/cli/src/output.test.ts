import assert from 'node:assert/strict';
import { test } from 'node:test';

import { colorize, resolveColor, resolveFormat } from './output';

test('resolveColor honors NO_COLOR over everything', () => {
	assert.equal(resolveColor(true, { NO_COLOR: '1' }), false);
	assert.equal(resolveColor(true, { NO_COLOR: '' }), false);
	assert.equal(resolveColor(false, { NO_COLOR: '1', FORCE_COLOR: '1' }), false);
});

test('resolveColor honors FORCE_COLOR when NO_COLOR is absent', () => {
	assert.equal(resolveColor(false, { FORCE_COLOR: '1' }), true);
});

test('resolveColor falls back to TTY', () => {
	assert.equal(resolveColor(true, {}), true);
	assert.equal(resolveColor(false, {}), false);
});

test('resolveFormat defaults by TTY and validates explicit values', () => {
	assert.equal(resolveFormat(undefined, true), 'pretty');
	assert.equal(resolveFormat(undefined, false), 'json');
	assert.equal(resolveFormat('json', true), 'json');
	assert.equal(resolveFormat('pretty', false), 'pretty');
	assert.equal(resolveFormat('jsonl', true), 'jsonl');
	assert.equal(resolveFormat('xml', false), undefined);
});

test('colorize wraps only when enabled', () => {
	assert.equal(colorize('x', 'green', false), 'x');
	assert.notEqual(colorize('x', 'green', true), 'x');
	assert.ok(colorize('x', 'green', true).includes('x'));
});
