import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import {
	type EventKind,
	type JsonObject,
	type JsonValue,
	type RunMode,
	type SessionEvent,
	type SessionRecord,
	type TokenUsage,
	type UnknownReason,
} from '@agent-contract-lab/event-schema';
import { normalizeProviderUsage, type TokenUsageMapping, type UsageNormalization, type UsageProviderSelector } from './usage';

export * from './usage';
export * from './vendorAdapters';

export const DEFAULT_SUPERVISOR_URL = 'http://127.0.0.1:43199' as const;

export interface FetchLike {
	(input: string | URL, init?: {
		readonly method?: string;
		readonly headers?: Record<string, string>;
		readonly body?: string;
		readonly signal?: AbortSignal;
	}): Promise<Response>;
}

export interface LocalSupervisorClientOptions {
	readonly supervisorUrl: string;
	readonly token: string;
	readonly fetchImpl?: FetchLike;
}

export interface StartSessionOptions {
	readonly workspacePath: string;
	readonly actor: string;
	readonly runMode?: Extract<RunMode, 'observe' | 'managed'>;
	/** A user-visible task name. It is redacted by the supervisor before storage. */
	readonly title?: string;
}

export interface ToolCall {
	readonly tool: string;
	readonly arguments?: JsonObject;
	readonly correlationId?: string;
}

export interface ToolResult {
	readonly tool: string;
	readonly success: boolean;
	readonly result?: JsonValue;
	readonly correlationId?: string;
}

export interface CommandActivity {
	readonly executable: string;
	readonly args?: readonly string[];
	readonly exitCode?: number | null;
	readonly correlationId?: string;
}

export interface FileActivity {
	readonly path: string;
	readonly operation: 'created' | 'modified' | 'deleted';
	readonly correlationId?: string;
}

export interface FileReadActivity {
	readonly path: string;
	readonly tool?: string;
	readonly pathType?: 'file' | 'directory';
	readonly correlationId?: string;
}

export interface TestActivity {
	readonly name: string;
	readonly success: boolean;
	readonly durationMs?: number;
	readonly correlationId?: string;
}

export interface ProviderUsageReport {
	readonly normalized: UsageNormalization;
	readonly session?: SessionRecord;
}

interface ApiErrorBody {
	readonly error?: { readonly message?: string };
}

interface SessionResponse {
	readonly session: SessionRecord;
}

interface EventResponse {
	readonly event: SessionEvent;
}

interface EventsResponse {
	readonly events: readonly SessionEvent[];
	readonly cursor: { readonly afterSequence: number; readonly nextSequence: number };
	readonly terminal: boolean;
}

export interface FollowEventsOptions {
	readonly afterSequence?: number;
	readonly pollIntervalMs?: number;
	readonly signal?: AbortSignal;
}

export class SupervisorRequestError extends Error {
	constructor(
		readonly statusCode: number,
		message: string,
	) {
		super(message);
		this.name = 'SupervisorRequestError';
	}
}

function assertLoopbackUrl(raw: string): URL {
	const url = new URL(raw);
	const host = url.hostname.replace(/^\[(.+)\]$/, '$1');
	if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(host)) {
		throw new Error('supervisorUrl must use HTTP on a loopback host');
	}
	return url;
}

async function localToken(environment: NodeJS.ProcessEnv): Promise<string> {
	if (environment.AGENT_CONTRACT_TOKEN !== undefined && environment.AGENT_CONTRACT_TOKEN.trim() !== '') {
		return environment.AGENT_CONTRACT_TOKEN;
	}
	const directory = environment.AGENT_CONTRACT_HOME ?? join(homedir(), '.agent-contract-lab');
	const token = (await readFile(join(directory, 'auth-token'), 'utf8')).trim();
	if (token === '') {
		throw new Error('local supervisor credential is empty');
	}
	return token;
}

/**
 * Client for integrations running beside a local Agent Contract Lab supervisor.
 * It cannot submit native or boundary observations; external facts are marked
 * model-declared so their provenance remains visible in reports.
 */
export class LocalSupervisorClient {
	private readonly baseUrl: URL;
	private readonly fetchImpl: FetchLike;

	constructor(private readonly options: LocalSupervisorClientOptions) {
		this.baseUrl = assertLoopbackUrl(options.supervisorUrl);
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
	}

	static async fromLocalEnvironment(environment: NodeJS.ProcessEnv = process.env): Promise<LocalSupervisorClient> {
		return new LocalSupervisorClient({
			supervisorUrl: environment.AGENT_CONTRACT_SUPERVISOR_URL ?? DEFAULT_SUPERVISOR_URL,
			token: await localToken(environment),
		});
	}

	async startSession(options: StartSessionOptions): Promise<AgentContractSession> {
		const response = await this.request<SessionResponse>('/v1/sessions', 'POST', {
			workspacePath: options.workspacePath,
			actor: options.actor,
			runMode: options.runMode ?? 'observe',
			...(options.title === undefined ? {} : { title: options.title }),
		});
		return new AgentContractSession(this, response.session, options.actor);
	}

