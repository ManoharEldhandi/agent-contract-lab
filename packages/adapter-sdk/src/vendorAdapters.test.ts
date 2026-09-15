import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ClaudeCodeAdapter, CodexAppServerAdapter, type AdapterEventSink } from './vendorAdapters';

class RecordingSink implements AdapterEventSink {
	readonly calls: { readonly method: string; readonly payload: unknown; readonly correlationId?: string }[] = [];

	async emitEvent(kind: Parameters<AdapterEventSink['emitEvent']>[0], payload: Parameters<AdapterEventSink['emitEvent']>[1], correlationId?: string): Promise<void> {
		this.calls.push({ method: kind, payload, ...(correlationId === undefined ? {} : { correlationId }) });
	}

	async unknown(kind: Parameters<AdapterEventSink['unknown']>[0], reason: Parameters<AdapterEventSink['unknown']>[1], payload: Parameters<AdapterEventSink['unknown']>[2]): Promise<void> {
		this.calls.push({ method: `unknown:${kind}:${reason}`, payload });
	}

	async reportProviderUsage(provider: Parameters<AdapterEventSink['reportProviderUsage']>[0], response: unknown): Promise<void> {
		this.calls.push({ method: `usage:${provider}`, payload: response });
	}

	async complete(state?: 'completed' | 'failed' | 'interrupted'): Promise<void> {
		this.calls.push({ method: 'complete', payload: state ?? 'completed' });
	}
}

test('Claude Code hook adapter maps tool, file, instruction, and lifecycle evidence', async () => {
	const sink = new RecordingSink();
	const adapter = new ClaudeCodeAdapter(sink, { workspacePath: '/workspace' });

	await adapter.ingestHook({ hook_event_name: 'SessionStart', session_id: 'claude-session', source: 'startup', model: 'claude-sonnet' });
	await adapter.ingestHook({ hook_event_name: 'UserPromptSubmit', prompt_id: 'prompt-1', prompt: 'Fix the test.' });
	await adapter.ingestHook({ hook_event_name: 'InstructionsLoaded', file_path: '/workspace/CLAUDE.md', memory_type: 'Project', load_reason: 'session_start' });
	await adapter.ingestHook({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 'tool-1', tool_input: { file_path: '/workspace/src/app.ts' } });
	await adapter.ingestHook({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'tool-1', tool_input: { file_path: '/workspace/src/app.ts' }, tool_response: { type: 'update' } });
	const result = await adapter.ingestHook({ hook_event_name: 'SessionEnd', reason: 'other' });

	assert.deepEqual(sink.calls, [
		{ method: 'adapter.lifecycle', payload: { adapter: 'claude-code', phase: 'session-started', vendorSessionId: 'claude-session', source: 'startup', model: 'claude-sonnet' } },
		{ method: 'agent.message', payload: { text: 'Fix the test.' }, correlationId: 'prompt-1' },
		{ method: 'instruction.loaded', payload: { adapter: 'claude-code', path: 'CLAUDE.md', memoryType: 'Project', loadReason: 'session_start' } },
		{ method: 'tool.called', payload: { tool: 'Edit', arguments: { file_path: '/workspace/src/app.ts' } }, correlationId: 'tool-1' },
		{ method: 'tool.completed', payload: { tool: 'Edit', success: true, result: { type: 'update' } }, correlationId: 'tool-1' },
		{ method: 'file.changed', payload: { path: 'src/app.ts', operation: 'modified' }, correlationId: 'tool-1' },
		{ method: 'adapter.lifecycle', payload: { adapter: 'claude-code', phase: 'session-ended', reason: 'other' } },
		{ method: 'complete', payload: 'completed' },
	]);
	assert.deepEqual(result, { emitted: 2, completed: true });
});

test('Claude Code hook adapter records gaps rather than guessing missing data', async () => {
	const sink = new RecordingSink();
	const adapter = new ClaudeCodeAdapter(sink);
	const result = await adapter.ingestHook({ hook_event_name: 'InstructionsLoaded' });

	assert.deepEqual(result, { emitted: 1, completed: false });
	assert.deepEqual(sink.calls, [{ method: 'unknown:instruction.loaded:not-observed', payload: { adapter: 'claude-code', hookEvent: 'InstructionsLoaded', message: 'Hook payload did not include file_path.' } }]);
});

test('Codex App Server adapter maps commands, files, summaries, usage, and session completion', async () => {
	const sink = new RecordingSink();
	const adapter = new CodexAppServerAdapter(sink, { workspacePath: '/workspace' });

	await adapter.ingestNotification({ method: 'item/started', params: { item: { id: 'item-command', type: 'commandExecution', command: 'npm test' } } });
	await adapter.ingestNotification({ method: 'item/completed', params: { item: { id: 'item-command', type: 'commandExecution', command: 'npm test', exitCode: 0, durationMs: 100 } } });
	await adapter.ingestNotification({ method: 'item/completed', params: { item: { id: 'item-file', type: 'fileChange', changes: [{ path: '/workspace/src/app.ts', kind: 'update' }] } } });
	await adapter.ingestNotification({ method: 'item/completed', params: { item: { id: 'item-message', type: 'agentMessage', text: 'Fixed the test.' } } });
	await adapter.ingestNotification({ method: 'thread/tokenUsage/updated', params: { model: 'gpt-5', usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } });
	const result = await adapter.ingestNotification({ method: 'thread/closed', params: { threadId: 'thr-1' } });

	assert.deepEqual(sink.calls, [
		{ method: 'command.started', payload: { executable: 'npm test' }, correlationId: 'item-command' },
		{ method: 'command.completed', payload: { executable: 'npm test', exitCode: 0, durationMs: 100 }, correlationId: 'item-command' },
		{ method: 'file.changed', payload: { path: 'src/app.ts', operation: 'modified' }, correlationId: 'item-file' },
		{ method: 'agent.summary', payload: { summary: 'Fixed the test.' }, correlationId: 'item-message' },
		{ method: 'usage:openai', payload: { model: 'gpt-5', usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } } },
		{ method: 'adapter.lifecycle', payload: { adapter: 'codex-app-server', phase: 'thread-closed', threadId: 'thr-1' } },
		{ method: 'complete', payload: 'completed' },
	]);
	assert.deepEqual(result, { emitted: 2, completed: true });
});

test('Codex App Server adapter marks unmapped notifications as unsupported', async () => {
	const sink = new RecordingSink();
	const result = await new CodexAppServerAdapter(sink).ingestNotification({ method: 'future/event', params: {} });

	assert.deepEqual(result, { emitted: 1, completed: false });
	assert.deepEqual(sink.calls, [{ method: 'unknown:adapter.lifecycle:unsupported-capability', payload: { adapter: 'codex-app-server', method: 'future/event', message: 'The notification is not mapped by this adapter version.' } }]);
});