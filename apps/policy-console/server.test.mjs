import assert from 'node:assert/strict';
import { test } from 'node:test';

import { startPolicyConsole } from './server.mjs';

test('console serves private local state and assets while rejecting cross-origin mutations', async () => {
	const app = await startPolicyConsole({ port: 0 });
	try {
		const state = await (await fetch(`${app.url}/api/state`)).json();
		assert.equal(state.runtime.phase, 'inspect');
		assert.equal(state.model.configured, false);
		assert.equal(JSON.stringify(state).includes('authToken'), false);
		assert.match(await (await fetch(app.url)).text(), /Agent Contract Lab/);
		assert.equal((await fetch(`${app.url}/app.js`)).status, 200);
		assert.equal((await fetch(`${app.url}/style.css`)).status, 200);
		assert.equal((await fetch(`${app.url}/assets/icons.js`)).status, 200);
		assert.equal(
			(await fetch(`${app.url}/assets/plex-sans-400.woff2`)).status,
			200,
		);
		const foreign = await fetch(`${app.url}/api/run`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
			},
			body: '{"mode":"fixture"}',
		});
		assert.equal(foreign.status, 403);
		const knowledge = await fetch(`${app.url}/api/knowledge`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: app.url },
			body: '{"query":"token reservations"}',
		});
		assert.equal(knowledge.status, 200);
		assert.ok((await knowledge.json()).citations.length > 0);
		assert.equal(
			(await (await fetch(`${app.url}/api/state`)).json()).runtime.state
				.actions,
			0,
		);
	} finally {
		await app.close();
	}
});

test('console validates next-session policies and rejects unsupported controls without replacing the active policy', async () => {
	const app = await startPolicyConsole({ port: 0 });
	try {
		const response = await fetch(`${app.url}/api/policy`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', origin: app.url },
			body: JSON.stringify({
				yaml: 'version: 1\nname: invalid\nruntime:\n  maxToken: 1',
			}),
		});
		assert.equal(response.status, 400);
		assert.equal(
			(await (await fetch(`${app.url}/api/state`)).json()).activeContractName,
			'inventory-balanced',
		);
		assert.equal(
			(
				await fetch(`${app.url}/api/action`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: '{"kind":"file.read","path":"src/inventory.cjs"}',
				})
			).status,
			403,
		);
	} finally {
		await app.close();
	}
});
