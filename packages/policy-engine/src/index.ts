import { createHash } from 'node:crypto';

import { minimatch } from 'minimatch';

import type { ActionDecision, PolicyDecision, SessionEvent, UnknownReason } from '@agent-contract-lab/event-schema';
import type { RuntimePolicy } from './runtime';
import { parseRuntimePolicy } from './runtimeSchema';

export type { ActionDecision } from '@agent-contract-lab/event-schema';
export * from './runtime';

export interface ContractPaths {
	readonly allow?: readonly string[];
	readonly deny?: readonly string[];
}

export interface ContractCommands {
	readonly allow?: readonly string[];
	readonly deny?: readonly string[];
	readonly requireSuccess?: readonly string[];
	readonly requirePreAction?: boolean;
}

export interface ContractEvidence {
	readonly require?: readonly ('command-result' | 'filesystem-diff')[];
}

export interface AgentContract {
	readonly version: 1;
	readonly name: string;
	readonly runtime?: RuntimePolicy;
	readonly assertions?: {
		readonly paths?: ContractPaths;
		readonly commands?: ContractCommands;
		readonly evidence?: ContractEvidence;
	};
}

export type ContractParseResult =
	| { readonly ok: true; readonly contract: AgentContract }
	| { readonly ok: false; readonly issues: readonly string[] };

export interface EvaluateContractOptions {
	readonly sessionId: string;
	readonly events: readonly SessionEvent[];
	readonly now?: () => Date;
}

export type ProposedAction =
	| { readonly kind: 'command'; readonly executable: string; readonly args?: readonly string[] }
	| { readonly kind: 'file.read' | 'file.write'; readonly path: string }
	| { readonly kind: 'model.call' | 'knowledge.search' };

const OBSERVED_GRADES = new Set(['observed-native', 'observed-boundary']);
const SUPPORTED_EVIDENCE = new Set(['command-result', 'filesystem-diff']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown, path: string, issues: string[]): readonly string[] | undefined {
	if (!Array.isArray(value) || value.length > 128 || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '' && entry.length <= 1_024 && !entry.includes('\0'))) {
		issues.push(`${path} must contain at most 128 non-empty strings of at most 1024 characters without NUL bytes`);
		return undefined;
	}
	return Object.freeze([...value]);
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, issues: string[]): void {
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key)) {
			issues.push(`${path}.${key} is unsupported`);
		}
	}
}

function optionalStringArray(record: Record<string, unknown>, key: string, path: string, issues: string[]): readonly string[] | undefined {
	const value = record[key];
	return value === undefined ? undefined : stringArray(value, `${path}.${key}`, issues);
}

function optionalObject(record: Record<string, unknown>, key: string, path: string, issues: string[]): Record<string, unknown> | undefined {
	const value = record[key];
	if (value === undefined) {
		return undefined;
	}
	const object = asRecord(value);
	if (object === undefined) {
		issues.push(`${path}.${key} must be an object`);
	}
	return object;
}

