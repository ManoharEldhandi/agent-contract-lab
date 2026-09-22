import { spawn, type SpawnOptions } from 'node:child_process';
import { basename, relative } from 'node:path';
import { createInterface, type Interface } from 'node:readline';

import { normalizeOpenAIUsage } from '@agent-contract-lab/adapter-sdk';
import type { JsonObject, JsonValue, SessionState, TokenUsage } from '@agent-contract-lab/event-schema';

import type { EventDraft } from './ledger';
import { SUPERVISOR_VERSION } from './version';

const REQUEST_TIMEOUT_MS = 12_000;
const INTERRUPT_GRACE_MS = 3_000;
const TRANSIENT_NOTIFICATION_METHODS = new Set([
	'remoteControl/status/changed',
	'mcpServer/startupStatus/updated',
	'account/rateLimits/updated',
]);

export interface CodexRelayOptions {
	readonly sessionId: string;
	readonly workspacePath: string;
	readonly task: string;
	readonly model?: string;
	readonly maxDurationMs: number;
	readonly maxTokens?: number;
}

export interface CodexRelaySink {
	append(draft: EventDraft): Promise<unknown>;
	recordUsage(usage: TokenUsage): Promise<unknown>;
	complete(state: Extract<SessionState, 'completed' | 'failed' | 'interrupted'>): Promise<unknown>;
}

export interface CodexChild {
	readonly stdin: NodeJS.WritableStream | null;
	readonly stdout: NodeJS.ReadableStream | null;
	readonly stderr: NodeJS.ReadableStream | null;
	kill(signal?: NodeJS.Signals): boolean;
	once(event: 'error' | 'close', listener: (...argumentsValue: unknown[]) => void): unknown;
}

export type SpawnCodex = (command: string, argumentsValue: readonly string[], options: SpawnOptions) => CodexChild;

export interface CodexRelayDependencies {
	readonly spawnCodex?: SpawnCodex;
	readonly now?: () => number;
	readonly onFinished?: (sessionId: string) => void;
}

export interface CodexRelayControl {
	start(): Promise<void>;
	cancel(reason?: string): Promise<void>;
	shutdown(): Promise<void>;
}

export type CodexRelayFactory = (
	sink: CodexRelaySink,
	options: CodexRelayOptions,
	onFinished: (sessionId: string) => void,
) => CodexRelayControl;

export const createCodexRelay: CodexRelayFactory = (sink, options, onFinished) => new CodexAppServerRelay(sink, options, { onFinished });

interface RpcMessage {
	readonly id?: number;
	readonly method?: string;
	readonly params?: unknown;
	readonly result?: unknown;
	readonly error?: { readonly message?: unknown };
}

