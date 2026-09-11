import assert from 'node:assert/strict';
import { test } from 'node:test';

import { EVIDENCE_GRADES, isEvidenceGrade, isUnknownReason, UNKNOWN_REASONS } from './evidence';

test('evidence grades are the five documented values', () => {
	assert.deepEqual(EVIDENCE_GRADES, [
		'observed-native',
		'observed-boundary',
		'computed',
		'model-declared',
		'unknown',
	]);
});

test('isEvidenceGrade guards membership', () => {
	assert.equal(isEvidenceGrade('observed-native'), true);
	assert.equal(isEvidenceGrade('unknown'), true);
	assert.equal(isEvidenceGrade('made-up'), false);
	assert.equal(isEvidenceGrade(1), false);
});

test('unknown reasons include capability and observation gaps', () => {
	assert.ok(UNKNOWN_REASONS.includes('unsupported-capability'));
	assert.ok(UNKNOWN_REASONS.includes('not-observed'));
	assert.ok(UNKNOWN_REASONS.includes('redacted'));
	assert.equal(isUnknownReason('timeout'), true);
	assert.equal(isUnknownReason('nonsense'), false);
});
