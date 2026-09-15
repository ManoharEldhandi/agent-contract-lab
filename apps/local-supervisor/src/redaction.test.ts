import assert from 'node:assert/strict';
import { test } from 'node:test';

import { REDACTED_VALUE, redactJson, redactText } from './redaction';

test('redacts common credential forms from text', () => {
	const input = 'Authorization: Bearer abcdefghijklmnop and token=very-secret-value and sk-abcdefghijklmnopqrstuv';
	const result = redactText(input);
	assert.doesNotMatch(result.value, /abcdefghijklmnop|very-secret-value|sk-abcdefghijklmnopqrstuv/);
	assert.match(result.value, new RegExp(REDACTED_VALUE.replace(/[\[\]]/g, '\\$&')));
	assert.ok(result.replacements >= 3);
});

test('redacts recursively without mutating the structured event payload', () => {
	const payload = {
		tool: 'request',
		arguments: { apiKey: 'top-secret-key', nested: ['ok', 'password: hidden-value'] },
	};
	const result = redactJson(payload);
	assert.equal(payload.arguments.apiKey, 'top-secret-key');
	assert.equal(JSON.stringify(result.value).includes('top-secret-key'), false);
	assert.equal(JSON.stringify(result.value).includes('hidden-value'), false);
	assert.equal(result.replacements, 2);
});