interface PendingRequest {
	readonly resolve: (result: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

interface TokenSnapshot {
	readonly inputTokens: number;
	readonly outputTokens: number;
	readonly cacheReadTokens: number;
	readonly cacheWriteTokens: number;
	readonly reasoningTokens: number;
	readonly totalTokens: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function jsonObject(value: unknown): JsonObject {
	return asRecord(value) as JsonObject | undefined ?? {};
}

function relativePath(value: unknown, workspacePath: string): string | undefined {
	const source = stringValue(value);
	if (source === undefined) {
		return undefined;
	}
	const candidate = relative(workspacePath, source);
	return candidate !== '' && !candidate.startsWith('..') && !candidate.includes('/../') ? candidate : basename(source);
}

function terminalState(status: unknown): Extract<SessionState, 'completed' | 'failed' | 'interrupted'> {
	return status === 'interrupted' || status === 'cancelled' ? 'interrupted' : status === 'failed' ? 'failed' : 'completed';
}

function tokenSnapshot(usage: TokenUsage): TokenSnapshot {
	return {
		inputTokens: usage.inputTokens ?? 0,
		outputTokens: usage.outputTokens ?? 0,
		cacheReadTokens: usage.cacheReadTokens ?? 0,
		cacheWriteTokens: usage.cacheWriteTokens ?? 0,
		reasoningTokens: usage.reasoningTokens ?? 0,
		totalTokens: usage.totalTokens ?? 0,
	};
}

function usageDelta(current: TokenUsage, previous: TokenSnapshot | undefined): TokenUsage | undefined {
	if (previous === undefined) {
		return current;
	}
	const snapshot = tokenSnapshot(current);
	for (const key of Object.keys(snapshot) as (keyof TokenSnapshot)[]) {
		if (snapshot[key] < previous[key]) {
			return undefined;
		}
	}
	return {
		...current,
		inputTokens: snapshot.inputTokens - previous.inputTokens,
		outputTokens: snapshot.outputTokens - previous.outputTokens,
		cacheReadTokens: snapshot.cacheReadTokens - previous.cacheReadTokens,
		cacheWriteTokens: snapshot.cacheWriteTokens - previous.cacheWriteTokens,
		reasoningTokens: snapshot.reasoningTokens - previous.reasoningTokens,
		totalTokens: snapshot.totalTokens - previous.totalTokens,
	};
}

function nativeSpawn(command: string, argumentsValue: readonly string[], options: SpawnOptions): CodexChild {
	return spawn(command, argumentsValue, options) as unknown as CodexChild;
}

/**
 * Direct, supervisor-owned Codex App Server integration. Only documented visible
 * activity is retained; raw reasoning deltas are converted into a redacted
 * evidence gap and never written to the ledger.
 */
export class CodexAppServerRelay implements CodexRelayControl {
	private readonly spawnCodex: SpawnCodex;
	private readonly now: () => number;
	private readonly pending = new Map<number, PendingRequest>();
	private readonly suppressedRawReasoningItems = new Set<string>();
	private child: CodexChild | undefined;
	private reader: Interface | undefined;
	private requestId = 1;
	private threadId: string | undefined;
	private turnId: string | undefined;
	private timeout: ReturnType<typeof setTimeout> | undefined;
	private interruptTimeout: ReturnType<typeof setTimeout> | undefined;
	private lastUsage: TokenSnapshot | undefined;
	private terminal = false;
	private interruptRequested = false;
	private eventTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly sink: CodexRelaySink,
		private readonly options: CodexRelayOptions,
		dependencies: CodexRelayDependencies = {},
	) {
		this.spawnCodex = dependencies.spawnCodex ?? nativeSpawn;
		this.now = dependencies.now ?? Date.now;
		this.onFinished = dependencies.onFinished;
	}

	private readonly onFinished: ((sessionId: string) => void) | undefined;

	async start(): Promise<void> {
		await this.sink.append({
			kind: 'adapter.lifecycle', actor: 'supervisor', evidenceGrade: 'observed-boundary',
			payload: { adapter: 'codex-app-server', phase: 'starting', maxDurationMs: this.options.maxDurationMs, ...(this.options.maxTokens === undefined ? {} : { maxTokens: this.options.maxTokens }) },
		});
		try {
			this.child = this.spawnCodex('codex', ['app-server'], {
				cwd: this.options.workspacePath,
				env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
				stdio: ['pipe', 'pipe', 'pipe'],
				windowsHide: true,
			});
			this.child.once('error', (error) => {
				void this.enqueue(() => this.fail(`Codex App Server failed to start: ${error instanceof Error ? error.message : String(error)}`));
			});
			this.child.once('close', (code, signal) => {
				void this.enqueue(() => this.terminal ? Promise.resolve() : this.fail(`Codex App Server exited before the turn completed (exit ${String(code)}, signal ${String(signal)}).`));
			});
			if (this.child.stdin === null || this.child.stdout === null || this.child.stderr === null) {
				throw new Error('Codex App Server did not expose the required stdio transport.');
			}
			this.reader = createInterface({ input: this.child.stdout, crlfDelay: Infinity });
			this.reader.on('line', (line) => { void this.enqueue(() => this.handleLine(line)); });
			this.child.stderr.on('data', (data: Buffer) => {
				void this.enqueue(() => this.sink.append({ kind: 'process.output', actor: 'boundary', evidenceGrade: 'observed-boundary', payload: { stream: 'stderr', text: data.toString('utf8'), source: 'codex-app-server' } }).then(() => undefined));
			});

			await this.request('initialize', { clientInfo: { name: 'agent-contract-lab', title: 'Agent Contract Lab', version: SUPERVISOR_VERSION } });
			this.send({ method: 'initialized', params: {} });
			const started = asRecord(await this.request('thread/start', {
				cwd: this.options.workspacePath,
				serviceName: 'agent-contract-lab',
				...(this.options.model === undefined ? {} : { model: this.options.model }),
			}));
			this.threadId = stringValue(asRecord(started?.thread)?.id);
			if (this.threadId === undefined) {
				throw new Error('Codex App Server did not return a thread ID.');
			}
			for (const source of Array.isArray(started?.instructionSources) ? started.instructionSources : []) {
				const path = relativePath(typeof source === 'string' ? source : asRecord(source)?.path, this.options.workspacePath);
				if (path !== undefined) {
					await this.sink.append({ kind: 'instruction.loaded', actor: 'codex-app-server', evidenceGrade: 'observed-native', payload: { adapter: 'codex-app-server', path } });
				}
			}
			const startedTurn = asRecord(await this.request('turn/start', {
				threadId: this.threadId,
				input: [{ type: 'text', text: this.options.task }],
				cwd: this.options.workspacePath,
				approvalPolicy: 'never',
				sandboxPolicy: { type: 'workspaceWrite', writableRoots: [this.options.workspacePath], networkAccess: true },
			}));
			this.turnId = stringValue(asRecord(startedTurn?.turn)?.id);
			this.timeout = setTimeout(() => { void this.cancel('duration-limit'); }, this.options.maxDurationMs);
			await this.sink.append({ kind: 'adapter.lifecycle', actor: 'codex-app-server', evidenceGrade: 'observed-native', payload: { adapter: 'codex-app-server', phase: 'turn-started', ...(this.options.model === undefined ? {} : { model: this.options.model }) } });
		} catch (error) {
			await this.fail(error instanceof Error ? error.message : String(error));
			throw error;
		}
	}

	async cancel(reason = 'user-request'): Promise<void> {
		if (this.terminal || this.interruptRequested) {
			return;
		}
		this.interruptRequested = true;
		await this.sink.append({ kind: 'adapter.lifecycle', actor: 'supervisor', evidenceGrade: 'computed', payload: { adapter: 'codex-app-server', phase: 'interrupt-requested', reason } });
		if (this.threadId !== undefined && this.turnId !== undefined) {
			void this.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId }).catch(() => undefined);
		}
		this.interruptTimeout = setTimeout(() => { void this.finish('interrupted'); }, INTERRUPT_GRACE_MS);
	}

