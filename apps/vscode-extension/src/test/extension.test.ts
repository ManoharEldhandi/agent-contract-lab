import * as assert from 'assert';
import { formatInstructionSourceCount, instructionPatterns } from '../instructionSources';

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