/** Validates untrusted repository contract data before deterministic evaluation. */
export function parseContract(input: unknown): ContractParseResult {
	const root = asRecord(input);
	if (root === undefined) {
		return { ok: false, issues: ['contract must be an object'] };
	}
	const issues: string[] = [];
	rejectUnknownKeys(root, ['version', 'name', 'assertions', 'runtime'], 'contract', issues);
	if (root.version !== 1) {
		issues.push('version must be 1');
	}
	const name = root.name;
	if (typeof name !== 'string' || name.trim() === '' || name.length > 256) {
		issues.push('name must be a non-empty string of at most 256 characters');
	}
	const runtime = root.runtime === undefined ? undefined : parseRuntimePolicy(root.runtime);
	if (runtime !== undefined && !runtime.ok) { issues.push(...runtime.issues); }
	const assertions = optionalObject(root, 'assertions', 'contract', issues);
	let paths: ContractPaths | undefined;
	let commands: ContractCommands | undefined;
	let evidence: ContractEvidence | undefined;
	if (assertions !== undefined) {
		rejectUnknownKeys(assertions, ['paths', 'commands', 'evidence'], 'assertions', issues);
		const pathRecord = optionalObject(assertions, 'paths', 'assertions', issues);
		if (pathRecord !== undefined) {
			rejectUnknownKeys(pathRecord, ['allow', 'deny'], 'assertions.paths', issues);
			const allow = optionalStringArray(pathRecord, 'allow', 'assertions.paths', issues);
			const deny = optionalStringArray(pathRecord, 'deny', 'assertions.paths', issues);
			paths = Object.freeze({ ...(allow === undefined ? {} : { allow }), ...(deny === undefined ? {} : { deny }) });
		}
		const commandRecord = optionalObject(assertions, 'commands', 'assertions', issues);
		if (commandRecord !== undefined) {
			rejectUnknownKeys(commandRecord, ['allow', 'deny', 'requireSuccess', 'requirePreAction'], 'assertions.commands', issues);
			const allow = optionalStringArray(commandRecord, 'allow', 'assertions.commands', issues);
			const deny = optionalStringArray(commandRecord, 'deny', 'assertions.commands', issues);
			const requireSuccess = optionalStringArray(commandRecord, 'requireSuccess', 'assertions.commands', issues);
			const requirePreAction = commandRecord.requirePreAction;
			if (requirePreAction !== undefined && typeof requirePreAction !== 'boolean') {
				issues.push('assertions.commands.requirePreAction must be a boolean');
			}
			commands = Object.freeze({
				...(allow === undefined ? {} : { allow }),
				...(deny === undefined ? {} : { deny }),
				...(requireSuccess === undefined ? {} : { requireSuccess }),
				...(typeof requirePreAction === 'boolean' ? { requirePreAction } : {}),
			});
		}
		const evidenceRecord = optionalObject(assertions, 'evidence', 'assertions', issues);
		if (evidenceRecord !== undefined) {
			rejectUnknownKeys(evidenceRecord, ['require'], 'assertions.evidence', issues);
			const required = optionalStringArray(evidenceRecord, 'require', 'assertions.evidence', issues);
			if (required !== undefined && required.some((entry) => !SUPPORTED_EVIDENCE.has(entry))) {
				issues.push('assertions.evidence.require contains an unsupported evidence type');
			}
			evidence = Object.freeze(required === undefined ? {} : { require: required as ContractEvidence['require'] });
		}
	}
	if (runtime?.ok && runtime.policy.requireVerificationBeforeComplete && (commands?.requireSuccess?.length ?? 0) === 0) {
		issues.push('runtime.requireVerificationBeforeComplete requires assertions.commands.requireSuccess');
	}
	if (issues.length > 0 || typeof name !== 'string' || name.trim() === '') {
		return { ok: false, issues };
	}
	return { ok: true, contract: Object.freeze({ version: 1, name, ...(runtime?.ok ? { runtime: runtime.policy } : {}), assertions: assertions === undefined ? undefined : Object.freeze({ paths, commands, evidence }) }) };
}

function hasObservedGrade(event: SessionEvent): boolean {
	return OBSERVED_GRADES.has(event.evidenceGrade);
}

function commandText(event: SessionEvent): string | undefined {
	if (event.kind !== 'process.started' && event.kind !== 'command.started') {
		return undefined;
	}
	const executable = event.payload.executable;
	const args = event.payload.args;
	if (typeof executable !== 'string' || (args !== undefined && (!Array.isArray(args) || !args.every((argument) => typeof argument === 'string')))) {
		return undefined;
	}
	return [executable, ...(args ?? [])].join(' ');
}

function normalizedPath(value: string): string | undefined {
	const path = value.replace(/\\/g, '/');
	if (path.trim() === '' || path.startsWith('/') || /^[a-z]:/i.test(path) || path.split('/').includes('..') || path.includes('\0')) {
		return undefined;
	}
	const canonical = path.split('/').filter((part) => part !== '' && part !== '.').join('/');
	return canonical === '' ? undefined : canonical;
}

function changedPath(event: SessionEvent): string | undefined {
	return event.kind === 'file.changed' && typeof event.payload.path === 'string' ? normalizedPath(event.payload.path) : undefined;
}

function isObservedFilesystemDiff(event: SessionEvent): boolean {
	if (event.kind !== 'workspace.diff' || !hasObservedGrade(event)) {
		return false;
	}
	const current = asRecord(event.payload.current);
	return current !== undefined && Array.isArray(current.paths) && current.paths.every((path) => typeof path === 'string') && typeof current.diffSha256 === 'string' && current.diffSha256 !== '';
}

interface PathObservation {
	readonly path: string;
	readonly event: SessionEvent;
}