	async shutdown(): Promise<void> {
		if (!this.terminal) {
			await this.cancel('supervisor-shutdown');
		}
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const next = this.eventTail.then(operation, operation);
		this.eventTail = next.catch(() => undefined);
		return next;
	}

	private async handleLine(line: string): Promise<void> {
		let message: RpcMessage;
		try {
			const parsed = asRecord(JSON.parse(line));
			if (parsed === undefined) {
				throw new Error('not an object');
			}
			message = parsed as RpcMessage;
		} catch {
			await this.unknown('adapter.lifecycle', 'adapter-error', 'Codex App Server emitted malformed JSON-RPC data.');
			return;
		}
		if (typeof message.id === 'number' && message.method === undefined) {
			const pending = this.pending.get(message.id);
			if (pending !== undefined) {
				this.pending.delete(message.id);
				clearTimeout(pending.timeout);
				message.error === undefined ? pending.resolve(message.result) : pending.reject(new Error(stringValue(message.error.message) ?? 'Codex App Server rejected the request.'));
			}
			return;
		}
		if (typeof message.id === 'number' && typeof message.method === 'string') {
			await this.unknown('adapter.lifecycle', 'unsupported-capability', `Codex requested unsupported control method ${message.method}.`);
			this.send({ id: message.id, error: { code: -32601, message: 'Agent Contract Lab only records Codex activity.' } });
			return;
		}
		if (typeof message.method === 'string') {
			await this.handleNotification(message.method, asRecord(message.params));
		}
	}

