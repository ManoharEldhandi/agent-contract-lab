import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type PolicyDecision, type SessionEvent, type SessionRecord } from '@agent-contract-lab/event-schema';

import type { CommandContext } from './context';
import { assertLoopbackUrl } from './protocolClient';

export type ApiOutcome<T> =
	| { readonly kind: 'ok'; readonly data: T }
	| { readonly kind: 'error'; readonly statusCode?: number; readonly message: string };

interface ApiErrorBody {
	readonly error?: { readonly message?: string };
}

export interface WorkspaceResult {
	readonly schemaVersion: number;
	readonly workspace: { readonly fingerprint: string; readonly label: string; readonly trustedAt?: string };
	readonly trusted: boolean;
}

export interface SessionsResult {
	readonly schemaVersion: number;
	readonly sessions: readonly SessionRecord[];
}

export interface SessionResult {
	readonly schemaVersion: number;
	readonly session: SessionRecord;
}

export interface EventsResult {
	readonly schemaVersion: number;
	readonly sessionId: string;
	readonly events: readonly SessionEvent[];
	readonly cursor?: { readonly afterSequence: number; readonly nextSequence: number };
	readonly terminal?: boolean;
}

export interface ContractEvaluationResult {
	readonly schemaVersion: number;
	readonly contractName: string;
	readonly decisions: readonly PolicyDecision[];
}

function dataDirectory(environment: Record<string, string | undefined>): string {
	return environment.AGENT_CONTRACT_HOME ?? join(homedir(), '.agent-contract-lab');
}

async function readToken(environment: Record<string, string | undefined>): Promise<string | undefined> {
	if (environment.AGENT_CONTRACT_TOKEN !== undefined && environment.AGENT_CONTRACT_TOKEN.trim() !== '') {
		return environment.AGENT_CONTRACT_TOKEN;
	}
	try {
		const token = (await readFile(join(dataDirectory(environment), 'auth-token'), 'utf8')).trim();
		return token === '' ? undefined : token;
	} catch {
		return undefined;
	}
}

export async function requestSupervisor<T>(
	context: CommandContext,
	pathname: string,
	method = 'GET',
	body?: unknown,
): Promise<ApiOutcome<T>> {
	let base: URL;
	try {
		base = assertLoopbackUrl(context.supervisorUrl);
	} catch (error) {
		return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
	}
	const token = await readToken(context.env);
	if (token === undefined) {
		return { kind: 'error', message: 'No local supervisor credential was found. Start the supervisor first.' };
	}

	const fetchImpl = context.fetchImpl ?? globalThis.fetch;
	let response: Response;
	try {
		response = await fetchImpl(new URL(pathname, base), {
			method,
			headers: { 'content-type': 'application/json', 'x-agent-contract-token': token },
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(5_000),
		});
	} catch (error) {
		return { kind: 'error', message: error instanceof Error ? error.message : String(error) };
	}

	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		return { kind: 'error', statusCode: response.status, message: 'Supervisor returned invalid JSON.' };
	}
	if (!response.ok) {
		const errorBody = payload as ApiErrorBody;
		return { kind: 'error', statusCode: response.status, message: errorBody.error?.message ?? `Supervisor returned HTTP ${response.status}.` };
	}
	return { kind: 'ok', data: payload as T };
}