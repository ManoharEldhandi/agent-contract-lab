import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertLoopbackUrl, fetchHealth, type FetchLike } from './protocolClient';

function validHealthBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		status: 'ok',
		supervisorVersion: '0.1.0',
		apiVersion: '1.0',
		schemaVersion: 1,
		instanceId: 'sup_abc',
		startedAt: '2026-09-11T14:00:00.000Z',
		capabilities: { adapters: [], features: ['health'] },
		...overrides,
	};
}

function jsonFetch(body: unknown, status = 200): FetchLike {
	return async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('assertLoopbackUrl accepts loopback hosts', () => {
	assert.equal(assertLoopbackUrl('http://127.0.0.1:43199').hostname, '127.0.0.1');
	assert.equal(assertLoopbackUrl('http://localhost:43199').hostname, 'localhost');
	assert.ok(assertLoopbackUrl('http://[::1]:43199'));
});

test('assertLoopbackUrl rejects remote hosts and non-http protocols', () => {
	assert.throws(() => assertLoopbackUrl('http://example.com'), /loopback/);
	assert.throws(() => assertLoopbackUrl('http://0.0.0.0'), /loopback/);
	assert.throws(() => assertLoopbackUrl('ftp://127.0.0.1'), /HTTP/);
	assert.throws(() => assertLoopbackUrl('https://127.0.0.1'), /HTTP/);
});

test('fetchHealth returns ok for a valid response', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', { fetchImpl: jsonFetch(validHealthBody()) });
	assert.equal(outcome.kind, 'ok');
	if (outcome.kind === 'ok') {
		assert.equal(outcome.health.instanceId, 'sup_abc');
	}
});

test('fetchHealth reports unreachable when the URL is not loopback', async () => {
	const outcome = await fetchHealth('http://example.com', { fetchImpl: jsonFetch(validHealthBody()) });
	assert.equal(outcome.kind, 'unreachable');
});

test('fetchHealth reports unreachable when fetch throws', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', {
		fetchImpl: async () => {
			throw new Error('connect ECONNREFUSED 127.0.0.1:43199');
		},
	});
	assert.equal(outcome.kind, 'unreachable');
});

test('fetchHealth reports http-error on non-2xx', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', { fetchImpl: jsonFetch({ error: 'boom' }, 500) });
	assert.equal(outcome.kind, 'http-error');
	assert.equal(outcome.kind === 'http-error' && outcome.statusCode, 500);
});

test('fetchHealth reports malformed for non-JSON body', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', { fetchImpl: jsonFetch('not json at all') });
	assert.equal(outcome.kind, 'malformed');
});

test('fetchHealth reports malformed for schema-invalid body', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', { fetchImpl: jsonFetch({ status: 'ok' }) });
	assert.equal(outcome.kind, 'malformed');
});

test('fetchHealth reports incompatible for a newer API major', async () => {
	const outcome = await fetchHealth('http://127.0.0.1:43199', { fetchImpl: jsonFetch(validHealthBody({ apiVersion: '2.0' })) });
	assert.equal(outcome.kind, 'incompatible');
});