	private async handleNotification(method: string, params: Record<string, unknown> | undefined): Promise<void> {
		if (params === undefined) {
			await this.unknown('adapter.lifecycle', 'adapter-error', 'Codex notification was missing object params.', { method });
			return;
		}
		const correlationId = stringValue(params.itemId) ?? stringValue(params.turnId);
		// Operational status pulses contain neither agent activity nor evidence
		// gaps relevant to a contract. Ignoring them keeps the activity timeline
		// readable without inventing a stronger observation.
		if (TRANSIENT_NOTIFICATION_METHODS.has(method)) {
			return;
		}
		if (method === 'thread/tokenUsage/updated') {
			await this.handleUsage(params);
			return;
		}
		if (method === 'item/reasoning/textDelta') {
			const itemId = stringValue(params.itemId) ?? 'unidentified';
			if (!this.suppressedRawReasoningItems.has(itemId)) {
				this.suppressedRawReasoningItems.add(itemId);
				await this.unknown('agent.summary', 'redacted', 'Raw Codex reasoning is not retained; a provider-visible summary is retained when available.', { method });
			}
			return;
		}
		if (method === 'item/agentMessage/delta') {
			const text = stringValue(params.delta);
			if (text !== undefined) {
				await this.native('agent.message', { role: 'assistant', text, source: 'codex-app-server', delta: true }, stringValue(params.itemId) ?? correlationId);
			} else {
				await this.unknown('agent.message', 'not-observed', 'Codex message delta did not include visible text.', { method });
			}
			return;
		}
		if (method === 'item/plan/delta' || method === 'item/reasoning/summaryTextDelta') {
			const summary = stringValue(params.delta);
			if (summary !== undefined) {
				await this.native('agent.summary', { summary, source: method === 'item/plan/delta' ? 'plan' : 'reasoning-summary', delta: true }, stringValue(params.itemId) ?? correlationId);
			} else {
				await this.unknown('agent.summary', 'not-observed', 'Codex visible summary delta did not include text.', { method });
			}
			return;
		}
		if (method === 'item/commandExecution/outputDelta') {
			const text = stringValue(params.delta);
			if (text !== undefined) {
				await this.native('process.output', { stream: stringValue(params.stream) ?? 'stdout', text, source: 'codex-command', delta: true }, stringValue(params.itemId) ?? correlationId);
			}
			return;
		}
		if (method === 'turn/plan/updated') {
			await this.native('agent.summary', { source: 'plan', ...(stringValue(params.explanation) === undefined ? {} : { summary: stringValue(params.explanation) as string }), ...(isJsonValue(params.plan) ? { plan: params.plan } : {}) }, correlationId);
			return;
		}
		if (method === 'item/started' || method === 'item/completed') {
			await this.handleItem(method, asRecord(params.item), correlationId);
			return;
		}
		if (method === 'turn/completed') {
			const state = terminalState(asRecord(params.turn)?.status);
			await this.native('adapter.lifecycle', { adapter: 'codex-app-server', phase: 'turn-completed', state }, correlationId);
			await this.finish(state);
			return;
		}
		if (method === 'thread/started' || method === 'turn/started' || method === 'thread/status/changed' || method === 'thread/closed') {
			await this.native('adapter.lifecycle', { adapter: 'codex-app-server', phase: method }, correlationId);
			return;
		}
		await this.unknown('adapter.lifecycle', 'unsupported-capability', 'The Codex notification is not mapped by this relay version.', { method });
	}

