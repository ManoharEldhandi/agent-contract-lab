import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionEvent } from '@agent-contract-lab/event-schema';
import {
	contractFingerprint,
	evaluateAction,
	parseContract,
	type RuntimePolicy,
} from '@agent-contract-lab/policy-engine';

import {
	ContractExecution,
	MAX_PENDING_CONTRACT_ACTIONS,
	type ActionExecutor,
} from './contractExecution';
import type { EventDraft } from './ledger';

function execution(
	executor: ActionExecutor,
	events: EventDraft[],
	failEvidence = false,
	runtimePolicy?: RuntimePolicy,
): ContractExecution {
	const parsed = parseContract({
		version: 1,
		name: 'test',
		assertions: {
			paths: { allow: ['src/**'] },
			commands: { allow: ['node --version'] },
		},
	});
	assert.ok(parsed.ok);
	return new ContractExecution({
		contractName: parsed.contract.name,
		contractSha256: contractFingerprint(parsed.contract),
		runtimePolicy,
		verificationCommands: ['node --version'],
		policy: { evaluate: (action) => evaluateAction(parsed.contract, action) },
		executor,
		evidence: {
			append: async (draft) => {
				if (failEvidence) {
					throw new Error('evidence unavailable');
				}
				events.push(draft);
				return { ...draft, eventId: `evt_${events.length}` } as SessionEvent;
			},
		},
	});
}

test('contract interceptor commits the decision before execution and never invokes refused actions', async () => {
	const events: EventDraft[] = [];
	let calls = 0;
	const session = execution(
		{
			execute: async () => {
				calls += 1;
				assert.equal(events.at(-1)?.kind, 'policy.decision');
				return { success: true, result: { operation: 'created' } };
			},
		},
		events,
	);
	assert.equal(
		(
			await session.run({
				kind: 'file.write',
				path: 'README.md',
				content: 'bad',
			})
		).status,
		'blocked',
	);
	assert.equal(calls, 0);
	assert.equal(
		(
			await session.run({
				kind: 'file.write',
				path: 'src/app.ts',
				content: 'good',
			})
		).status,
		'completed',
	);
	assert.equal(calls, 1);
	assert.deepEqual(
		events
			.filter((entry) => entry.kind === 'policy.decision')
			.map((entry) => entry.payload.allowed),
		[false, true],
	);
	assert.equal(
		events.filter((entry) => entry.kind === 'file.changed').length,
		1,
	);
});

test('contract interceptor fails closed when evidence cannot be committed', async () => {
	let invoked = false;
	const session = execution(
		{
			execute: async () => {
				invoked = true;
				return { success: true, result: {} };
			},
		},
		[],
		true,
	);
	await assert.rejects(
		session.run({ kind: 'file.write', path: 'src/app.ts', content: 'good' }),
		/evidence unavailable/,
	);
	assert.equal(invoked, false);
});

test('contract interceptor serializes actions, snapshots arguments, and drains before closing', async () => {
	const events: EventDraft[] = [];
	const received: string[] = [];
	let active = 0;
	const session = execution(
		{
			execute: async (action) => {
				active += 1;
				assert.equal(active, 1);
				await Promise.resolve();
				received.push(
					action.kind === 'command'
						? action.args.join(' ')
						: 'path' in action
							? action.path
							: action.kind,
				);
				active -= 1;
				return { success: true, result: { exitCode: 0 } };
			},
		},
		events,
	);
	const args = ['--version'];
	const first = session.run({
		kind: 'command',
		executable: 'node',
		args,
		timeoutMs: 1_000,
	});
	args[0] = '--eval=bad';
	const second = session.run({
		kind: 'file.write',
		path: 'src/app.ts',
		content: 'good',
	});
	await session.drain();
	await Promise.all([first, second]);
	assert.deepEqual(received, ['--version', 'src/app.ts']);
	await assert.rejects(
		session.run({ kind: 'file.read', path: 'src/app.ts' }),
		/closing/,
	);
});

test('contract interceptor records execution failure without inventing a file change', async () => {
	const events: EventDraft[] = [];
	const session = execution(
		{
			execute: async () => {
				throw new Error('write refused');
			},
		},
		events,
	);
	const result = await session.run({
		kind: 'file.write',
		path: 'src/app.ts',
		content: 'good',
	});
	assert.equal(result.status, 'failed');
	assert.equal(
		events.some((entry) => entry.kind === 'file.changed'),
		false,
	);
	assert.equal(events.at(-1)?.payload.success, false);
});

test('contract interceptor bounds queued work without invoking excess actions', async () => {
	let release: (() => void) | undefined;
	const held = new Promise<void>((resolve) => {
		release = resolve;
	});
	let calls = 0;
	const session = execution(
		{
			execute: async () => {
				await held;
				calls += 1;
				return { success: true, result: {} };
			},
		},
		[],
	);
	const pending = Array.from({ length: MAX_PENDING_CONTRACT_ACTIONS }, () =>
		session.run({ kind: 'file.read', path: 'src/app.ts' }),
	);
	await assert.rejects(
		session.run({ kind: 'file.read', path: 'src/app.ts' }),
		/queue is full/,
	);
	release!();
	await Promise.all(pending);
	await session.drain();
	assert.equal(calls, MAX_PENDING_CONTRACT_ACTIONS);
});

test('contract runtime enforces phases and completion while keeping refused completion recoverable', async () => {
	const events: EventDraft[] = [];
	const session = execution(
		{ execute: async () => ({ success: true, result: {} }) },
		events,
		false,
		{
			phases: [
				{
					name: 'inspect',
					tools: ['file.read'],
					requireSuccessfulTools: ['file.read'],
				},
				{ name: 'edit', tools: ['file.write'] },
				{ name: 'verify', tools: ['command'] },
			],
			requireReadBeforeWrite: true,
			requireVerificationBeforeComplete: true,
		},
	);
	assert.equal(
		(
			await session.run({
				kind: 'file.write',
				path: 'src/app.ts',
				content: 'x',
			})
		).status,
		'blocked',
	);
	assert.equal((await session.transition('edit')).allowed, false);
	await session.run({ kind: 'file.read', path: 'src/app.ts' });
	assert.equal((await session.transition('edit')).allowed, true);
	await session.run({ kind: 'file.write', path: 'src/app.ts', content: 'x' });
	await assert.rejects(session.drain(true), /runtime.verification/);
	assert.equal((await session.transition('verify')).allowed, true);
	await session.run({
		kind: 'command',
		executable: 'node',
		args: ['--version'],
		timeoutMs: 1_000,
	});
	await session.drain(true);
	assert.equal(session.snapshot().state.actions, 3);
	assert.ok(events.some((event) => event.kind === 'runtime.snapshot'));
});
