import { createHash } from 'node:crypto';

import type { ActionDecision } from '@agent-contract-lab/event-schema';

export const RUNTIME_TOOLS = [
	'file.read',
	'file.write',
	'command',
	'model.call',
	'knowledge.search',
] as const;
export type RuntimeTool = (typeof RUNTIME_TOOLS)[number];

export interface WorkflowPhase {
	readonly name: string;
	readonly tools: readonly RuntimeTool[];
	readonly requireSuccessfulTools?: readonly RuntimeTool[];
	readonly next?: readonly string[];
}

export interface RuntimeLimits {
	readonly maxDurationMs?: number;
	readonly maxActionDurationMs?: number;
	readonly maxTokens?: number;
	readonly maxRetries?: number;
	readonly maxActions?: number;
	readonly maxConsecutiveFailures?: number;
	readonly maxChangedFiles?: number;
	readonly maxWriteBytes?: number;
	readonly maxOutputBytes?: number;
	readonly maxActionsPerWindow?: number;
	readonly windowMs?: number;
}

export interface RuntimePolicy {
	readonly phases?: readonly WorkflowPhase[];
	readonly limits?: RuntimeLimits;
	readonly toolQuotas?: Readonly<Partial<Record<RuntimeTool, number>>>;
	readonly requireReadBeforeWrite?: boolean;
	readonly requireVerificationBeforeComplete?: boolean;
	readonly allowedModels?: readonly string[];
}

export interface RuntimeAction {
	readonly kind: RuntimeTool;
	readonly path?: string;
	readonly content?: string;
	readonly executable?: string;
	readonly args?: readonly string[];
	readonly model?: string;
	readonly tokenReservation?: number;
	readonly knowledgeQuery?: string;
	readonly prompt?: string;
	readonly query?: string;
}

export interface RuntimeState {
	readonly startedAt: number;
	readonly phaseIndex: number;
	readonly actions: number;
	readonly toolCalls: Readonly<Partial<Record<RuntimeTool, number>>>;
	readonly successfulTools: readonly RuntimeTool[];
	readonly readPaths: readonly string[];
	readonly changedPaths: readonly string[];
	readonly writtenBytes: number;
	readonly tokensCharged: number;
	readonly tokensReported: number;
	readonly tokenUsageUnknown: boolean;
	readonly failures: Readonly<Record<string, number>>;
	readonly consecutiveFailures: number;
	readonly recentActions: readonly number[];
	readonly writeRevision: number;
	readonly verifiedRevision: number;
}

export interface RuntimeOutcome {
	readonly success: boolean;
	readonly verification?: boolean;
	readonly reportedTokens?: number;
}

function freeze<Value>(value: Value): Value {
	if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
		for (const child of Object.values(value)) {
			freeze(child);
		}
		Object.freeze(value);
	}
	return value;
}

function actionPath(action: RuntimeAction): string {
	return (action.path ?? '')
		.replace(/\\/g, '/')
		.split('/')
		.filter((part) => part !== '' && part !== '.')
		.join('/');
}

function actionKey(action: RuntimeAction, revision: number): string {
	return createHash('sha256')
		.update(
			JSON.stringify({
				kind: action.kind,
				path: action.path === undefined ? undefined : actionPath(action),
				executable: action.executable,
				args: action.args,
				content: action.content,
				model: action.model,
				prompt: action.prompt,
				query: action.query,
				knowledgeQuery: action.knowledgeQuery,
				revision:
					action.kind === 'command' || action.kind === 'model.call'
						? revision
						: 0,
			}),
		)
		.digest('hex');
}

function decision(ruleIds: readonly string[]): ActionDecision {
	return freeze({
		allowed: ruleIds.length === 0,
		ruleIds: [...ruleIds],
		message:
			ruleIds.length === 0
				? 'Runtime policy permits this action.'
				: `Runtime policy refused: ${ruleIds.join(', ')}.`,
	});
}

export function createRuntimeState(now: number): RuntimeState {
	return freeze({
		startedAt: now,
		phaseIndex: 0,
		actions: 0,
		toolCalls: {},
		successfulTools: [],
		readPaths: [],
		changedPaths: [],
		writtenBytes: 0,
		tokensCharged: 0,
		tokensReported: 0,
		tokenUsageUnknown: false,
		failures: {},
		consecutiveFailures: 0,
		recentActions: [],
		writeRevision: 0,
		verifiedRevision: -1,
	});
}

