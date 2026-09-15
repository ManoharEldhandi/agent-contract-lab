import { createHash } from 'node:crypto';

import { minimatch } from 'minimatch';

import type { PolicyDecision, SessionEvent, UnknownReason } from '@agent-contract-lab/event-schema';

export interface ContractPaths {
	readonly allow?: readonly string[];
	readonly deny?: readonly string[];
}

export interface ContractCommands {
	readonly deny?: readonly string[];
	readonly requireSuccess?: readonly string[];
	/** The v0 generic runner has no agent-action interception capability. */
	readonly requirePreAction?: boolean;
}

export interface ContractEvidence {
	readonly require?: readonly ('command-result' | 'filesystem-diff')[];
}

export interface AgentContract {
	readonly version: 1;
	readonly name: string;
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

const OBSERVED_GRADES = new Set(['observed-native', 'observed-boundary']);
const SUPPORTED_EVIDENCE = new Set(['command-result', 'filesystem-diff']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringArray(value: unknown, path: string, issues: string[]): readonly string[] | undefined {
	if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
		issues.push(`${path} must be an array of non-empty strings`);
		return undefined;
	}
	return value;
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
	if (root.version !== 1) {
		issues.push('version must be 1');
	}
	const name = root.name;
	if (typeof name !== 'string' || name.trim() === '') {
		issues.push('name must be a non-empty string');
	}
	const assertions = optionalObject(root, 'assertions', 'contract', issues);
	let paths: ContractPaths | undefined;
	let commands: ContractCommands | undefined;
	let evidence: ContractEvidence | undefined;
	if (assertions !== undefined) {
		const pathRecord = optionalObject(assertions, 'paths', 'assertions', issues);
		if (pathRecord !== undefined) {
			const allow = optionalStringArray(pathRecord, 'allow', 'assertions.paths', issues);
			const deny = optionalStringArray(pathRecord, 'deny', 'assertions.paths', issues);
			paths = { ...(allow === undefined ? {} : { allow }), ...(deny === undefined ? {} : { deny }) };
		}
		const commandRecord = optionalObject(assertions, 'commands', 'assertions', issues);
		if (commandRecord !== undefined) {
			const deny = optionalStringArray(commandRecord, 'deny', 'assertions.commands', issues);
			const requireSuccess = optionalStringArray(commandRecord, 'requireSuccess', 'assertions.commands', issues);
			const requirePreAction = commandRecord.requirePreAction;
			if (requirePreAction !== undefined && typeof requirePreAction !== 'boolean') {
				issues.push('assertions.commands.requirePreAction must be a boolean');
			}
			commands = {
				...(deny === undefined ? {} : { deny }),
				...(requireSuccess === undefined ? {} : { requireSuccess }),
				...(typeof requirePreAction === 'boolean' ? { requirePreAction } : {}),
			};
		}
		const evidenceRecord = optionalObject(assertions, 'evidence', 'assertions', issues);
		if (evidenceRecord !== undefined) {
			const required = optionalStringArray(evidenceRecord, 'require', 'assertions.evidence', issues);
			if (required !== undefined && required.some((entry) => !SUPPORTED_EVIDENCE.has(entry))) {
				issues.push('assertions.evidence.require contains an unsupported evidence type');
			}
			evidence = required === undefined ? {} : { require: required as ContractEvidence['require'] };
		}
	}
	if (issues.length > 0 || typeof name !== 'string' || name.trim() === '') {
		return { ok: false, issues };
	}
	return { ok: true, contract: { version: 1, name, assertions: assertions === undefined ? undefined : { paths, commands, evidence } } };
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

function changedPath(event: SessionEvent): string | undefined {
	if (event.kind !== 'file.changed' || typeof event.payload.path !== 'string') {
		return undefined;
	}
	const path = event.payload.path.replace(/\\/g, '/');
	if (path.startsWith('/') || path.startsWith('../') || path.includes('/../') || path === '..') {
		return undefined;
	}
	return path;
}

function isObservedFilesystemDiff(event: SessionEvent): boolean {
	if (event.kind !== 'workspace.diff' || !hasObservedGrade(event)) {
		return false;
	}
	const current = asRecord(event.payload.current);
	return current !== undefined && Array.isArray(current.paths) && current.paths.every((path) => typeof path === 'string') && typeof current.diffSha256 === 'string' && current.diffSha256 !== '';
}

function matches(value: string, pattern: string): boolean {
	return minimatch(value, pattern, { dot: true, nonegate: true, nocase: false });
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

/**
 * Evaluates a validated contract from canonical retained events. Results are
 * deterministic from the contract and evidence; the timestamp is report metadata.
 */
export function evaluateContract(contract: AgentContract, options: EvaluateContractOptions): readonly PolicyDecision[] {
	const evaluatedAt = (options.now ?? (() => new Date()))().toISOString();
	const decisions: PolicyDecision[] = [];
	const observedCommands = options.events.filter((event) => hasObservedGrade(event) && commandText(event) !== undefined);
	const observedPaths = options.events.filter((event) => hasObservedGrade(event) && changedPath(event) !== undefined);
	const observedCompletions = options.events.filter((event) => hasObservedGrade(event) && (event.kind === 'process.completed' || event.kind === 'command.completed'));
	const observedFilesystemDiffs = options.events.filter(isObservedFilesystemDiff);
	const assertions = contract.assertions;

	for (const [index, pattern] of (assertions?.commands?.deny ?? []).entries()) {
		const ruleId = `commands.deny[${index}]`;
		if (observedCommands.length === 0) {
			decisions.push(unknown(contract, options, ruleId, `Cannot determine whether forbidden command ${pattern} ran.`, 'not-observed', [], evaluatedAt));
			continue;
		}
		const matching = observedCommands.filter((event) => matches(commandText(event)!, pattern));
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
		const matchingStarts = observedCommands.filter((event) => matches(commandText(event)!, pattern));
		if (matchingStarts.length === 0) {
			decisions.push(createDecision(contract.name, options.sessionId, ruleId, 'fail', `Required command ${pattern} was not observed among captured commands.`, observedCommands.map((event) => event.eventId), evaluatedAt));
			continue;
		}
		const matchingIds = new Set(matchingStarts.map((event) => event.correlationId).filter((id): id is string => id !== undefined));
		const successful = observedCompletions.filter((event) => matchingIds.has(event.correlationId ?? '') && event.payload.succeeded === true);
		if (successful.length === 0) {
			decisions.push(unknown(contract, options, ruleId, `No successful completion was retained for required command ${pattern}.`, 'not-observed', matchingStarts, evaluatedAt));
			continue;
		}
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, 'pass', `Required command ${pattern} completed successfully.`, [...matchingStarts, ...successful].map((event) => event.eventId), evaluatedAt));
	}

	if (assertions?.commands?.requirePreAction === true) {
		decisions.push(unknown(contract, options, 'commands.requirePreAction', 'This supervisor recorded post-action boundary evidence but did not intercept agent actions before execution.', 'unsupported-capability', [], evaluatedAt));
	}

	for (const [index, pattern] of (assertions?.paths?.deny ?? []).entries()) {
		const ruleId = `paths.deny[${index}]`;
		if (observedPaths.length === 0) {
			decisions.push(unknown(contract, options, ruleId, `Cannot determine whether forbidden path ${pattern} changed.`, 'not-observed', [], evaluatedAt));
			continue;
		}
		const matching = observedPaths.filter((event) => matches(changedPath(event)!, pattern));
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, matching.length === 0 ? 'pass' : 'fail', matching.length === 0 ? `No observed changed path matched forbidden pattern ${pattern}.` : `Observed changed path matching forbidden pattern ${pattern}.`, (matching.length === 0 ? observedPaths : matching).map((event) => event.eventId), evaluatedAt));
	}

	for (const [index, patterns] of (assertions?.paths?.allow === undefined ? [] : [assertions.paths.allow]).entries()) {
		const ruleId = `paths.allow[${index}]`;
		if (observedPaths.length === 0) {
			decisions.push(unknown(contract, options, ruleId, 'Cannot determine whether changed paths are allowed.', 'not-observed', [], evaluatedAt));
			continue;
		}
		const outside = observedPaths.filter((event) => !patterns.some((pattern) => matches(changedPath(event)!, pattern)));
		decisions.push(createDecision(contract.name, options.sessionId, ruleId, outside.length === 0 ? 'pass' : 'fail', outside.length === 0 ? 'All observed changed paths matched the allow list.' : 'Observed changed path outside the allow list.', outside.map((event) => event.eventId), evaluatedAt));
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