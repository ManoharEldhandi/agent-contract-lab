import * as assert from 'assert';
import { formatInstructionSourceCount, instructionPatterns } from '../instructionSources';
import { describeConnection, interpretHealthJson } from '../supervisorClient';

suite('Extension Test Suite', () => {
	test('recognizes the supported repository instruction locations', () => {
		assert.deepStrictEqual(instructionPatterns, [
			'**/AGENTS.md',
			'**/CLAUDE.md',
			'**/.github/copilot-instructions.md',
			'**/.github/instructions/**/*.instructions.md',
		]);
		assert.strictEqual(formatInstructionSourceCount(1), '1 instruction source discovered');
		assert.strictEqual(formatInstructionSourceCount(2), '2 instruction sources discovered');
	});
});

suite('Supervisor client', () => {
	const validHealth = {
		status: 'ok',
		supervisorVersion: '0.1.0',
		apiVersion: '1.0',
		schemaVersion: 1,
		instanceId: 'sup_x',
		startedAt: '2026-09-11T14:00:00.000Z',
		capabilities: { adapters: [], features: ['health'] },
	};

	test('interprets a valid health body as connected', () => {
		const connection = interpretHealthJson(validHealth);
		assert.strictEqual(connection.kind, 'connected');
	});

	test('flags an incompatible API major', () => {
		const connection = interpretHealthJson({ ...validHealth, apiVersion: '2.0' });
		assert.strictEqual(connection.kind, 'incompatible');
	});

	test('rejects a malformed health body', () => {
		assert.strictEqual(interpretHealthJson({ status: 'ok' }).kind, 'malformed');
		assert.strictEqual(interpretHealthJson(null).kind, 'malformed');
	});

	test('describeConnection returns a label and detail', () => {
		const detail = describeConnection(interpretHealthJson(validHealth));
		assert.ok(detail.label.includes('connected'));
		assert.ok(detail.detail.length > 0);
	});
});
