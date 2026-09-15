import assert from 'node:assert/strict';
import { test } from 'node:test';

import { POLICY_RESULTS, isPolicyResult } from './policy';

test('policy result values preserve pass, fail, and evidence gaps', () => {
	assert.deepEqual(POLICY_RESULTS, ['pass', 'fail', 'unknown']);
	assert.equal(isPolicyResult('pass'), true);
	assert.equal(isPolicyResult('unknown'), true);
	assert.equal(isPolicyResult('blocked'), false);
});