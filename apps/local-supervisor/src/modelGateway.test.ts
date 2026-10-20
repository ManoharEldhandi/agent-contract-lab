import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { test } from 'node:test';

import { OpenAICompatibleGateway, modelTokenReservation } from './modelGateway';

test('model gateway sends enforced output limits and retains only actual provider usage', async () => {
	let captured: { max_tokens?: number; model?: string } = {};
	const server = createServer((request, response) => {
		const chunks: Buffer[] = [];
		request.on('data', (chunk: Buffer) => chunks.push(chunk));
		request.on('end', () => {
			captured = JSON.parse(
				Buffer.concat(chunks).toString('utf8'),
			) as typeof captured;
			response.setHeader('content-type', 'application/json');
			response.end(
				JSON.stringify({
					model: 'test-model',
					choices: [{ message: { content: 'A grounded answer.' } }],
					usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
				}),
			);
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	try {
		const gateway = new OpenAICompatibleGateway({
			endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`,
		});
		const result = await gateway.complete({
			model: 'test-model',
			prompt: 'Question',
			maxOutputTokens: 64,
			timeoutMs: 1_000,
		});
		assert.equal(captured.max_tokens, 64);
		assert.equal(captured.model, 'test-model');
		assert.equal(result.usage?.totalTokens, 14);
		assert.ok(modelTokenReservation('Question', 64) > 14);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});

test('model gateway rejects insecure endpoints and does not manufacture absent usage', async () => {
	assert.throws(
		() =>
			new OpenAICompatibleGateway({
				endpoint: 'http://provider.example/completions',
			}),
		/HTTPS/,
	);
	let respond: (response: ServerResponse) => void = (response) =>
		response.end(
			JSON.stringify({
				choices: [{ message: { content: 'No usage supplied.' } }],
			}),
		);
	const server = createServer((_request, response) => respond(response));
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	assert.ok(address && typeof address !== 'string');
	try {
		const gateway = new OpenAICompatibleGateway({
			endpoint: `http://127.0.0.1:${address.port}`,
		});
		assert.equal(
			(
				await gateway.complete({
					model: 'test',
					prompt: 'Question',
					maxOutputTokens: 5,
					timeoutMs: 1_000,
				})
			).usage,
			undefined,
		);
		respond = (response) => {
			response.writeHead(302, { location: 'https://example.com/' });
			response.end();
		};
		await assert.rejects(
			gateway.complete({
				model: 'test',
				prompt: 'Question',
				maxOutputTokens: 5,
				timeoutMs: 1_000,
			}),
		);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	}
});
