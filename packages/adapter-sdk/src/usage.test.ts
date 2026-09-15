import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeAnthropicUsage, normalizeGeminiUsage, normalizeMappedUsage, normalizeOpenAIUsage, normalizeProviderUsage } from './usage';

test('normalizes OpenAI Responses usage and preserves its provider breakdown', () => {
	const result = normalizeOpenAIUsage({
		id: 'resp_123', model: 'gpt-5',
		usage: {
			input_tokens: 100, output_tokens: 60, total_tokens: 160,
			input_tokens_details: { cached_tokens: 40, cache_write_tokens: 10 },
			output_tokens_details: { reasoning_tokens: 25 },
		},
	});

	assert.deepEqual(result, {
		ok: true,
		usage: {
			source: 'provider-reported', provider: 'openai', model: 'gpt-5', providerResponseId: 'resp_123',
			inputTokens: 100, outputTokens: 60, cacheReadTokens: 40, cacheWriteTokens: 10, reasoningTokens: 25, totalTokens: 160,
		},
	});
});

test('normalizes OpenAI-compatible Chat Completions usage', () => {
	const result = normalizeProviderUsage('openai-compatible', {
		id: 'chatcmpl_123', model: 'local-model', object: 'chat.completion',
		usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13, prompt_tokens_details: { cached_tokens: 3 } },
	});

	assert.deepEqual(result, {
		ok: true,
		usage: {
			source: 'provider-reported', provider: 'openai-compatible', model: 'local-model', providerResponseId: 'chatcmpl_123',
			inputTokens: 8, outputTokens: 5, cacheReadTokens: 3, totalTokens: 13,
		},
	});
});

test('computes an Anthropic total from documented component counts', () => {
	const result = normalizeAnthropicUsage({
		id: 'msg_123', model: 'claude-example', type: 'message',
		usage: {
			input_tokens: 50, cache_read_input_tokens: 20, cache_creation_input_tokens: 15, output_tokens: 30,
			output_tokens_details: { thinking_tokens: 18 },
		},
	});

	assert.deepEqual(result, {
		ok: true,
		usage: {
			source: 'computed-from-provider-fields', provider: 'anthropic', model: 'claude-example', providerResponseId: 'msg_123',
			inputTokens: 50, outputTokens: 30, cacheReadTokens: 20, cacheWriteTokens: 15, reasoningTokens: 18, totalTokens: 115,
		},
	});
});

test('normalizes Gemini usageMetadata without deriving a missing provider total', () => {
	const result = normalizeGeminiUsage({
		responseId: 'gem_123', modelVersion: 'gemini-2.5-pro',
		usageMetadata: { promptTokenCount: 70, cachedContentTokenCount: 11, candidatesTokenCount: 30, thoughtsTokenCount: 12, totalTokenCount: 112 },
	});

	assert.deepEqual(result, {
		ok: true,
		usage: {
			source: 'provider-reported', provider: 'gemini', model: 'gemini-2.5-pro', providerResponseId: 'gem_123',
			inputTokens: 70, outputTokens: 30, cacheReadTokens: 11, reasoningTokens: 12, totalTokens: 112,
		},
	});
});

test('supports explicit mapping for any provider or framework response shape', () => {
	const result = normalizeMappedUsage({
		request: { id: 'request-1' }, model: { name: 'private-model' }, meters: { input: 8, output: 5, cache: 3, total: 13 },
	}, {
		provider: 'private-gateway', providerResponseId: 'request.id', model: 'model.name',
		inputTokens: 'meters.input', outputTokens: 'meters.output', cacheReadTokens: 'meters.cache', totalTokens: 'meters.total',
	});

	assert.deepEqual(result, {
		ok: true,
		usage: {
			source: 'provider-reported', provider: 'private-gateway', model: 'private-model', providerResponseId: 'request-1',
			inputTokens: 8, outputTokens: 5, cacheReadTokens: 3, totalTokens: 13,
		},
	});
});

test('does not treat absent, malformed, or ambiguous usage as an exact total', () => {
	assert.deepEqual(normalizeOpenAIUsage({ id: 'resp_123' }), {
		ok: false, reason: 'not-observed', message: 'The OpenAI response did not include a usage object.',
	});
	assert.deepEqual(normalizeOpenAIUsage({ usage: { input_tokens: 3.5, output_tokens: 2, total_tokens: 5.5 } }), {
		ok: false, reason: 'adapter-error', message: 'input_tokens must be a non-negative integer when present',
	});
	assert.deepEqual(normalizeProviderUsage('auto', { usage: { input_tokens: 4, output_tokens: 2 } }), {
		ok: false, reason: 'ambiguous', message: 'Could not determine the provider response format. Pass a provider or TokenUsageMapping explicitly.',
	});
});