import { ExitCode } from '../constants';
import type { CommandContext } from '../context';
import { writeJson, writeJsonLine, writeLine } from '../output';
import { requestSupervisor, type SessionResult } from '../supervisorApi';

export interface CodexCommandOptions {
	readonly model?: string;
	readonly maxDurationMs?: string;
	readonly maxTokens?: string;
}

function positiveInteger(value: string | undefined, option: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${option} must be a positive integer`);
	}
	return parsed;
}

/** Starts a directly supervised Codex App Server task, not an opaque shell command. */
export async function codexCommand(context: CommandContext, taskParts: readonly string[], options: CodexCommandOptions): Promise<ExitCode> {
	const task = taskParts.join(' ').trim();
	if (task === '') {
		writeLine(context.stderr, 'Usage: agent-contract agent codex <task> [--model <model>] [--max-duration-ms <ms>] [--max-tokens <n>]');
		return ExitCode.InvalidInvocation;
	}
	let maxDurationMs: number | undefined;
	let maxTokens: number | undefined;
	try {
		maxDurationMs = positiveInteger(options.maxDurationMs, '--max-duration-ms');
		maxTokens = positiveInteger(options.maxTokens, '--max-tokens');
	} catch (error) {
		writeLine(context.stderr, error instanceof Error ? error.message : String(error));
		return ExitCode.InvalidInvocation;
	}
	const outcome = await requestSupervisor<SessionResult>(context, '/v1/codex-sessions', 'POST', {
		workspacePath: process.cwd(),
		task,
		...(options.model === undefined ? {} : { model: options.model }),
		...(maxDurationMs === undefined ? {} : { maxDurationMs }),
		...(maxTokens === undefined ? {} : { maxTokens }),
	});
	if (outcome.kind === 'error') {
		writeLine(context.stderr, outcome.message);
		return outcome.statusCode === 403 ? ExitCode.InvalidInvocation : ExitCode.Unavailable;
	}
	if (context.format === 'pretty') {
		writeLine(context.stdout, `Started supervised Codex session ${outcome.data.session.sessionId}`);
		writeLine(context.stdout, `Run 'agent-contract watch ${outcome.data.session.sessionId}' for live evidence or 'agent-contract logs ${outcome.data.session.sessionId}' when it completes.`);
	} else if (context.format === 'jsonl') {
		writeJsonLine(context.stdout, { schemaVersion: 1, command: 'agent codex', result: outcome.data });
	} else {
		writeJson(context.stdout, { schemaVersion: 1, command: 'agent codex', result: outcome.data });
	}
	return ExitCode.Ok;
}