function observedPathEvidence(events: readonly SessionEvent[]): { readonly paths: readonly PathObservation[]; readonly complete: boolean; readonly ambiguous: boolean; readonly snapshots: readonly SessionEvent[] } {
	const paths = events.flatMap((event) => {
		const path = hasObservedGrade(event) ? changedPath(event) : undefined;
		return path === undefined ? [] : [{ path, event }];
	});
	const snapshots = events.filter((event) => event.kind === 'workspace.diff');
	const reliable: SessionEvent[] = [];
	for (const event of snapshots) {
		if (!isObservedFilesystemDiff(event)) {
			continue;
		}
		const baseline = asRecord(event.payload.baseline);
		const current = asRecord(event.payload.current)!;
		if (!Array.isArray(baseline?.paths) || current.truncated !== false || (baseline.paths.length > 0 && event.payload.changedSinceStart !== false)) {
			continue;
		}
		reliable.push(event);
		if (event.payload.changedSinceStart !== false) {
			for (const path of current.paths as string[]) {
				paths.push({ path: path.replace(/\\/g, '/'), event });
			}
		}
	}
	return { paths, complete: snapshots.length > 0 && reliable.length === snapshots.length, ambiguous: reliable.length !== snapshots.length, snapshots: reliable };
}

function matches(value: string, pattern: string): boolean {
	return minimatch(value, pattern, { dot: true, nonegate: true, nocase: false });
}

export function matchesCommand(value: string, pattern: string): boolean {
	return matches(value.replace(/[\\/]/g, '\0'), pattern.replace(/[\\/]/g, '\0'));
}

export function contractFingerprint(contract: AgentContract): string {
	return createHash('sha256').update(JSON.stringify(contract)).digest('hex');
}

function commandDenials(contract: AgentContract, action: Extract<ProposedAction, { readonly kind: 'command' }>): string[] {
	const denied: string[] = [];
	if (action.executable.trim() === '' || [action.executable, ...(action.args ?? [])].some((value) => value.includes('\0'))) {
		return ['commands.invalid'];
	}
	const text = [action.executable, ...(action.args ?? [])].join(' ');
	const basename = action.executable.replace(/\\/g, '/').split('/').at(-1)!;
	const normalized = [basename, ...(action.args ?? [])].join(' ');
	const commands = contract.assertions?.commands;
	for (const [index, pattern] of (commands?.deny ?? []).entries()) {
		if (matchesCommand(text, pattern) || matchesCommand(normalized, pattern)) {
			denied.push(`commands.deny[${index}]`);
		}
	}
	if (commands?.allow !== undefined && !commands.allow.some((pattern) => matchesCommand(text, pattern))) {
		denied.push('commands.allow');
	}
	return denied;
}

function pathDenials(contract: AgentContract, path: string): string[] {
	const canonical = normalizedPath(path);
	if (canonical === undefined) {
		return ['paths.invalid'];
	}
	const denied: string[] = [];
	const paths = contract.assertions?.paths;
	for (const [index, pattern] of (paths?.deny ?? []).entries()) {
		if (matches(canonical, pattern)) {
			denied.push(`paths.deny[${index}]`);
		}
	}
	if (paths?.allow !== undefined && !paths.allow.some((pattern) => matches(canonical, pattern))) {
		denied.push('paths.allow');
	}
	return denied;
}

export function evaluateAction(contract: AgentContract, action: ProposedAction): ActionDecision {
	const denied = action.kind === 'command' ? commandDenials(contract, action)
		: action.kind === 'file.read' || action.kind === 'file.write' ? pathDenials(contract, action.path) : [];
	return Object.freeze({
		allowed: denied.length === 0,
		ruleIds: Object.freeze(denied),
		message: denied.length === 0 ? 'Action allowed by the attached contract.' : `Action refused by ${denied.join(', ')}.`,
	});
}

function createDecision(
	contractName: string,
	sessionId: string,
	ruleId: string,
	result: PolicyDecision['result'],
	message: string,
	evidenceEventIds: readonly string[],
	evaluatedAt: string,
	unknownReason?: UnknownReason,
): PolicyDecision {
	const basis = JSON.stringify({ contractName, sessionId, ruleId, result, message, evidenceEventIds, unknownReason });
	return {
		schemaVersion: 1,
		decisionId: `dec_${createHash('sha256').update(basis).digest('hex').slice(0, 20)}`,
		sessionId,
		contractName,
		ruleId,
		result,
		message,
		evidenceEventIds,
		evaluatedAt,
		...(unknownReason === undefined ? {} : { unknownReason }),
	};
}

