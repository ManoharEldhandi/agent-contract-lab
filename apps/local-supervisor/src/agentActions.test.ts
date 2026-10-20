import assert from 'node:assert/strict';
import { test } from 'node:test';

import { AgentActionExecutor } from './agentActions';
import { LocalKnowledgeIndex } from './knowledge';
import { WorkspaceActionExecutor } from './workspaceActions';
import { boundedUtf8 } from './textBounds';

test('agent output limits also bound retrieval excerpts and model response text', async () => {
	const knowledge = new LocalKnowledgeIndex([
		{
			source: 'policy://budget',
			title: 'Budget',
			content: 'Budget '.repeat(100),
			origin: 'attached-policy',
		},
	]);
	const executor = new AgentActionExecutor(
		new WorkspaceActionExecutor(process.cwd()),
		knowledge,
		{ complete: async () => ({ text: 'x'.repeat(100) }) },
		16,
	);
	try {
		const retrieved = await executor.execute({
			kind: 'knowledge.search',
			query: 'budget',
			limit: 5,
		});
		const citations = retrieved.result.citations as { excerpt: string }[];
		assert.ok(
			citations.reduce(
				(total, citation) => total + Buffer.byteLength(citation.excerpt),
				0,
			) <= 16,
		);
		assert.equal(retrieved.result.truncated, true);
		const response = await executor.execute({
			kind: 'model.call',
			model: 'test',
			prompt: 'Question',
			maxOutputTokens: 10,
			tokenReservation: 100,
			timeoutMs: 1_000,
			knowledgeQuery: 'budget',
		});
		assert.equal(Buffer.byteLength(String(response.result.text)), 16);
		assert.equal(response.result.truncated, true);
	} finally {
		executor.stop();
	}
});

test('UTF-8 output caps do not expand replacement characters beyond the configured byte budget', async () => {
	for (const maximum of [0, 1, 2, 3, 4, 7]) {
		const text = String.fromCodePoint(0x1f4dd).repeat(4);
		assert.ok(Buffer.byteLength(boundedUtf8(text, maximum)) <= maximum);
	}
	const executor = new WorkspaceActionExecutor(process.cwd(), process.env, {
		maxOutputBytes: 7,
	});
	try {
		const outcome = await executor.execute({
			kind: 'command',
			executable: process.execPath,
			args: [
				'-e',
				'process.stdout.write(Buffer.from([255,255,255,255]));process.stderr.write(Buffer.from([255,255,255,255]));',
			],
			timeoutMs: 2_000,
		});
		assert.ok(
			Buffer.byteLength(String(outcome.result.stdout)) +
				Buffer.byteLength(String(outcome.result.stderr)) <=
				7,
		);
		assert.equal(outcome.result.truncated, true);
	} finally {
		executor.stop();
	}
});
