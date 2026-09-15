import * as assert from 'assert';
import { formatInstructionSourceCount, instructionPatterns } from '../instructionSources';
import { evidenceBundlePath, parseCommandArray, sessionEventQueryPath } from '../supervisorApi';
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

suite('Managed command input', () => {
	test('accepts an explicit string argument vector and rejects shell-like input', () => {
		assert.deepStrictEqual(parseCommandArray('["npm", "test", "--", "file name"]'), ['npm', 'test', '--', 'file name']);
		assert.strictEqual(parseCommandArray('npm test'), undefined);
		assert.strictEqual(parseCommandArray('["npm", 1]'), undefined);
		assert.strictEqual(parseCommandArray('[]'), undefined);
	});
});

suite('Session event query', () => {
	test('builds a resumable, filterable event query', () => {
		const path = sessionEventQueryPath('ses/demo', {
			afterSequence: 4, kinds: ['file.changed', 'command.completed'], grades: ['observed-boundary'], actors: ['boundary'], path: 'src/app', command: 'npm test',
		});
		const url = new URL(path, 'http://localhost');
		assert.strictEqual(url.pathname, '/v1/sessions/ses%2Fdemo/events');
		assert.strictEqual(url.searchParams.get('afterSequence'), '4');
		assert.deepStrictEqual(url.searchParams.getAll('kind'), ['file.changed', 'command.completed']);
		assert.strictEqual(url.searchParams.get('grade'), 'observed-boundary');
		assert.strictEqual(url.searchParams.get('actor'), 'boundary');
		assert.strictEqual(url.searchParams.get('path'), 'src/app');
		assert.strictEqual(url.searchParams.get('command'), 'npm test');
	});
});

suite('Evidence bundle API', () => {
	test('builds an encoded session evidence bundle path', () => {
		assert.strictEqual(evidenceBundlePath('ses/demo'), '/v1/sessions/ses%2Fdemo/evidence-bundle');
	});
});
