import { randomUUID } from 'node:crypto';

import type {
	ContractActionResult,
	JsonObject,
	SessionEvent,
	TokenUsage,
} from '@agent-contract-lab/event-schema';
import {
	admitRuntimeAction,
	advanceRuntimePhase,
	createRuntimeState,
	evaluatePhaseTransition,
	evaluateRuntime,
	evaluateRuntimeCompletion,
	matchesCommand,
	recordRuntimeOutcome,
	type ActionDecision,
	type ProposedAction,
	type RuntimePolicy,
	type RuntimeState,
} from '@agent-contract-lab/policy-engine';

import type { EventDraft } from './ledger';

export const MAX_PENDING_CONTRACT_ACTIONS = 32;

export type ContractAction =
	| {
			readonly kind: 'command';
			readonly executable: string;
			readonly args: readonly string[];
			readonly timeoutMs: number;
	  }
	| {
			readonly kind: 'file.write';
			readonly path: string;
			readonly content: string;
	  }
	| { readonly kind: 'file.read'; readonly path: string }
	| {
			readonly kind: 'knowledge.search';
			readonly query: string;
			readonly limit: number;
	  }
	| {
			readonly kind: 'model.call';
			readonly model: string;
			readonly prompt: string;
			readonly maxOutputTokens: number;
			readonly tokenReservation: number;
			readonly timeoutMs: number;
			readonly knowledgeQuery?: string;
	  };

export interface ActionOutcome {
	readonly success: boolean;
	readonly result: JsonObject;
	readonly usage?: TokenUsage;
}

export interface ActionPolicy {
	evaluate(action: ProposedAction): ActionDecision;
}

export interface ActionExecutor {
	execute(action: ContractAction): Promise<ActionOutcome>;
}

export interface ActionEvidence {
	append(draft: EventDraft): Promise<SessionEvent>;
}

export interface ContractExecutionOptions {
	readonly contractName: string;
	readonly contractSha256: string;
	readonly policy: ActionPolicy;
	readonly executor: ActionExecutor;
	readonly evidence: ActionEvidence;
	readonly runtimePolicy?: RuntimePolicy;
	readonly verificationCommands?: readonly string[];
	readonly now?: () => number;
	readonly recordUsage?: (usage: TokenUsage) => Promise<unknown>;
}

function actionPayload(action: ContractAction): JsonObject {
	if (action.kind === 'command') {
		return {
			tool: action.kind,
			executable: action.executable,
			args: [...action.args],
			timeoutMs: action.timeoutMs,
		};
	}
	if (action.kind === 'knowledge.search') {
		return { tool: action.kind, query: action.query, limit: action.limit };
	}
	if (action.kind === 'model.call') {
		return {
			tool: action.kind,
			model: action.model,
			promptBytes: Buffer.byteLength(action.prompt),
			maxOutputTokens: action.maxOutputTokens,
			tokenReservation: action.tokenReservation,
			usesKnowledge: action.knowledgeQuery !== undefined,
		};
	}
	return {
		tool: action.kind,
		path: action.path,
		...(action.kind === 'file.write'
			? { bytes: Buffer.byteLength(action.content) }
			: {}),
	};
}

function snapshotAction(action: ContractAction): ContractAction {
	return Object.freeze(
		action.kind === 'command'
			? { ...action, args: Object.freeze([...action.args]) }
			: { ...action },
	);
}

export class ContractExecution {
	private tail: Promise<void> = Promise.resolve();
	private accepting = true;
	private pending = 0;
	private state: RuntimeState;
	private readonly clock: () => number;

	constructor(private readonly options: ContractExecutionOptions) {
		this.clock = options.now ?? Date.now;
		this.state = createRuntimeState(this.clock());
	}

	run(action: ContractAction): Promise<ContractActionResult> {
		const snapshot = snapshotAction(action);
		return this.enqueue(() => this.intercept(snapshot));
	}

	snapshot(): {
		readonly contractSha256: string;
		readonly phase: string | null;
		readonly policy: RuntimePolicy;
		readonly state: RuntimeState;
	} {
		return Object.freeze({
			contractSha256: this.options.contractSha256,
			phase:
				this.options.runtimePolicy?.phases?.[this.state.phaseIndex]?.name ??
				null,
			policy: this.options.runtimePolicy ?? {},
			state: this.state,
		});
	}

	transition(target: string): Promise<ActionDecision> {
		return this.enqueue(async () => {
			const decision = evaluatePhaseTransition(
				this.options.runtimePolicy ?? {},
				this.state,
				target,
			);
			await this.append(
				'workflow.transition',
				`phase_${randomUUID()}`,
				{
					target,
					allowed: decision.allowed,
					ruleIds: [...decision.ruleIds],
					message: decision.message,
				},
				true,
			);
			if (decision.allowed) {
				this.state = advanceRuntimePhase(
					this.state,
					this.options.runtimePolicy!.phases!.findIndex(
						(phase) => phase.name === target,
					),
				);
			}
			return decision;
		});
	}

