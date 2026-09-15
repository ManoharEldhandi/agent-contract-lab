import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	isApiCompatible,
	isRfc3339,
	parseApiMajor,
	parseHealthResponse,
	type HealthResponse,
} from './health';

function validHealth(): Record<string, unknown> {
	return {
		status: 'ok',
		supervisorVersion: '0.1.0',
		apiVersion: '1.0',
		schemaVersion: 1,
		instanceId: 'sup_abc123',
		startedAt: '2026-09-11T14:00:00.000Z',
		capabilities: { adapters: [], features: ['health'] },
	};
}

test('parses a well-formed health response', () => {
	const result = parseHealthResponse(validHealth());
	assert.equal(result.ok, true);
	if (result.ok) {
		const value: HealthResponse = result.value;
		assert.equal(value.status, 'ok');
		assert.equal(value.schemaVersion, 1);
		assert.deepEqual(value.capabilities.features, ['health']);
		assert.deepEqual(value.capabilities.adapters, []);
	}
});

test('rejects non-object input', () => {
	for (const input of [null, undefined, 'x', 3, []]) {
		assert.equal(parseHealthResponse(input).ok, false);
	}
});

test('rejects a missing required field', () => {
	const input = validHealth();
	delete input.instanceId;
	const result = parseHealthResponse(input);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.issues.some((i) => i.path === 'instanceId'), true);
});

test('rejects a wrong-typed field', () => {
	const input = validHealth();
	input.schemaVersion = '1';
	assert.equal(parseHealthResponse(input).ok, false);
});

test('rejects an invalid status enum', () => {
	const input = validHealth();
	input.status = 'starting';
	assert.equal(parseHealthResponse(input).ok, false);
});

test('rejects a non-RFC3339 startedAt', () => {
	const input = validHealth();
	input.startedAt = '2026-09-11 14:00:00';
	const result = parseHealthResponse(input);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.issues.some((i) => i.path === 'startedAt'), true);
});

test('rejects schemaVersion below 1', () => {
	const input = validHealth();
	input.schemaVersion = 0;
	assert.equal(parseHealthResponse(input).ok, false);
});

test('rejects malformed apiVersion', () => {
	const input = validHealth();
	input.apiVersion = 'v1';
	assert.equal(parseHealthResponse(input).ok, false);
});

test('rejects capabilities that is not an object', () => {
	const input = validHealth();
	input.capabilities = [];
	assert.equal(parseHealthResponse(input).ok, false);
});

test('rejects capabilities.adapters with a non-string element', () => {
	const input = validHealth();
	input.capabilities = { adapters: ['claude', 5], features: [] };
	const result = parseHealthResponse(input);
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.issues.some((i) => i.path === 'capabilities.adapters[1]'), true);
});

test('accumulates multiple issues in one pass', () => {
	const result = parseHealthResponse({ status: 'bad', schemaVersion: 'x' });
	assert.equal(result.ok, false);
	assert.equal(result.ok === false && result.issues.length >= 2, true);
});

test('isRfc3339 accepts UTC and offsets, rejects loose formats', () => {
	assert.equal(isRfc3339('2026-09-11T14:00:00Z'), true);
	assert.equal(isRfc3339('2026-09-11T14:00:00.123Z'), true);
	assert.equal(isRfc3339('2026-09-11T14:00:00+05:30'), true);
	assert.equal(isRfc3339('2026-09-11T14:00:00'), false);
	assert.equal(isRfc3339('not-a-date'), false);
});

test('parseApiMajor and isApiCompatible enforce major compatibility', () => {
	assert.equal(parseApiMajor('1.0'), 1);
	assert.equal(parseApiMajor('2.7'), 2);
	assert.equal(parseApiMajor('v1'), null);
	assert.equal(parseApiMajor('1'), null);
	assert.equal(isApiCompatible('1.0'), true);
	assert.equal(isApiCompatible('1.9'), true);
	assert.equal(isApiCompatible('2.0'), false);
	assert.equal(isApiCompatible('bad'), false);
});
