import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
	OpenAICompatibleGateway,
	startSupervisor,
} from '@agent-contract-lab/local-supervisor';

import { PolicyConsoleController } from './controller.mjs';
import { REPAIRED_INVENTORY, createInventoryFixture } from './fixture.mjs';

async function withConsole(run, options = {}) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), 'agent-policy-console-test-')),
	);
	let supervisor;
	let controller;
	try {
		const workspacePath = await createInventoryFixture(directory);
		supervisor = await startSupervisor({
			port: 0,
			dataDirectory: join(directory, 'supervisor'),
			modelProvider: options.modelProvider,
		});
		controller = new PolicyConsoleController(supervisor, workspacePath, {
			modelConfigured: options.modelProvider !== undefined,
		});
		await controller.ready();
		await run(controller, workspacePath, supervisor);
	} finally {
		await controller?.close();
		await supervisor?.close();
		await rm(directory, { recursive: true, force: true });
	}
}

test('product fixture exercises real phase gates, exhausted retries, recovery, passing tests and evidence export', async () => {
	await withConsole(async (controller, workspacePath, supervisor) => {
		const original = await readFile(
			join(workspacePath, 'src/inventory.cjs'),
			'utf8',
		);
		await controller.start('fixture');
		await controller.job;
		const state = await controller.snapshot();
		assert.equal(state.run.error, null);
		assert.equal(state.session.state, 'completed');
		assert.ok(
			state.events.some(
				(event) =>
					event.kind === 'policy.decision' &&
					event.payload.ruleIds?.includes('runtime.retries'),
			),
		);
		assert.ok(
			state.events.some(
				(event) =>
					event.kind === 'workflow.transition' &&
					event.payload.target === 'edit',
			),
		);
		assert.equal(
			state.runtime.state.verifiedRevision,
			state.runtime.state.writeRevision,
		);
		assert.equal(
			await readFile(join(workspacePath, 'src/inventory.cjs'), 'utf8'),
			original,
		);
		const bundle = await controller.export();
		assert.equal(
			JSON.stringify({ state, bundle }).includes(supervisor.authToken),
			false,
		);
		assert.equal(bundle.session.state, 'completed');
	});
});

test('operator knowledge search does not consume agent quotas and policy updates apply only to the next session', async () => {
	await withConsole(async (controller) => {
		const before = await controller.snapshot();
		const result = controller.search('tokens retries workflow');
		assert.ok(result.citations.length > 0);
		const after = await controller.snapshot();
		assert.equal(after.runtime.state.actions, before.runtime.state.actions);
		assert.throws(
			() =>
				controller.setPolicy(
					'version: 1\nname: bad\nruntime:\n  limits:\n    maxToken: 2',
				),
			/unsupported|Unrecognized/,
		);
		controller.setPolicy(before.profiles.tight);
		assert.equal(
			(await controller.snapshot()).activeContractName,
			before.activeContractName,
		);
		await assert.rejects(controller.start('model'), /No connected model/);
	});
});

test('connected model repairs through the real HTTP gateway with cited context and private credentials', async () => {
	const requests = [];
	const provider = createServer((request, response) => {
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => {
			requests.push({
				body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
				authorization: request.headers.authorization,
			});
			response.setHeader('content-type', 'application/json');
			response.end(
				JSON.stringify({
					model: 'review-model',
					choices: [
						{
							message: {
								content: JSON.stringify({
									path: 'src/inventory.cjs',
									content: REPAIRED_INVENTORY,
								}),
							},
						},
					],
					usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
				}),
			);
		});
	});
	await new Promise((resolveListen) =>
		provider.listen(0, '127.0.0.1', resolveListen),
	);
	try {
		const gateway = new OpenAICompatibleGateway({
			endpoint: `http://127.0.0.1:${provider.address().port}/v1/chat/completions`,
			apiKey: 'fixture-provider-secret',
		});
		await withConsole(
			async (controller) => {
				await controller.start('model');
				await controller.job;
				const state = await controller.snapshot();
				assert.equal(state.run.error, null);
				assert.equal(state.session.state, 'completed');
				assert.equal(state.runtime.state.tokensReported, 14);
				assert.ok(
					state.runtime.state.tokensCharged >
						state.runtime.state.tokensReported,
				);
				assert.equal(requests.length, 1);
				assert.equal(requests[0].body.max_tokens, 1_200);
				assert.match(
					requests[0].body.messages[1].content,
					/Untrusted retrieved reference data/,
				);
				assert.equal(
					requests[0].authorization,
					'Bearer fixture-provider-secret',
				);
				assert.equal(
					JSON.stringify(state).includes('fixture-provider-secret'),
					false,
				);
			},
			{ modelProvider: gateway },
		);
	} finally {
		provider.closeAllConnections();
		await new Promise((resolveClose) => provider.close(resolveClose));
	}
});

test('duplicate product run starts cannot create concurrent agent workflows', async () => {
	await withConsole(async (controller) => {
		const first = controller.start('fixture');
		await assert.rejects(controller.start('fixture'), /already active/);
		await first;
		await controller.job;
		assert.equal((await controller.snapshot()).session.state, 'completed');
	});
});