export function evaluateRuntime(
	policy: RuntimePolicy,
	state: RuntimeState,
	action: RuntimeAction,
	now: number,
): ActionDecision {
	const denied: string[] = [];
	const limits = policy.limits ?? {};
	const phase = policy.phases?.[state.phaseIndex];
	const tools: readonly RuntimeTool[] =
		action.kind === 'model.call' && action.knowledgeQuery !== undefined
			? [action.kind, 'knowledge.search']
			: [action.kind];
	if (
		phase !== undefined &&
		tools.some((tool) => !phase.tools.includes(tool))
	) {
		denied.push('runtime.phase.tools');
	}
	if (
		limits.maxDurationMs !== undefined &&
		now - state.startedAt >= limits.maxDurationMs
	) {
		denied.push('runtime.duration');
	}
	if (limits.maxActions !== undefined && state.actions >= limits.maxActions) {
		denied.push('runtime.actions');
	}
	if (
		tools.some(
			(tool) =>
				policy.toolQuotas?.[tool] !== undefined &&
				(state.toolCalls[tool] ?? 0) >= policy.toolQuotas[tool]!,
		)
	) {
		denied.push('runtime.toolQuota');
	}
	if (
		limits.maxRetries !== undefined &&
		(state.failures[actionKey(action, state.writeRevision)] ?? 0) >
			limits.maxRetries
	) {
		denied.push('runtime.retries');
	}
	if (
		limits.maxConsecutiveFailures !== undefined &&
		state.consecutiveFailures >= limits.maxConsecutiveFailures
	) {
		denied.push('runtime.circuitBreaker');
	}
	if (
		limits.maxActionsPerWindow !== undefined &&
		state.recentActions.filter(
			(time) => now - time < (limits.windowMs ?? 60_000),
		).length >= limits.maxActionsPerWindow
	) {
		denied.push('runtime.rateLimit');
	}
	if (action.kind === 'file.write') {
		const path = actionPath(action);
		if (policy.requireReadBeforeWrite && !state.readPaths.includes(path)) {
			denied.push('runtime.readBeforeWrite');
		}
		if (
			limits.maxChangedFiles !== undefined &&
			!state.changedPaths.includes(path) &&
			state.changedPaths.length >= limits.maxChangedFiles
		) {
			denied.push('runtime.changedFiles');
		}
		if (
			limits.maxWriteBytes !== undefined &&
			state.writtenBytes + Buffer.byteLength(action.content ?? '') >
				limits.maxWriteBytes
		) {
			denied.push('runtime.writeBytes');
		}
	}
	if (action.kind === 'model.call') {
		if (
			policy.allowedModels !== undefined &&
			!policy.allowedModels.includes(action.model ?? '')
		) {
			denied.push('runtime.model');
		}
		if (
			limits.maxTokens !== undefined &&
			(state.tokenUsageUnknown ||
				action.tokenReservation === undefined ||
				state.tokensCharged + action.tokenReservation > limits.maxTokens)
		) {
			denied.push('runtime.tokens');
		}
	}
	return decision(denied);
}

export function admitRuntimeAction(
	policy: RuntimePolicy,
	state: RuntimeState,
	action: RuntimeAction,
	now: number,
): RuntimeState {
	const path = actionPath(action);
	const isWrite = action.kind === 'file.write';
	const toolCalls = {
		...state.toolCalls,
		[action.kind]: (state.toolCalls[action.kind] ?? 0) + 1,
	};
	if (action.kind === 'model.call' && action.knowledgeQuery !== undefined) {
		toolCalls['knowledge.search'] =
			(state.toolCalls['knowledge.search'] ?? 0) + 1;
	}
	return freeze({
		...state,
		actions: state.actions + 1,
		toolCalls,
		recentActions: [
			...state.recentActions.filter(
				(time) => now - time < (policy.limits?.windowMs ?? 60_000),
			),
			now,
		],
		changedPaths:
			isWrite && !state.changedPaths.includes(path)
				? [...state.changedPaths, path]
				: state.changedPaths,
		writtenBytes:
			state.writtenBytes +
			(isWrite ? Buffer.byteLength(action.content ?? '') : 0),
		writeRevision: state.writeRevision + (isWrite ? 1 : 0),
		tokensCharged:
			state.tokensCharged +
			(action.kind === 'model.call' ? (action.tokenReservation ?? 0) : 0),
	});
}

export function recordRuntimeOutcome(
	state: RuntimeState,
	action: RuntimeAction,
	outcome: RuntimeOutcome,
): RuntimeState {
	const path = actionPath(action);
	const isModel = action.kind === 'model.call';
	const reported = outcome.reportedTokens;
	return freeze({
		...state,
		successfulTools:
			outcome.success && !state.successfulTools.includes(action.kind)
				? [...state.successfulTools, action.kind]
				: state.successfulTools,
		readPaths:
			outcome.success &&
			action.kind === 'file.read' &&
			!state.readPaths.includes(path)
				? [...state.readPaths, path]
				: state.readPaths,
		failures: outcome.success
			? state.failures
			: {
					...state.failures,
					[actionKey(action, state.writeRevision)]:
						(state.failures[actionKey(action, state.writeRevision)] ?? 0) + 1,
				},
		consecutiveFailures: outcome.success ? 0 : state.consecutiveFailures + 1,
		tokensCharged:
			state.tokensCharged +
			(isModel && reported !== undefined
				? Math.max(0, reported - (action.tokenReservation ?? 0))
				: 0),
		tokensReported: state.tokensReported + (isModel ? (reported ?? 0) : 0),
		tokenUsageUnknown:
			state.tokenUsageUnknown || (isModel && reported === undefined),
		verifiedRevision:
			outcome.success && outcome.verification
				? state.writeRevision
				: state.verifiedRevision,
	});
}

export function evaluatePhaseTransition(
	policy: RuntimePolicy,
	state: RuntimeState,
	target: string,
): ActionDecision {
	const phases = policy.phases ?? [];
	const current = phases[state.phaseIndex];
	const next = phases[state.phaseIndex + 1];
	const allowed = current?.next ?? (next === undefined ? [] : [next.name]);
	if (
		!allowed.includes(target) ||
		!phases.some((phase) => phase.name === target)
	) {
		return decision(['runtime.phase.order']);
	}
	if (
		current?.requireSuccessfulTools?.some(
			(tool) => !state.successfulTools.includes(tool),
		)
	) {
		return decision(['runtime.phase.prerequisite']);
	}
	return decision([]);
}

export function advanceRuntimePhase(
	state: RuntimeState,
	phaseIndex = state.phaseIndex + 1,
): RuntimeState {
	return freeze({ ...state, phaseIndex, successfulTools: [] });
}

export function evaluateRuntimeCompletion(
	policy: RuntimePolicy,
	state: RuntimeState,
): ActionDecision {
	return decision(
		policy.requireVerificationBeforeComplete &&
			state.verifiedRevision !== state.writeRevision
			? ['runtime.verification']
			: [],
	);
}