	async emit(sessionId: string, actor: string, kind: EventKind, payload: JsonObject, correlationId?: string): Promise<SessionEvent> {
		const response = await this.request<EventResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/events`, 'POST', {
			kind,
			actor,
			evidenceGrade: 'model-declared',
			payload,
			...(correlationId === undefined ? {} : { correlationId }),
		});
		return response.event;
	}

	async emitUnknown(sessionId: string, actor: string, kind: EventKind, reason: UnknownReason, payload: JsonObject = {}): Promise<SessionEvent> {
		const response = await this.request<EventResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/events`, 'POST', {
			kind,
			actor,
			evidenceGrade: 'unknown',
			unknownReason: reason,
			payload,
		});
		return response.event;
	}

	async reportUsage(sessionId: string, usage: TokenUsage): Promise<SessionRecord> {
		const response = await this.request<SessionResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/usage`, 'POST', { ...usage });
		return response.session;
	}

	async complete(sessionId: string, state: 'completed' | 'failed' | 'interrupted' = 'completed'): Promise<SessionRecord> {
		const response = await this.request<SessionResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/complete`, 'POST', { state });
		return response.session;
	}

	async getEvents(sessionId: string, afterSequence = 0): Promise<EventsResponse> {
		if (!Number.isInteger(afterSequence) || afterSequence < 0) {
			throw new Error('afterSequence must be a non-negative integer');
		}
		const response = await this.request<EventsResponse>(`/v1/sessions/${encodeURIComponent(sessionId)}/events?afterSequence=${afterSequence}`, 'GET');
		if (!Array.isArray(response.events) || typeof response.cursor?.nextSequence !== 'number' || typeof response.terminal !== 'boolean') {
			throw new SupervisorRequestError(500, 'Supervisor returned malformed event data.');
		}
		return response;
	}

	private async request<T>(pathname: string, method: string, body?: JsonObject): Promise<T> {
		let response: Response;
		try {
			response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
				method,
				headers: { 'content-type': 'application/json', 'x-agent-contract-token': this.options.token },
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(5_000),
			});
		} catch (error) {
			throw new SupervisorRequestError(0, error instanceof Error ? error.message : String(error));
		}
		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new SupervisorRequestError(response.status, 'Supervisor returned invalid JSON.');
		}
		if (!response.ok) {
			const error = payload as ApiErrorBody;
			throw new SupervisorRequestError(response.status, error.error?.message ?? `Supervisor returned HTTP ${response.status}.`);
		}
		return payload as T;
	}
}

/** A session-scoped ergonomic API for an AI framework or adapter callback. */
export class AgentContractSession {
	constructor(
		private readonly client: LocalSupervisorClient,
		readonly record: SessionRecord,
		private readonly actor: string,
	) {}

	/** Compatibility shorthand for an AI-visible message. Prefer the role-specific methods below. */
	message(text: string): Promise<SessionEvent> {
		return this.agentMessage(text);
	}

