import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionEvent } from '@agent-contract-lab/event-schema';

import { contractFingerprint, evaluateAction, evaluateContract, parseContract } from './index';

function event(sequence: number, kind: SessionEvent['kind'], payload: SessionEvent['payload'], overrides: Partial<SessionEvent> = {}): SessionEvent {
	return {
		schemaVersion: 1,
		eventId: `evt_${sequence}`,
		sessionId: 'ses_policy',
		sequence,
		occurredAt: '2026-09-15T12:00:00.000Z',
		kind,
		actor: 'boundary',
		evidenceGrade: 'observed-boundary',
		payload,
		redaction: { policyVersion: '1', replacements: 0, truncated: false },
		...overrides,
	};
}

test('rejects malformed or unsupported contract input before evaluation', () => {
	assert.equal(parseContract({ version: 2, name: '' }).ok, false);
	assert.equal(parseContract({ version: 1, name: 'bad', assertions: { evidence: { require: ['model-intent'] } } }).ok, false);
	assert.equal(parseContract({ version: 1, name: 'typo', assertions: { commands: { alow: ['node'] } } }).ok, false);
	assert.equal(parseContract({ version: 1, name: 'oversized', assertions: { commands: { deny: ['*'.repeat(1_025)] } } }).ok, false);
});

test('pre-action command policy gives deny precedence over allow and checks executable basenames', () => {
	const parsed = parseContract({ version: 1, name: 'guarded', assertions: { commands: { allow: ['**'], deny: ['rm -rf *'] } } });
	assert.ok(parsed.ok);
	assert.equal(evaluateAction(parsed.contract, { kind: 'command', executable: 'node', args: ['--version'] }).allowed, true);
	assert.deepEqual(evaluateAction(parsed.contract, { kind: 'command', executable: '/bin/rm', args: ['-rf', 'src'] }).ruleIds, ['commands.deny[0]']);
	assert.equal(evaluateAction(parsed.contract, { kind: 'command', executable: '/bin/rm', args: ['-rf', '/tmp/important'] }).allowed, false);
	const restricted = parseContract({ version: 1, name: 'restricted', assertions: { commands: { allow: ['node --version'] } } });
	assert.ok(restricted.ok);
	assert.equal(evaluateAction(restricted.contract, { kind: 'command', executable: 'sh', args: ['-c', 'node --version'] }).allowed, false);
});

test('pre-action file policy rejects traversal and normalizes relative paths before matching', () => {
	const parsed = parseContract({ version: 1, name: 'source-only', assertions: { paths: { allow: ['src/**'], deny: ['src/secrets/**'] } } });
	assert.ok(parsed.ok);
	assert.equal(evaluateAction(parsed.contract, { kind: 'file.write', path: './src/app.ts' }).allowed, true);
	for (const path of ['../src/app.ts', 'src/../README.md', '/src/app.ts', 'C:\\src\\app.ts', 'src/secrets/key.txt', 'README.md', '.']) {
		assert.equal(evaluateAction(parsed.contract, { kind: 'file.write', path }).allowed, false, path);
	}
});

test('parsed contracts and action decisions are immutable and detached from caller arrays', () => {
	const deny = ['rm *'];
	const parsed = parseContract({ version: 1, name: 'immutable', assertions: { commands: { deny } } });
	assert.ok(parsed.ok);
	deny.length = 0;
	const decision = evaluateAction(parsed.contract, { kind: 'command', executable: 'rm', args: ['file'] });
	assert.equal(decision.allowed, false);
	assert.ok(Object.isFrozen(parsed.contract));
	assert.ok(Object.isFrozen(parsed.contract.assertions?.commands?.deny));
	assert.ok(Object.isFrozen(decision.ruleIds));
});

test('fails observed forbidden commands and passes retained command evidence', () => {
	const parsed = parseContract({ version: 1, name: 'no-delete', assertions: { commands: { deny: ['rm -rf *'] }, evidence: { require: ['command-result'] } } });
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	const decisions = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [
			event(1, 'process.started', { executable: 'rm', args: ['-rf', 'tmp'] }, { correlationId: 'cmd_1' }),
			event(2, 'process.completed', { succeeded: true, exitCode: 0 }, { correlationId: 'cmd_1' }),
		],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.deepEqual(decisions.map((decision) => decision.result), ['fail', 'pass']);
	assert.deepEqual(decisions[0]?.evidenceEventIds, ['evt_1']);
});

test('evaluates observed commands that have no arguments', () => {
	const parsed = parseContract({ version: 1, name: 'no-git-clean', assertions: { commands: { deny: ['git'] } } });
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	const decisions = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [event(1, 'command.started', { executable: 'git' })],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.equal(decisions[0]?.result, 'fail');
});

test('a retained failed required command is a failure rather than missing evidence', () => {
	const parsed = parseContract({ version: 1, name: 'tests', assertions: { commands: { requireSuccess: ['node --test src/**'] } } });
	assert.ok(parsed.ok);
	const decisions = evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [
		event(1, 'command.started', { executable: 'node', args: ['--test', 'src/app.test.ts'] }, { correlationId: 'test' }),
		event(2, 'command.completed', { succeeded: false, exitCode: 1 }, { correlationId: 'test' }),
	] });
	assert.equal(decisions[0]?.result, 'fail');
});