	private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
		if (!this.accepting) {
			return Promise.reject(
				new Error('contract session is closing; no more actions are accepted'),
			);
		}
		if (this.pending >= MAX_PENDING_CONTRACT_ACTIONS) {
			return Promise.reject(new Error('contract session action queue is full'));
		}
		this.pending += 1;
		const result = this.tail.then(operation);
		this.tail = result
			.then(
				() => undefined,
				() => undefined,
			)
			.finally(() => {
				this.pending -= 1;
			});
		return result;
	}

	async drain(requireCompletion = false): Promise<void> {
		this.accepting = false;
		await this.tail;
		if (requireCompletion) {
			const decision = evaluateRuntimeCompletion(
				this.options.runtimePolicy ?? {},
				this.state,
			);
			if (!decision.allowed) {
				this.accepting = true;
				await this.append(
					'policy.decision',
					`complete_${randomUUID()}`,
					{
						phase: 'completion',
						scope: 'supervisor-actions',
						contractName: this.options.contractName,
						ruleId: 'runtime.verification',
						result: 'fail',
						allowed: false,
						message: decision.message,
						contractSha256: this.options.contractSha256,
						ruleIds: [...decision.ruleIds],
						evidenceEventIds: [],
					},
					true,
				);
				throw new Error(decision.message);
			}
		}
	}

	private append(
		kind: EventDraft['kind'],
		correlationId: string,
		payload: JsonObject,
		computed = false,
	): Promise<SessionEvent> {
		return this.options.evidence.append({
			kind,
			actor: 'supervisor-tools',
			evidenceGrade: computed ? 'computed' : 'observed-boundary',
			correlationId,
			payload,
		});
	}

	private async intercept(
		action: ContractAction,
	): Promise<ContractActionResult> {
		const correlationId = `action_${randomUUID()}`;
		const proposed = await this.append(
			'tool.called',
			correlationId,
			actionPayload(action),
		);
		const staticDecision = this.options.policy.evaluate(action);
		const runtimeDecision = evaluateRuntime(
			this.options.runtimePolicy ?? {},
			this.state,
			action,
			this.clock(),
		);
		const ruleIds = Object.freeze([
			...staticDecision.ruleIds,
			...runtimeDecision.ruleIds,
		]);
		const decision = Object.freeze({
			allowed: staticDecision.allowed && runtimeDecision.allowed,
			ruleIds,
			message:
				ruleIds.length === 0
					? staticDecision.message
					: `Action refused by ${ruleIds.join(', ')}.`,
		});
		await this.append(
			'policy.decision',
			correlationId,
			{
				decisionId: `dec_${randomUUID()}`,
				contractName: this.options.contractName,
				ruleId: 'actions.preAction',
				contractSha256: this.options.contractSha256,
				phase: 'pre-action',
				scope: 'supervisor-actions',
				actionKind: action.kind,
				result: decision.allowed ? 'pass' : 'fail',
				allowed: decision.allowed,
				ruleIds: [...decision.ruleIds],
				message: decision.message,
				evidenceEventIds: [proposed.eventId],
			},
			true,
		);
		if (!decision.allowed) {
			await this.append('tool.completed', correlationId, {
				tool: action.kind,
				success: false,
				blocked: true,
			});
			return Object.freeze({
				correlationId,
				status: 'blocked',
				success: false,
				decision,
				result: Object.freeze({}),
			});
		}
		this.state = admitRuntimeAction(
			this.options.runtimePolicy ?? {},
			this.state,
			action,
			this.clock(),
		);
		if (action.kind === 'command') {
			await this.append(
				'command.started',
				correlationId,
				actionPayload(action),
			);
		}
		const outcome = await this.execute(this.boundedAction(action));
		const verification =
			action.kind === 'command' &&
			(this.options.verificationCommands ?? []).some((pattern) =>
				matchesCommand([action.executable, ...action.args].join(' '), pattern),
			);
		this.state = recordRuntimeOutcome(this.state, action, {
			success: outcome.success,
			verification,
			reportedTokens: outcome.usage?.totalTokens,
		});
		if (outcome.usage !== undefined) {
			await this.options.recordUsage?.(outcome.usage);
		}
		await this.recordEffect(action, correlationId, outcome);
		await this.append('tool.completed', correlationId, {
			tool: action.kind,
			success: outcome.success,
			result: outcome.result,
		});
		if (this.options.runtimePolicy !== undefined) {
			await this.append(
				'runtime.snapshot',
				correlationId,
				JSON.parse(JSON.stringify(this.snapshot())) as JsonObject,
				true,
			);
		}
		return Object.freeze({
			...outcome,
			correlationId,
			status: outcome.success ? 'completed' : 'failed',
			decision,
		});
	}

	private boundedAction(action: ContractAction): ContractAction {
		if (action.kind !== 'command' && action.kind !== 'model.call') {
			return action;
		}
		const limits = this.options.runtimePolicy?.limits;
		const remaining =
			limits?.maxDurationMs === undefined
				? 30_000
				: Math.max(
						1,
						limits.maxDurationMs - (this.clock() - this.state.startedAt),
					);
		return Object.freeze({
			...action,
			timeoutMs: Math.min(
				action.timeoutMs,
				limits?.maxActionDurationMs ?? 30_000,
				remaining,
			),
		});
	}

	private async execute(action: ContractAction): Promise<ActionOutcome> {
		try {
			return await this.options.executor.execute(action);
		} catch (error) {
			return {
				success: false,
				result: {
					message: error instanceof Error ? error.message : String(error),
				},
			};
		}
	}

	private async recordEffect(
		action: ContractAction,
		correlationId: string,
		outcome: ActionOutcome,
	): Promise<void> {
		if (action.kind === 'command') {
			await this.append('command.completed', correlationId, {
				...outcome.result,
				succeeded: outcome.success,
			});
		} else if (action.kind === 'model.call') {
			await this.append('model.completed', correlationId, {
				model: action.model,
				success: outcome.success,
				tokensReported: outcome.usage?.totalTokens ?? null,
			});
		} else if (action.kind === 'knowledge.search') {
			await this.append('knowledge.retrieved', correlationId, outcome.result);
		} else if (outcome.success) {
			await this.append(
				action.kind === 'file.read' ? 'file.read' : 'file.changed',
				correlationId,
				{
					path: action.path.replace(/\\/g, '/'),
					tool: action.kind,
					...(action.kind === 'file.write'
						? { operation: outcome.result.operation ?? 'modified' }
						: {}),
				},
			);
		}
	}
}
