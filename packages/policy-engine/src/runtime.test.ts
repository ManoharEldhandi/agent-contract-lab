import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	admitRuntimeAction,
	advanceRuntimePhase,
	createRuntimeState,
	evaluatePhaseTransition,
	evaluateRuntime,
	evaluateRuntimeCompletion,
	recordRuntimeOutcome,
	type RuntimePolicy,
} from './runtime';
import { parseContract } from './index';

test('runtime contracts are strictly validated and deeply immutable', () => {
	const parsed = parseContract({
		version: 1,
		name: 'runtime',
		runtime: {
			limits: { maxActions: 3 },
			phases: [{ name: 'inspect', tools: ['file.read'] }],
		},
	});
	assert.ok(parsed.ok);
	assert.ok(Object.isFrozen(parsed.contract.runtime?.phases?.[0]?.tools));
	for (const runtime of [
		{ limits: { maxAction: 3 } },
		{ limits: { maxRetries: -1 } },
		{ toolQuotas: { 'unrestricted.shell': 3 } },
		{
			phases: [
				{
					name: 'edit',
					tools: ['file.write'],
					requireSuccessfulTools: ['command'],
				},
			],
		},
		{
			phases: [
				{ name: 'same', tools: [] },
				{ name: 'same', tools: [] },
			],
		},
		{ requireVerificationBeforeComplete: true },
	]) {
		assert.equal(
			parseContract({ version: 1, name: 'invalid', runtime }).ok,
			false,
		);
	}
});

test('runtime stages restrict tools and reject skipped phases or unmet prerequisites', () => {
	const policy: RuntimePolicy = {
		phases: [
			{
				name: 'inspect',
				tools: ['file.read'],
				requireSuccessfulTools: ['file.read'],
			},
			{ name: 'edit', tools: ['file.write'] },
			{ name: 'verify', tools: ['command'] },
		],
	};
	const state = createRuntimeState(0);
	assert.equal(
		evaluateRuntime(
			policy,
			state,
			{ kind: 'file.write', path: 'src/app.ts' },
			0,
		).allowed,
		false,
	);
	assert.equal(evaluatePhaseTransition(policy, state, 'verify').allowed, false);
	assert.equal(evaluatePhaseTransition(policy, state, 'edit').allowed, false);
	const read = recordRuntimeOutcome(
		state,
		{ kind: 'file.read', path: 'src/app.ts' },
		{ success: true },
	);
	assert.equal(evaluatePhaseTransition(policy, read, 'edit').allowed, true);
	assert.equal(
		evaluateRuntime(
			policy,
			advanceRuntimePhase(read),
			{ kind: 'file.write', path: 'src/app.ts' },
			0,
		).allowed,
		true,
	);
});

test('runtime budgets enforce duration, total actions, per-tool quotas and rolling rate limits', () => {
	const action = { kind: 'file.read', path: 'src/app.ts' } as const;
	const policy: RuntimePolicy = {
		limits: {
			maxDurationMs: 100,
			maxActions: 1,
			maxActionsPerWindow: 1,
			windowMs: 50,
		},
		toolQuotas: { 'file.read': 1 },
	};
	const state = admitRuntimeAction(policy, createRuntimeState(0), action, 0);
	assert.deepEqual(evaluateRuntime(policy, state, action, 1).ruleIds, [
		'runtime.actions',
		'runtime.toolQuota',
		'runtime.rateLimit',
	]);
	assert.ok(
		evaluateRuntime(policy, state, action, 100).ruleIds.includes(
			'runtime.duration',
		),
	);
	assert.equal(
		evaluateRuntime(
			{ limits: { maxActionsPerWindow: 1, windowMs: 50 } },
			state,
			action,
			50,
		).allowed,
		true,
	);
});

test('runtime refuses repeated failures beyond the retry limit and opens the failure circuit', () => {
	const action = {
		kind: 'command',
		executable: 'node',
		args: ['--test'],
	} as const;
	let state = createRuntimeState(0);
	state = recordRuntimeOutcome(state, action, { success: false });
	assert.equal(
		evaluateRuntime({ limits: { maxRetries: 0 } }, state, action, 1).allowed,
		false,
	);
	assert.equal(
		evaluateRuntime({ limits: { maxRetries: 1 } }, state, action, 1).allowed,
		true,
	);
	state = recordRuntimeOutcome(state, action, { success: false });
	assert.ok(
		evaluateRuntime(
			{ limits: { maxConsecutiveFailures: 2 } },
			state,
			{ kind: 'file.read' },
			1,
		).ruleIds.includes('runtime.circuitBreaker'),
	);
});