test('pre-action evidence requires the exact contract hash and a prior correlated supervisor decision', () => {
	const parsed = parseContract({ version: 1, name: 'guard', assertions: { commands: { requirePreAction: true } } });
	assert.ok(parsed.ok);
	const contractSha256 = contractFingerprint(parsed.contract);
	const attached = event(1, 'instruction.loaded', { scope: 'supervisor-actions', contractSha256 }, { actor: 'supervisor', evidenceGrade: 'computed' });
	const decision = event(2, 'policy.decision', { phase: 'pre-action', scope: 'supervisor-actions', allowed: true, contractSha256 }, { actor: 'supervisor-tools', evidenceGrade: 'computed', correlationId: 'cmd' });
	const started = event(3, 'command.started', { executable: 'node' }, { actor: 'supervisor-tools', correlationId: 'cmd' });
	assert.equal(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [attached, decision, started] })[0]?.result, 'pass');
	assert.equal(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [attached, started] })[0]?.result, 'unknown');
	assert.equal(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [attached, { ...decision, evidenceGrade: 'model-declared' }, started] })[0]?.result, 'unknown');
	assert.equal(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [attached, { ...decision, payload: { ...decision.payload, contractSha256: 'different' } }, started] })[0]?.result, 'unknown');
});

test('reports an explicit unknown when path or pre-action evidence is unavailable', () => {
	const parsed = parseContract({ version: 1, name: 'safe-paths', assertions: { paths: { allow: ['src/**'] }, commands: { requirePreAction: true }, evidence: { require: ['filesystem-diff'] } } });
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	const decisions = evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [], now: () => new Date('2026-09-15T12:00:00.000Z') });
	assert.deepEqual(decisions.map((decision) => [decision.result, decision.unknownReason]), [
		['unknown', 'unsupported-capability'],
		['unknown', 'not-observed'],
		['unknown', 'not-observed'],
	]);
});

test('fails observed changed paths outside the allow list', () => {
	const parsed = parseContract({ version: 1, name: 'source-only', assertions: { paths: { allow: ['src/**'] } } });
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	const decisions = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [event(1, 'file.changed', { path: 'infra/production.yml', operation: 'modified' })],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.equal(decisions[0]?.result, 'fail');
	assert.deepEqual(decisions[0]?.evidenceEventIds, ['evt_1']);
});

test('pre-action and post-action file rules use the same canonical relative path', () => {
	const parsed = parseContract({ version: 1, name: 'canonical-paths', assertions: { paths: { allow: ['src/**'] } } });
	assert.ok(parsed.ok);
	for (const path of ['./src/app.ts', 'src//app.ts', 'src\\app.ts']) {
		assert.equal(evaluateAction(parsed.contract, { kind: 'file.write', path }).allowed, true);
		assert.equal(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [event(1, 'file.changed', { path })] })[0]?.result, 'pass');
	}
});

test('path assertions include command side effects from complete supervisor Git snapshots', () => {
	const parsed = parseContract({ version: 1, name: 'source-only', assertions: { paths: { allow: ['src/**'], deny: ['infra/**'] } } });
	assert.ok(parsed.ok);
	const snapshot = (paths: string[], baseline: string[] = [], changedSinceStart = true, truncated = false): SessionEvent => event(1, 'workspace.diff', {
		baseline: { paths: baseline, diffSha256: 'before' }, current: { paths, diffSha256: 'after', truncated }, changedSinceStart,
	});
	assert.deepEqual(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [snapshot(['infra/prod.yml'])] }).map((decision) => decision.result), ['fail', 'fail']);
	assert.deepEqual(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [snapshot([])] }).map((decision) => decision.result), ['pass', 'pass']);
	assert.deepEqual(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [snapshot(['README.md'], ['README.md'], false)] }).map((decision) => decision.result), ['pass', 'pass']);
	assert.deepEqual(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [snapshot(['README.md'], ['README.md'])] }).map((decision) => decision.result), ['unknown', 'unknown']);
	assert.deepEqual(evaluateContract(parsed.contract, { sessionId: 'ses_policy', events: [snapshot([], [], true, true)] }).map((decision) => decision.result), ['unknown', 'unknown']);
});

test('requires a supervisor-observed workspace diff for filesystem-diff evidence', () => {
	const parsed = parseContract({ version: 1, name: 'requires-diff', assertions: { evidence: { require: ['filesystem-diff'] } } });
	assert.equal(parsed.ok, true);
	if (!parsed.ok) {
		return;
	}
	const declaredOnly = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [event(1, 'file.changed', { path: 'src/app.ts', operation: 'modified' }, { evidenceGrade: 'model-declared' })],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.equal(declaredOnly[0]?.result, 'unknown');
	const observedDiff = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [event(2, 'workspace.diff', { baseline: { paths: [], diffSha256: 'a', dirty: false }, current: { paths: ['src/app.ts'], diffSha256: 'b', truncated: false }, changedSinceStart: true, diff: 'diff --git a/src/app.ts b/src/app.ts' })],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.equal(observedDiff[0]?.result, 'pass');
	assert.deepEqual(observedDiff[0]?.evidenceEventIds, ['evt_2']);
	const malformedDiff = evaluateContract(parsed.contract, {
		sessionId: 'ses_policy',
		events: [event(3, 'workspace.diff', { baseline: { paths: [] }, current: { paths: ['src/app.ts'] }, changedSinceStart: true, diff: 'diff' })],
		now: () => new Date('2026-09-15T12:00:00.000Z'),
	});
	assert.equal(malformedDiff[0]?.result, 'unknown');
});