	private async handleItem(method: 'item/started' | 'item/completed', item: Record<string, unknown> | undefined, correlationId: string | undefined): Promise<void> {
		const itemType = stringValue(item?.type);
		const itemId = stringValue(item?.id) ?? correlationId;
		if (itemType === undefined || item === undefined) {
			await this.unknown('adapter.lifecycle', 'not-observed', 'Codex item notification did not include item.type.', { method });
			return;
		}
		if (itemType === 'commandExecution') {
			const command = stringValue(item.command);
			if (command === undefined) {
				await this.unknown(method === 'item/started' ? 'command.started' : 'command.completed', 'not-observed', 'Codex command item did not include a command.', { method });
				return;
			}
			await this.native(method === 'item/started' ? 'command.started' : 'command.completed', {
				executable: command,
				...(method === 'item/completed' && typeof item.exitCode === 'number' ? { exitCode: item.exitCode, succeeded: item.exitCode === 0 } : {}),
				...(method === 'item/completed' && typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
			}, itemId);
			return;
		}
		if (itemType === 'fileChange' && method === 'item/completed') {
			for (const change of Array.isArray(item.changes) ? item.changes : []) {
				const entry = asRecord(change);
				const path = relativePath(entry?.path, this.options.workspacePath);
				if (path !== undefined) {
					await this.native('file.changed', { path, operation: fileOperation(stringValue(entry?.kind)) }, itemId);
				}
			}
			return;
		}
		if (itemType === 'agentMessage' && method === 'item/completed' && stringValue(item.text) !== undefined) {
			await this.native('agent.message', { role: 'assistant', text: stringValue(item.text) as string, source: 'codex-app-server' }, itemId);
			return;
		}
		if (['mcpToolCall', 'dynamicToolCall', 'collabToolCall', 'webSearch'].includes(itemType)) {
			const tool = stringValue(item.tool) ?? itemType;
			await this.native(method === 'item/started' ? 'tool.called' : 'tool.completed', method === 'item/started'
				? { tool, arguments: jsonObject(item.arguments) }
				: { tool, success: item.status === 'completed' || item.success === true }, itemId);
			return;
		}
		await this.native('adapter.lifecycle', { adapter: 'codex-app-server', phase: method, itemType }, itemId);
	}

	private async handleUsage(params: Record<string, unknown>): Promise<void> {
		const normalized = normalizeOpenAIUsage({ ...params, usage: params.usage, ...(this.options.model === undefined ? {} : { model: this.options.model }) });
		if (!normalized.ok) {
			await this.unknown('usage.unavailable', normalized.reason, normalized.message);
			return;
		}
		const current = tokenSnapshot(normalized.usage);
		const delta = usageDelta(normalized.usage, this.lastUsage);
		this.lastUsage = current;
		if (delta === undefined) {
			await this.unknown('usage.unavailable', 'ambiguous', 'Codex token counters decreased, so cumulative usage could not be safely aggregated.');
			return;
		}
		await this.sink.recordUsage(delta);
		if (this.options.maxTokens !== undefined && current.totalTokens > this.options.maxTokens) {
			await this.sink.append({ kind: 'adapter.lifecycle', actor: 'supervisor', evidenceGrade: 'computed', payload: { adapter: 'codex-app-server', phase: 'usage-budget-exceeded', maxTokens: this.options.maxTokens, reportedTokens: current.totalTokens } });
			await this.cancel('usage-budget');
		}
	}

	private native(kind: EventDraft['kind'], payload: JsonObject, correlationId?: string): Promise<unknown> {
		return this.sink.append({ kind, actor: 'codex-app-server', evidenceGrade: 'observed-native', payload, ...(correlationId === undefined ? {} : { correlationId }) });
	}

	private unknown(kind: EventDraft['kind'], reason: EventDraft['unknownReason'], message: string, extra: JsonObject = {}): Promise<unknown> {
		return this.sink.append({ kind, actor: 'codex-app-server', evidenceGrade: 'unknown', unknownReason: reason, payload: { adapter: 'codex-app-server', message, ...extra } });
	}

	private request(method: string, params: JsonObject): Promise<unknown> {
		const id = this.requestId++;
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Codex App Server timed out responding to ${method}.`));
			}, REQUEST_TIMEOUT_MS);
			this.pending.set(id, { resolve, reject, timeout });
			try {
				this.send({ id, method, params });
			} catch (error) {
				this.pending.delete(id);
				clearTimeout(timeout);
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private send(message: JsonObject): void {
		if (this.child?.stdin === null || this.child?.stdin === undefined) {
			throw new Error('Codex App Server stdin is unavailable.');
		}
		this.child.stdin.write(`${JSON.stringify(message)}\n`);
	}

	private async fail(message: string): Promise<void> {
		if (!this.terminal) {
			await this.sink.append({ kind: 'adapter.lifecycle', actor: 'supervisor', evidenceGrade: 'observed-boundary', payload: { adapter: 'codex-app-server', phase: 'failed', message } });
			await this.finish('failed');
		}
	}

	private async finish(state: Extract<SessionState, 'completed' | 'failed' | 'interrupted'>): Promise<void> {
		if (this.terminal) {
			return;
		}
		this.terminal = true;
		if (this.timeout !== undefined) clearTimeout(this.timeout);
		if (this.interruptTimeout !== undefined) clearTimeout(this.interruptTimeout);
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(new Error('Codex App Server relay completed before the request returned.'));
			this.pending.delete(id);
		}
		this.reader?.close();
		this.child?.kill('SIGTERM');
		await this.sink.complete(state);
		this.onFinished?.(this.options.sessionId);
	}
}

function isJsonValue(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isJsonValue);
	return typeof value === 'object' && value !== null && Object.values(value).every(isJsonValue);
}

function fileOperation(kind: string | undefined): 'created' | 'modified' | 'deleted' {
	return kind === 'add' || kind === 'create' ? 'created' : kind === 'delete' || kind === 'remove' ? 'deleted' : 'modified';
}