	userMessage(text: string): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'agent.message', { role: 'user', text });
	}

	agentMessage(text: string): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'agent.message', { role: 'assistant', text });
	}

	/** Retains only an explicit high-level plan, never private reasoning. */
	plan(summary: string, steps?: readonly string[]): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'agent.summary', {
			summary,
			source: 'plan',
			...(steps === undefined ? {} : { steps: [...steps] }),
		});
	}

	/** Retains a provider-visible reasoning summary when one is supplied. */
	reasoningSummary(summary: string): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'agent.summary', { summary, source: 'reasoning-summary' });
	}

	/** Stores a user-visible model declaration, never private chain-of-thought. */
	summary(summary: string): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'agent.summary', { summary });
	}

	toolCalled(activity: ToolCall): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'tool.called', {
			tool: activity.tool,
			...(activity.arguments === undefined ? {} : { arguments: activity.arguments }),
		}, activity.correlationId);
	}

	toolCompleted(activity: ToolResult): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'tool.completed', {
			tool: activity.tool,
			success: activity.success,
			...(activity.result === undefined ? {} : { result: activity.result }),
		}, activity.correlationId);
	}

	commandStarted(activity: CommandActivity): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'command.started', {
			executable: activity.executable,
			...(activity.args === undefined ? {} : { args: [...activity.args] }),
		}, activity.correlationId);
	}

	commandCompleted(activity: CommandActivity): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'command.completed', {
			executable: activity.executable,
			...(activity.args === undefined ? {} : { args: [...activity.args] }),
			...(activity.exitCode === undefined ? {} : { exitCode: activity.exitCode }),
		}, activity.correlationId);
	}

	fileChanged(activity: FileActivity): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'file.changed', {
			path: activity.path,
			operation: activity.operation,
		}, activity.correlationId);
	}

	fileRead(activity: FileReadActivity): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'file.read', {
			path: activity.path,
			...(activity.tool === undefined ? {} : { tool: activity.tool }),
			...(activity.pathType === undefined ? {} : { pathType: activity.pathType }),
		}, activity.correlationId);
	}

	/**
	 * Emits a correlated tool lifecycle around one real integration callback.
	 * The callback result must be JSON-compatible to be retained; unsupported
	 * values are represented as an evidence gap rather than stringified.
	 */
	async runTool<T>(activity: ToolCall, operation: () => Promise<T> | T): Promise<T> {
		await this.toolCalled(activity);
		try {
			const result = await operation();
			if (isJsonCompatible(result)) {
				await this.toolCompleted({ tool: activity.tool, success: true, result, correlationId: activity.correlationId });
			} else {
				await this.toolCompleted({ tool: activity.tool, success: true, correlationId: activity.correlationId });
				await this.unknown('tool.completed', 'not-retained', { tool: activity.tool, message: 'Tool result was not JSON-compatible and was not retained.' });
			}
			return result;
		} catch (error) {
			await this.toolCompleted({ tool: activity.tool, success: false, result: { message: error instanceof Error ? error.message : String(error) }, correlationId: activity.correlationId });
			throw error;
		}
	}

	testCompleted(activity: TestActivity): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, 'test.completed', {
			name: activity.name,
			success: activity.success,
			...(activity.durationMs === undefined ? {} : { durationMs: activity.durationMs }),
		}, activity.correlationId);
	}

	reportUsage(usage: TokenUsage): Promise<SessionRecord> {
		return this.client.reportUsage(this.record.sessionId, usage);
	}

	emitEvent(kind: EventKind, payload: JsonObject, correlationId?: string): Promise<SessionEvent> {
		return this.client.emit(this.record.sessionId, this.actor, kind, payload, correlationId);
	}

	async reportProviderUsage(provider: UsageProviderSelector, response: unknown, mapping?: TokenUsageMapping): Promise<ProviderUsageReport> {
		const normalized = normalizeProviderUsage(provider, response, mapping);
		if (!normalized.ok) {
			await this.unknown('usage.unavailable', normalized.reason, { provider, message: normalized.message });
			return { normalized };
		}
		return { normalized, session: await this.reportUsage(normalized.usage) };
	}

	complete(state: 'completed' | 'failed' | 'interrupted' = 'completed'): Promise<SessionRecord> {
		return this.client.complete(this.record.sessionId, state);
	}

	unknown(kind: EventKind, reason: UnknownReason, payload: JsonObject = {}): Promise<SessionEvent> {
		return this.client.emitUnknown(this.record.sessionId, this.actor, kind, reason, payload);
	}

	/** Follows supervisor-committed, already-redacted events for an application UI. */
	async followEvents(callback: (event: SessionEvent) => void | Promise<void>, options: FollowEventsOptions = {}): Promise<void> {
		let afterSequence = options.afterSequence ?? 0;
		const pollIntervalMs = options.pollIntervalMs ?? 100;
		if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 10) {
			throw new Error('pollIntervalMs must be an integer of at least 10ms');
		}
		while (!options.signal?.aborted) {
			const snapshot = await this.client.getEvents(this.record.sessionId, afterSequence);
			for (const event of snapshot.events) {
				if (event.sequence > afterSequence) {
					await callback(event);
					afterSequence = event.sequence;
				}
			}
			if (snapshot.terminal) {
				return;
			}
			await waitForNextPoll(pollIntervalMs, options.signal);
		}
	}
}

function isJsonCompatible(value: unknown): value is JsonValue {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') {
		return true;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value);
	}
	if (Array.isArray(value)) {
		return value.every(isJsonCompatible);
	}
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	return Object.values(value).every(isJsonCompatible);
}

function waitForNextPoll(milliseconds: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) {
			resolve();
			return;
		}
		const timeout = setTimeout(resolve, milliseconds);
		signal?.addEventListener('abort', () => {
			clearTimeout(timeout);
			resolve();
		}, { once: true });
	});
}

/** Compact, safe text rendering for terminals and application-owned UIs. */
export function formatSessionEventText(event: SessionEvent): readonly string[] {
	const payload = event.payload as Record<string, JsonValue>;
	const prefix = `[${event.sequence}] ${event.kind}`;
	if (typeof payload.text === 'string' || typeof payload.summary === 'string') {
		return [`${prefix}: ${typeof payload.text === 'string' ? payload.text : payload.summary as string}`];
	}
	if (typeof payload.executable === 'string') {
		const args = Array.isArray(payload.args) ? payload.args.filter((value): value is string => typeof value === 'string').join(' ') : '';
		return [`${prefix}: ${payload.executable}${args === '' ? '' : ` ${args}`}`];
	}
	if (typeof payload.path === 'string') {
		return [`${prefix}: ${payload.path}`];
	}
	return [`${prefix}: ${JSON.stringify(payload)}`];
}
