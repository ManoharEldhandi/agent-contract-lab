import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildHealthResponse, createIdentity } from './health';
import { route } from './router';

const health = buildHealthResponse(createIdentity('0.1.0', new Date('2026-09-11T14:00:00.000Z')));

test('GET /health returns the health payload', () => {
	const result = route('GET', '/health', { health });
	assert.equal(result.statusCode, 200);
	assert.equal(result.body, health);
});

test('HEAD /health is allowed', () => {
	assert.equal(route('HEAD', '/health', { health }).statusCode, 200);
});

test('non-GET methods on /health are 405', () => {
	for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
		assert.equal(route(method, '/health', { health }).statusCode, 405);
	}
});

test('unknown paths are 404 with a structured error', () => {
	const result = route('GET', '/v1/status', { health });
	assert.equal(result.statusCode, 404);
	assert.equal(typeof result.body, 'object');
	assert.equal((result.body as { error?: { code?: string } }).error?.code, 'not_found');
});
