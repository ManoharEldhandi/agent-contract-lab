import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	describe,
	isRecord,
	joinPath,
	requireBoolean,
	requireEnum,
	requireInteger,
	requireNonEmptyString,
	requireStringArray,
} from './validation';

test('isRecord distinguishes plain objects from arrays and null', () => {
	assert.equal(isRecord({}), true);
	assert.equal(isRecord({ a: 1 }), true);
	assert.equal(isRecord(null), false);
	assert.equal(isRecord([]), false);
	assert.equal(isRecord('x'), false);
	assert.equal(isRecord(3), false);
});

test('describe reports runtime kind safely', () => {
	assert.equal(describe(null), 'null');
	assert.equal(describe([]), 'array');
	assert.equal(describe('a'), 'string');
	assert.equal(describe(1), 'number');
	assert.equal(describe(undefined), 'undefined');
});

test('joinPath builds object and array paths', () => {
	assert.equal(joinPath('', 'a'), 'a');
	assert.equal(joinPath('a', 'b'), 'a.b');
	assert.equal(joinPath('a', 0), 'a[0]');
});

test('requireNonEmptyString rejects missing, wrong-typed, and blank values', () => {
	assert.deepEqual(requireNonEmptyString({ a: 'ok' }, 'a', ''), { ok: true, value: 'ok' });
	assert.equal(requireNonEmptyString({}, 'a', '').ok, false);
	assert.equal(requireNonEmptyString({ a: 3 }, 'a', '').ok, false);
	const blank = requireNonEmptyString({ a: '  ' }, 'a', '');
	assert.equal(blank.ok, false);
});

test('requireInteger rejects floats and non-numbers', () => {
	assert.deepEqual(requireInteger({ a: 5 }, 'a', ''), { ok: true, value: 5 });
	assert.equal(requireInteger({ a: 5.5 }, 'a', '').ok, false);
	assert.equal(requireInteger({ a: '5' }, 'a', '').ok, false);
	assert.equal(requireInteger({ a: Number.NaN }, 'a', '').ok, false);
});

test('requireBoolean enforces boolean type', () => {
	assert.deepEqual(requireBoolean({ a: false }, 'a', ''), { ok: true, value: false });
	assert.equal(requireBoolean({ a: 'true' }, 'a', '').ok, false);
});

test('requireStringArray reports the exact failing element path', () => {
	assert.deepEqual(requireStringArray({ a: ['x', 'y'] }, 'a', ''), { ok: true, value: ['x', 'y'] });
	const notArray = requireStringArray({ a: 'x' }, 'a', '');
	assert.equal(notArray.ok, false);
	const badElement = requireStringArray({ a: ['x', 3] }, 'a', 'caps');
	assert.equal(badElement.ok, false);
	assert.equal(badElement.ok === false && badElement.issues[0]?.path, 'caps.a[1]');
});

test('requireEnum accepts allowed values and rejects others', () => {
	const allowed = ['ok', 'degraded'] as const;
	assert.deepEqual(requireEnum({ s: 'ok' }, 's', '', allowed), { ok: true, value: 'ok' });
	assert.equal(requireEnum({ s: 'nope' }, 's', '', allowed).ok, false);
	assert.equal(requireEnum({ s: 2 }, 's', '', allowed).ok, false);
});
