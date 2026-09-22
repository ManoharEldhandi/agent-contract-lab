import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';

import { CodexAppServerRelay, type CodexChild } from './codexRelay';
import type { EventDraft } from './ledger';

class FakeCodexChild extends EventEmitter implements CodexChild {
	readonly stdout = new PassThrough();
	readonly stderr = new PassThrough();
	readonly stdin: Writable;
	killed = false;

	constructor(workspacePath: string) {
		super();
		this.stdin = new Writable({
			write: (chunk, _encoding, callback) => {
				const request = JSON.parse(chunk.toString('utf8')) as { id?: number; method?: string };
				if (request.id === undefined || request.method === undefined) {
					callback();
					return;
				}
				if (request.method === 'initialize') {
					this.reply(request.id, {});
				} else if (request.method === 'thread/start') {
					this.reply(request.id, { thread: { id: 'thread_1' }, instructionSources: [`${workspacePath}/AGENTS.md`] });
				} else if (request.method === 'turn/start') {
					this.reply(request.id, { turn: { id: 'turn_1' } });
					queueMicrotask(() => {
						this.notify('item/reasoning/textDelta', { itemId: 'reason_1', delta: 'private chain of thought' });
						this.notify('item/plan/delta', { itemId: 'plan_1', delta: 'Read the test first.' });
						this.notify('item/agentMessage/delta', { itemId: 'message_1', delta: 'I found the failing assertion.' });
						this.notify('item/started', { item: { id: 'command_1', type: 'commandExecution', command: 'npm test' } });
						this.notify('item/completed', { item: { id: 'command_1', type: 'commandExecution', command: 'npm test', exitCode: 0, durationMs: 120 } });
						this.notify('thread/tokenUsage/updated', { usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }, model: 'gpt-5.6-terra' });
						this.notify('turn/completed', { turn: { status: 'completed' } });
					});
				} else if (request.method === 'turn/interrupt') {
					this.reply(request.id, {});
				}
				callback();
			},
		});
	}

	kill(): boolean {
		this.killed = true;
		return true;
	}

	private reply(id: number, result: unknown): void {
		this.stdout.write(`${JSON.stringify({ id, result })}\n`);
	}

	private notify(method: string, params: unknown): void {
		this.stdout.write(`${JSON.stringify({ method, params })}\n`);
	}
}

test('records only visible Codex App Server activity and preserves direct provenance', async () => {
	const events: EventDraft[] = [];
	const usage: unknown[] = [];
	let completed: string | undefined;
	let child: FakeCodexChild | undefined;
	let resolveFinished: (() => void) | undefined;
	const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
	const relay = new CodexAppServerRelay(
		{
			append: async (event) => { events.push(event); },
			recordUsage: async (entry) => { usage.push(entry); },
			complete: async (state) => { completed = state; resolveFinished?.(); },
		},
		{ sessionId: 'ses_1', workspacePath: '/workspace', task: 'Fix the parser', maxDurationMs: 60_000, maxTokens: 1_000 },
		{ spawnCodex: (_command, _args, options) => {
			child = new FakeCodexChild(options.cwd as string);
			return child;
		} },
	);

	await relay.start();
	await finished;

	assert.equal(completed, 'completed');
	assert.equal(child?.killed, true);
	assert.ok(events.every((event) => !JSON.stringify(event.payload).includes('private chain of thought')));
	assert.deepEqual(events.map((event) => event.kind), [
		'adapter.lifecycle', 'instruction.loaded', 'adapter.lifecycle', 'agent.summary', 'agent.summary', 'agent.message', 'command.started', 'command.completed', 'adapter.lifecycle',
	]);
	const reasoningGap = events.find((event) => event.evidenceGrade === 'unknown');
	assert.equal(reasoningGap?.unknownReason, 'redacted');
	assert.equal(events.find((event) => event.kind === 'instruction.loaded')?.payload.path, 'AGENTS.md');
	assert.equal(events.filter((event) => event.evidenceGrade === 'observed-native').length, 7);
	assert.deepEqual(usage, [{ source: 'provider-reported', provider: 'openai', model: 'gpt-5.6-terra', inputTokens: 4, outputTokens: 2, totalTokens: 6 }]);
});
