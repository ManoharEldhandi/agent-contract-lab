import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { SessionEvent } from '@agent-contract-lab/event-schema';

import { evaluateContract, parseContract } from './index';

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