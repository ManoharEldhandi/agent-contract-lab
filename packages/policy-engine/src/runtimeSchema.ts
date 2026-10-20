import { z } from 'zod';

import { RUNTIME_TOOLS, type RuntimePolicy } from './runtime';

const count = z.number().int().min(0).max(1_000_000_000);
const positive = z.number().int().min(1).max(1_000_000_000);
const tool = z.enum(RUNTIME_TOOLS);
const phase = z
	.object({
		name: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
		tools: z.array(tool).max(RUNTIME_TOOLS.length),
		requireSuccessfulTools: z.array(tool).max(RUNTIME_TOOLS.length).optional(),
		next: z
			.array(z.string().regex(/^[a-z][a-z0-9-]{0,31}$/))
			.max(8)
			.optional(),
	})
	.strict()
	.refine(
		(value) =>
			(value.requireSuccessfulTools ?? []).every((name) =>
				value.tools.includes(name),
			),
		'Phase prerequisites must be tools allowed in that phase.',
	);

const runtimeSchema = z
	.object({
		phases: z
			.array(phase)
			.min(1)
			.max(8)
			.refine(
				(values) =>
					new Set(values.map((value) => value.name)).size === values.length,
				'Phase names must be unique.',
			)
			.refine(
				(values) =>
					values.every((value) =>
						(value.next ?? []).every((target) =>
							values.some((candidate) => candidate.name === target),
						),
					),
				'Transitions must reference defined phases.',
			)
			.optional(),
		limits: z
			.object({
				maxDurationMs: positive.max(4 * 60 * 60 * 1_000).optional(),
				maxActionDurationMs: positive.max(30_000).optional(),
				maxTokens: count.optional(),
				maxRetries: count.max(20).optional(),
				maxActions: count.max(10_000).optional(),
				maxConsecutiveFailures: positive.max(100).optional(),
				maxChangedFiles: count.max(1_000).optional(),
				maxWriteBytes: count.max(16 * 1024 * 1024).optional(),
				maxOutputBytes: positive.max(64 * 1024).optional(),
				maxActionsPerWindow: positive.max(10_000).optional(),
				windowMs: positive.max(60 * 60 * 1_000).optional(),
			})
			.strict()
			.optional(),
		toolQuotas: z
			.object({
				'file.read': count.optional(),
				'file.write': count.optional(),
				command: count.optional(),
				'model.call': count.optional(),
				'knowledge.search': count.optional(),
			})
			.strict()
			.optional(),
		requireReadBeforeWrite: z.boolean().optional(),
		requireVerificationBeforeComplete: z.boolean().optional(),
		allowedModels: z.array(z.string().min(1).max(128)).max(64).optional(),
	})
	.strict();

function immutable<Value>(value: Value): Value {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			immutable(child);
		}
		Object.freeze(value);
	}
	return value;
}

export function parseRuntimePolicy(
	input: unknown,
):
	| { readonly ok: true; readonly policy: RuntimePolicy }
	| { readonly ok: false; readonly issues: readonly string[] } {
	const result = runtimeSchema.safeParse(input);
	return result.success
		? { ok: true, policy: immutable(result.data) }
		: {
				ok: false,
				issues: result.error.issues.map(
					(issue) => `runtime.${issue.path.join('.')}: ${issue.message}`,
				),
			};
}
