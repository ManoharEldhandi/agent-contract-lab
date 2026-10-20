import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

import type { ContractActionResult, SessionEvent } from '@agent-contract-lab/event-schema';
import { createModelLogger } from 'model-worklog-sdk';
import type { TraceSpan } from 'model-worklog-schema';
import { LocalSupervisorClient, ModelLoggerTelemetry, SupervisorRequestError, formatSessionEventText, type ModelLoggerTrace } from './index';

function sessionBody(): Record<string, unknown> {
	return {
		schemaVersion: 1, sessionId: 'ses_sdk', runMode: 'observe', state: 'running', actor: 'example-ai',
		workspace: { label: 'workspace', fingerprint: 'fingerprint' }, createdAt: '2026-09-15T10:00:00.000Z', eventCount: 1,
		tokenUsage: { status: 'unknown', reason: 'not-observed' },
	};
}

test('rejects remote and HTTPS supervisor URLs', () => {
	assert.throws(() => new LocalSupervisorClient({ supervisorUrl: 'http://example.com', token: 'secret' }), /loopback/);
	assert.throws(() => new LocalSupervisorClient({ supervisorUrl: 'https://127.0.0.1:43199', token: 'secret' }), /HTTP/);
});

test('authenticated SDK requests refuse redirects rather than forwarding the local credential', async () => {
	let forwarded = false;
	const target = createServer((_request, response) => { forwarded = true; response.end(JSON.stringify({ session: sessionBody() })); });
	await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
	const targetAddress = target.address();
	assert.ok(targetAddress && typeof targetAddress !== 'string');
	const redirect = createServer((_request, response) => {
		response.writeHead(302, { location: `http://127.0.0.1:${targetAddress.port}/forwarded` });
		response.end();
	});
	await new Promise<void>((resolve) => redirect.listen(0, '127.0.0.1', resolve));
	const redirectAddress = redirect.address();
	assert.ok(redirectAddress && typeof redirectAddress !== 'string');
	try {
		const client = new LocalSupervisorClient({ supervisorUrl: `http://127.0.0.1:${redirectAddress.port}`, token: 'never-forward-this' });
		await assert.rejects(client.startSession({ workspacePath: '/workspace', actor: 'test' }), (error: unknown) => error instanceof SupervisorRequestError && error.statusCode === 0);
		assert.equal(forwarded, false);
	} finally {
		for (const server of [redirect, target]) {
			server.closeAllConnections();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	}
});

test('contract SDK uses supervisor-owned actions with isolation by default and a pluggable observer', async () => {
	const requests: { path: string; body: Record<string, unknown> }[] = [];
	let observed = 0;
	const client = new LocalSupervisorClient({
		supervisorUrl: 'http://127.0.0.1:43199', token: 'local-token',
		fetchImpl: async (input, init) => {
			const path = new URL(input).pathname;
			requests.push({ path, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
			return path === '/v1/sessions'
				? new Response(JSON.stringify({ session: { ...sessionBody(), runMode: 'contract' } }), { status: 201 })
				: new Response(JSON.stringify({ action: { correlationId: 'action_1', status: 'blocked', success: false, decision: { allowed: false, ruleIds: ['paths.allow'], message: 'Refused' }, result: {} } }));
		},
	});
	const session = await client.startContractSession({
		workspacePath: '/workspace', actor: 'agent', contractYaml: 'version: 1\nname: test',
		telemetry: { observe: async (action, operation) => { observed += 1; assert.equal(action.kind, 'file.write'); return operation(); } },
	});
	assert.equal((await session.executeAction({ kind: 'file.write', path: 'README.md', content: 'bad' })).status, 'blocked');
	assert.equal(requests[0]?.body.isolated, true);
	assert.equal(requests[0]?.body.runMode, 'contract');
	assert.equal(requests[1]?.path, '/v1/sessions/ses_sdk/actions');
	assert.equal(requests[1]?.body.kind, 'file.write');
	assert.equal(observed, 1);
});

test('Model Logger telemetry failures and repeated callbacks never change or duplicate an action', async () => {
	const result: ContractActionResult = { correlationId: 'action', status: 'completed', success: true, decision: { allowed: true, ruleIds: [], message: 'Allowed' }, result: {} };
	const loggers: ModelLoggerTrace[] = [
		{ trace: () => { throw new Error('before callback'); } },
		{ trace: async (_options, operation) => { await operation(); throw new Error('after callback'); } },
		{ trace: async (_options, operation) => { await operation(); return operation(); } },
		{ trace: () => new Promise(() => undefined) },
	];
	for (const logger of loggers) {
		let calls = 0;
		const observer = new ModelLoggerTelemetry(logger, { onTelemetryError: () => { throw new Error('diagnostic failure'); } });
		assert.equal(await observer.observe({ kind: 'file.write', path: 'src/app.ts', content: 'private input' }, async () => { calls += 1; return result; }), result);
		assert.equal(calls, 1);
	}
});

test('Model Logger telemetry preserves the original supervisor error and captures no content by default', async () => {
	let metadata: unknown;
	const observer = new ModelLoggerTelemetry({ trace: async (options, operation) => { metadata = options; return operation(); } });
	const original = new Error('supervisor unavailable');
	await assert.rejects(observer.observe({ kind: 'file.write', path: 'src/app.ts', content: 'never-in-span-options' }, async () => { throw original; }), (error: unknown) => error === original);
	assert.equal(JSON.stringify(metadata).includes('never-in-span-options'), false);
	assert.equal(JSON.stringify(metadata).includes('src/app.ts'), false);
});

test('Model Logger 2.1 SDK exports correlated metadata-only spans around a supervised action', async () => {
	const spans = new Map<string, TraceSpan>();
	const logger = createModelLogger({
		projectId: 'contract-test', serviceName: 'contract-test', flushIntervalMs: 0,
		exporter: { export: async (batch) => { for (const span of batch.spans) { spans.set(span.spanId, span); } return { schemaVersion: 1, accepted: batch.spans.length, duplicates: 0 }; } },
	});
	const observer = new ModelLoggerTelemetry(logger);
	const result: ContractActionResult = { correlationId: 'action', status: 'blocked', success: false, decision: { allowed: false, ruleIds: ['paths.allow'], message: 'Refused' }, result: {} };
	try {
		await logger.trace({ name: 'contract.run', kind: 'agent' }, () => observer.observe({ kind: 'file.write', path: 'private-file', content: 'private-content' }, async () => result));
		assert.equal((await logger.shutdown()).success, true);
		const latest = [...spans.values()];
		assert.equal(latest.length, 2);
		const root = latest.find((span) => span.kind === 'agent');
		const tool = latest.find((span) => span.kind === 'tool');
		assert.ok(root && tool);
		assert.equal(tool.parentSpanId, root.spanId);
		assert.equal(tool.state, 'completed');
		assert.ok(tool.events.some((event) => event.name === 'agent-contract.action.blocked'));
		assert.ok(tool.events.some((event) => event.name === 'agent-contract.policy.refused'));
		assert.equal(JSON.stringify(latest).includes('private-content'), false);
		assert.equal(JSON.stringify(latest).includes('private-file'), false);
	} finally {
		await logger.shutdown();
	}
});

test('emits declared activity and reported usage through the local protocol', async () => {
	const requests: { path: string; body: Record<string, unknown>; headers?: Record<string, string> }[] = [];
	const client = new LocalSupervisorClient({
		supervisorUrl: 'http://127.0.0.1:43199',
		token: 'local-token',
		fetchImpl: async (input, init) => {
			requests.push({ path: new URL(input).pathname, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown>, headers: init?.headers });
			const path = new URL(input).pathname;
			if (path === '/v1/sessions') {
				return new Response(JSON.stringify({ session: sessionBody() }), { status: 201 });
			}
			if (path.endsWith('/usage')) {
				return new Response(JSON.stringify({ session: { ...sessionBody(), tokenUsage: { status: 'reported', source: 'provider-reported', providers: ['openai'], models: ['gpt-5'], inputTokens: 4, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0, totalTokens: 7 } } }), { status: 200 });
			}
			if (path.endsWith('/complete')) {
				return new Response(JSON.stringify({ session: { ...sessionBody(), state: 'completed' } }), { status: 200 });
			}
			return new Response(JSON.stringify({ event: { sequence: 2 } }), { status: 201 });
		},
	});
	const session = await client.startSession({ workspacePath: '/workspace', actor: 'example-ai' });
	await session.summary('Read the requested file.');
	await session.toolCalled({ tool: 'read_file', arguments: { path: 'README.md' }, correlationId: 'tool_1' });
	const providerUsage = await session.reportProviderUsage('openai', { id: 'resp_123', model: 'gpt-5', usage: { input_tokens: 4, output_tokens: 3, total_tokens: 7 } });
	await session.complete();

	assert.equal(requests[0]?.headers?.['x-agent-contract-token'], 'local-token');
	assert.deepEqual(requests.map((request) => request.path), ['/v1/sessions', '/v1/sessions/ses_sdk/events', '/v1/sessions/ses_sdk/events', '/v1/sessions/ses_sdk/usage', '/v1/sessions/ses_sdk/complete']);
	assert.deepEqual(requests[1]?.body, { kind: 'agent.summary', actor: 'example-ai', evidenceGrade: 'model-declared', payload: { summary: 'Read the requested file.' } });
	assert.equal(requests[2]?.body.evidenceGrade, 'model-declared');
	assert.equal(requests[2]?.body.correlationId, 'tool_1');
	assert.equal(providerUsage.normalized.ok, true);
	assert.equal(providerUsage.session?.tokenUsage.status, 'reported');
	assert.deepEqual(requests[3]?.body, { source: 'provider-reported', provider: 'openai', model: 'gpt-5', providerResponseId: 'resp_123', inputTokens: 4, outputTokens: 3, totalTokens: 7 });
});

test('records a rich visible timeline and follows committed redacted events', async () => {
	const requests: { path: string; body: Record<string, unknown> }[] = [];
	let eventPolls = 0;
	const client = new LocalSupervisorClient({
		supervisorUrl: 'http://127.0.0.1:43199',
		token: 'local-token',
		fetchImpl: async (input, init) => {
			const url = new URL(input);
			requests.push({ path: url.pathname, body: JSON.parse(init?.body ?? '{}') as Record<string, unknown> });
			if (url.pathname === '/v1/sessions') {
				return new Response(JSON.stringify({ session: sessionBody() }), { status: 201 });
			}
			if (url.pathname.endsWith('/events') && init?.method === 'GET') {
				eventPolls += 1;
				return new Response(JSON.stringify({
					events: [{ ...validEvent(), sequence: 2 }],
					cursor: { afterSequence: Number(url.searchParams.get('afterSequence') ?? '0'), nextSequence: 2 },
					terminal: true,
				}), { status: 200 });
			}
			return new Response(JSON.stringify({ event: validEvent() }), { status: 201 });
		},
	});
	const session = await client.startSession({ workspacePath: '/workspace', actor: 'example-ai', title: 'Fix parser test' });
	await session.userMessage('Fix the parser test');
	await session.plan('Inspect then repair', ['Read test', 'Run test']);
	const result = await session.runTool({ tool: 'read_file', correlationId: 'read_1' }, () => ({ path: 'src/parser.ts' }));
	await session.fileRead({ path: 'src/parser.ts', tool: 'read_file' });
	const followed: number[] = [];
	await session.followEvents((event) => { followed.push(event.sequence); }, { pollIntervalMs: 10 });

	assert.deepEqual(result, { path: 'src/parser.ts' });
	assert.equal(requests[0]?.body.title, 'Fix parser test');
	assert.equal(requests.filter((request) => request.body.kind === 'tool.called').length, 1);
	assert.equal(requests.filter((request) => request.body.kind === 'tool.completed').length, 1);
	assert.deepEqual(followed, [2]);
	assert.equal(eventPolls, 1);
	assert.deepEqual(formatSessionEventText(validEvent())[0], '[1] agent.message: hello');
});

function validEvent(): SessionEvent {
	return {
		schemaVersion: 1, eventId: 'evt_sdk', sessionId: 'ses_sdk', sequence: 1,
		occurredAt: '2026-09-15T10:00:00.000Z', kind: 'agent.message', actor: 'example-ai',
		evidenceGrade: 'model-declared', payload: { text: 'hello' },
		redaction: { policyVersion: '1', replacements: 0, truncated: false },
	};
}