function unknown(contract: AgentContract, options: EvaluateContractOptions, ruleId: string, message: string, reason: UnknownReason, events: readonly SessionEvent[], evaluatedAt: string): PolicyDecision {
	return createDecision(contract.name, options.sessionId, ruleId, 'unknown', message, events.map((event) => event.eventId), evaluatedAt, reason);
}

function preActionEvidence(contract: AgentContract, events: readonly SessionEvent[], commands: readonly SessionEvent[]): readonly SessionEvent[] | undefined {
	const fingerprint = contractFingerprint(contract);
	const attached = events.find((event) => event.kind === 'instruction.loaded' && event.actor === 'supervisor' && event.evidenceGrade === 'computed' && event.payload.scope === 'supervisor-actions' && event.payload.contractSha256 === fingerprint);
	if (attached === undefined) {
		return undefined;
	}
	const decisions: SessionEvent[] = [attached];
	for (const command of commands) {
		const decision = events.find((event) => event.kind === 'policy.decision' && event.evidenceGrade === 'computed' && event.actor === 'supervisor-tools'
			&& event.payload.phase === 'pre-action' && event.payload.scope === 'supervisor-actions' && event.payload.contractSha256 === fingerprint
			&& event.payload.allowed === true && command.actor === 'supervisor-tools' && command.correlationId !== undefined
			&& event.correlationId === command.correlationId && event.sequence < command.sequence);
		if (decision === undefined) {
			return undefined;
		}
		decisions.push(decision, command);
	}
	return decisions;
}

/**
 * Evaluates a validated contract from canonical retained events. Results are
 * deterministic from the contract and evidence; the timestamp is report metadata.
 */
