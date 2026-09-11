import assert from 'node:assert/strict';
import { after, test } from 'node:test';

import { parseHealthResponse } from '@agent-contract-lab/event-schema';

import { startSupervisor, type RunningSupervisor } from './server';

const running: RunningSupervisor[] = [];

async function start(): Promise<RunningSupervisor> {
	const supervisor = await startSupervisor({ version: '0.1.0', host: '127.0.0.1', port: 0 });
	running.push(supervisor);
	return supervisor;
}

after(async () => {
	await Promise.all(running.map((supervisor) => supervisor.close()));
});

test('binds to an ephemeral loopback port and serves valid health', async () => {
	const supervisor = await start();
	assert.equal(supervisor.host, '127.0.0.1');
	assert.ok(supervisor.port > 0);

	const response = await fetch(new URL('/health', supervisor.url));
	assert.equal(response.status, 200);
	assert.match(response.headers.get('content-type') ?? '', /application\/json/);

	const parsed = parseHealthResponse(await response.json());
	assert.equal(parsed.ok, true);
	if (parsed.ok) {
		assert.equal(parsed.value.instanceId, supervisor.instanceId);
		assert.equal(parsed.value.status, 'ok');
	}
});

test('unknown path returns 404 over the socket', async () => {
	const supervisor = await start();
	const response = await fetch(new URL('/nope', supervisor.url));
	assert.equal(response.status, 404);
});

test('POST /health returns 405 over the socket', async () => {
	const supervisor = await start();
	const response = await fetch(new URL('/health', supervisor.url), { method: 'POST' });
	assert.equal(response.status, 405);
});

test('refuses to bind to a non-loopback host', async () => {
	await assert.rejects(() => startSupervisor({ host: '0.0.0.0', port: 0 }), /non-loopback/);
});

test('close is idempotent enough to allow re-binding a fresh instance', async () => {
	const supervisor = await start();
	await supervisor.close();
	const next = await start();
	const response = await fetch(new URL('/health', next.url));
	assert.equal(response.status, 200);
});