test('runtime file controls track reads, changed-file breadth, byte budgets and stale verification', () => {
	const policy: RuntimePolicy = {
		requireReadBeforeWrite: true,
		requireVerificationBeforeComplete: true,
		limits: { maxChangedFiles: 1, maxWriteBytes: 4 },
	};
	const write = {
		kind: 'file.write',
		path: './src/app.ts',
		content: 'test',
	} as const;
	let state = createRuntimeState(0);
	assert.equal(evaluateRuntime(policy, state, write, 0).allowed, false);
	state = recordRuntimeOutcome(
		state,
		{ kind: 'file.read', path: 'src/app.ts' },
		{ success: true },
	);
	assert.equal(evaluateRuntime(policy, state, write, 0).allowed, true);
	state = admitRuntimeAction(policy, state, write, 0);
	assert.ok(
		evaluateRuntime(
			policy,
			state,
			{ kind: 'file.write', path: 'src/other.ts', content: 'x' },
			0,
		).ruleIds.includes('runtime.changedFiles'),
	);
	assert.ok(
		evaluateRuntime(policy, state, write, 0).ruleIds.includes(
			'runtime.writeBytes',
		),
	);
	assert.equal(evaluateRuntimeCompletion(policy, state).allowed, false);
	state = recordRuntimeOutcome(
		state,
		{ kind: 'command' },
		{ success: true, verification: true },
	);
	assert.equal(evaluateRuntimeCompletion(policy, state).allowed, true);
	assert.ok(Object.isFrozen(state));
	assert.ok(Object.isFrozen(state.changedPaths));
});

test('runtime model controls enforce allowlists and conservative token reservations without inventing usage', () => {
	const policy: RuntimePolicy = {
		allowedModels: ['review-model'],
		limits: { maxTokens: 100 },
	};
	const action = {
		kind: 'model.call',
		model: 'review-model',
		tokenReservation: 60,
	} as const;
	let state = createRuntimeState(0);
	assert.equal(
		evaluateRuntime(policy, state, { ...action, model: 'other' }, 0).allowed,
		false,
	);
	state = admitRuntimeAction(policy, state, action, 0);
	assert.equal(evaluateRuntime(policy, state, action, 0).allowed, false);
	state = recordRuntimeOutcome(state, action, { success: true });
	assert.equal(state.tokensReported, 0);
	assert.equal(state.tokenUsageUnknown, true);
	assert.equal(
		evaluateRuntime(policy, state, { ...action, tokenReservation: 1 }, 0)
			.allowed,
		false,
	);
});

test('runtime permits only explicit repair loops and retry identity ignores transport timeouts', () => {
	const policy: RuntimePolicy = {
		phases: [
			{ name: 'inspect', tools: ['file.read'] },
			{ name: 'edit', tools: ['file.write'] },
			{ name: 'verify', tools: ['command'], next: ['edit'] },
		],
	};
	const state = advanceRuntimePhase(createRuntimeState(0), 2);
	assert.equal(evaluatePhaseTransition(policy, state, 'edit').allowed, true);
	assert.equal(
		evaluatePhaseTransition(policy, state, 'inspect').allowed,
		false,
	);
	const failed = recordRuntimeOutcome(
		state,
		{ kind: 'command', executable: 'node', args: ['--test'] },
		{ success: false },
	);
	const action = {
		kind: 'command' as const,
		executable: 'node',
		args: ['--test'],
		timeoutMs: 999,
	};
	assert.equal(
		evaluateRuntime({ limits: { maxRetries: 0 } }, failed, action, 0).allowed,
		false,
	);
	const repaired = admitRuntimeAction(
		{},
		failed,
		{ kind: 'file.write', path: 'src/app.ts', content: 'repair' },
		0,
	);
	assert.equal(
		evaluateRuntime({ limits: { maxRetries: 0 } }, repaired, action, 0).allowed,
		true,
	);
});

test('retrieval-augmented model requests cannot bypass knowledge stage permissions or quotas', () => {
	const state = createRuntimeState(0);
	const action = {
		kind: 'model.call' as const,
		model: 'test',
		tokenReservation: 100,
		knowledgeQuery: 'policy',
	};
	assert.equal(
		evaluateRuntime(
			{ phases: [{ name: 'model-only', tools: ['model.call'] }] },
			state,
			action,
			0,
		).allowed,
		false,
	);
	assert.equal(
		evaluateRuntime({ toolQuotas: { 'knowledge.search': 0 } }, state, action, 0)
			.allowed,
		false,
	);
	const admitted = admitRuntimeAction({}, state, action, 0);
	assert.equal(admitted.toolCalls['model.call'], 1);
	assert.equal(admitted.toolCalls['knowledge.search'], 1);
});