export function evaluateContract(contract: AgentContract, options: EvaluateContractOptions): readonly PolicyDecision[] {
	const evaluatedAt = (options.now ?? (() => new Date()))().toISOString();
	const decisions: PolicyDecision[] = [];
	const observedCommands = options.events.filter((event) => hasObservedGrade(event) && commandText(event) !== undefined);
	const pathEvidence = observedPathEvidence(options.events);
	const observedPaths = pathEvidence.paths;
	const observedCompletions = options.events.filter((event) => hasObservedGrade(event) && (event.kind === 'process.completed' || event.kind === 'command.completed'));
	const observedFilesystemDiffs = options.events.filter(isObservedFilesystemDiff);
	const assertions = contract.assertions;
	const interceptionEvidence = preActionEvidence(contract, options.events, observedCommands);

	if (assertions?.commands?.allow !== undefined) {
		const outside = observedCommands.filter((event) => !assertions.commands!.allow!.some((pattern) => matchesCommand(commandText(event)!, pattern)));
		decisions.push(observedCommands.length === 0
			? unknown(contract, options, 'commands.allow', 'No executed command was observed.', 'not-observed', [], evaluatedAt)
			: createDecision(contract.name, options.sessionId, 'commands.allow', outside.length === 0 ? 'pass' : 'fail', outside.length === 0 ? 'All observed commands matched the allow list.' : 'Observed a command outside the allow list.', (outside.length === 0 ? observedCommands : outside).map((event) => event.eventId), evaluatedAt));
	}

	for (const [index, pattern] of (assertions?.commands?.deny ?? []).entries()) {
		const ruleId = `commands.deny[${index}]`;
		if (observedCommands.length === 0) {
			decisions.push(unknown(contract, options, ruleId, `Cannot determine whether forbidden command ${pattern} ran.`, 'not-observed', [], evaluatedAt));
			continue;
		}
		const matching = observedCommands.filter((event) => commandDenials({ version: 1, name: contract.name, assertions: { commands: { deny: [pattern] } } }, {
			kind: 'command', executable: event.payload.executable as string, args: (event.payload.args ?? []) as string[],
		}).length > 0);
		decisions.push(createDecision(
			contract.name,
			options.sessionId,
			ruleId,
			matching.length === 0 ? 'pass' : 'fail',
			matching.length === 0 ? `No observed command matched forbidden pattern ${pattern}.` : `Observed forbidden command matching ${pattern}.`,
			(matching.length === 0 ? observedCommands : matching).map((event) => event.eventId),
			evaluatedAt,
		));
	}

	for (const [index, pattern] of (assertions?.commands?.requireSuccess ?? []).entries()) {
		const ruleId = `commands.requireSuccess[${index}]`;
		if (observedCommands.length === 0) {
			decisions.push(unknown(contract, options, ruleId, `Required command ${pattern} was not observed.`, 'not-observed', [], evaluatedAt));
			continue;
		}
		const matchingStarts = observedCommands.filter((event) => matchesCommand(commandText(event)!, pattern));
		if (matchingStarts.length === 0) {
			decisions.push(createDecision(contract.name, options.sessionId, ruleId, 'fail', `Required command ${pattern} was not observed among captured commands.`, observedCommands.map((event) => event.eventId), evaluatedAt));
			continue;
		}
		const matchingIds = new Set(matchingStarts.map((event) => event.correlationId).filter((id): id is string => id !== undefined));
		const successful = observedCompletions.filter((event) => matchingIds.has(event.correlationId ?? '') && event.payload.succeeded === true);
		if (successful.length === 0) {
			const failed = observedCompletions.filter((event) => matchingIds.has(event.correlationId ?? '') && event.payload.succeeded === false);
			if (failed.length > 0) {
				decisions.push(createDecision(contract.name, options.sessionId, ruleId, 'fail', `Required command ${pattern} failed.`, [...matchingStarts, ...failed].map((event) => event.eventId), evaluatedAt));
				continue;
			}
			decisions.push(unknown(contract, options, ruleId, `No successful completion was retained for required command ${pattern}.`, 'not-observed', matchingStarts, evaluatedAt));
			continue;
		}
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, 'pass', `Required command ${pattern} completed successfully.`, [...matchingStarts, ...successful].map((event) => event.eventId), evaluatedAt));
	}

	if (assertions?.commands?.requirePreAction === true) {
		decisions.push(interceptionEvidence === undefined
			? unknown(contract, options, 'commands.requirePreAction', 'No complete pre-action proof exists for this exact contract and execution scope.', 'unsupported-capability', [], evaluatedAt)
			: createDecision(contract.name, options.sessionId, 'commands.requirePreAction', 'pass', 'All observed supervisor-executed commands were checked before execution. This does not cover uninstrumented actions or child processes.', interceptionEvidence.map((event) => event.eventId), evaluatedAt));
	}

	for (const [index, pattern] of (assertions?.paths?.deny ?? []).entries()) {
		const ruleId = `paths.deny[${index}]`;
		const matching = observedPaths.filter((observation) => matches(observation.path, pattern));
		if (matching.length === 0 && ((observedPaths.length === 0 && !pathEvidence.complete) || pathEvidence.ambiguous)) {
			decisions.push(unknown(contract, options, ruleId, `Cannot determine whether forbidden path ${pattern} changed.`, 'not-observed', [], evaluatedAt));
			continue;
		}
		const evidence = matching.length === 0 ? [...observedPaths.map((observation) => observation.event), ...pathEvidence.snapshots] : matching.map((observation) => observation.event);
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, matching.length === 0 ? 'pass' : 'fail', matching.length === 0 ? `No observed changed path matched forbidden pattern ${pattern}.` : `Observed changed path matching forbidden pattern ${pattern}.`, [...new Set(evidence.map((event) => event.eventId))], evaluatedAt));
	}

	for (const [index, patterns] of (assertions?.paths?.allow === undefined ? [] : [assertions.paths.allow]).entries()) {
		const ruleId = `paths.allow[${index}]`;
		const outside = observedPaths.filter((observation) => !patterns.some((pattern) => matches(observation.path, pattern)));
		if (outside.length === 0 && ((observedPaths.length === 0 && !pathEvidence.complete) || pathEvidence.ambiguous)) {
			decisions.push(unknown(contract, options, ruleId, 'Cannot determine whether changed paths are allowed.', 'not-observed', [], evaluatedAt));
			continue;
		}
		const evidence = outside.length === 0 ? [...observedPaths.map((observation) => observation.event), ...pathEvidence.snapshots] : outside.map((observation) => observation.event);
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, outside.length === 0 ? 'pass' : 'fail', outside.length === 0 ? 'All observed changed paths matched the allow list.' : 'Observed changed path outside the allow list.', [...new Set(evidence.map((event) => event.eventId))], evaluatedAt));
	}

	for (const [index, requirement] of (assertions?.evidence?.require ?? []).entries()) {
		const matching = requirement === 'command-result' ? observedCompletions : observedFilesystemDiffs;
		decisions.push(
			matching.length === 0
				? unknown(contract, options, `evidence.require[${index}]`, `Required evidence ${requirement} was not retained.`, 'not-observed', [], evaluatedAt)
				: createDecision(contract.name, options.sessionId, `evidence.require[${index}]`, 'pass', `Required evidence ${requirement} is retained.`, matching.map((event) => event.eventId), evaluatedAt),
		);
	}

	return decisions;
}