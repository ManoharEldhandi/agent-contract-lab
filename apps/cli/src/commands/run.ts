import { readFile } from 'node:fs/promises';

import { ExitCode } from '../constants';
import type { CommandContext } from '../context';
import { writeJson, writeJsonLine, writeLine } from '../output';
import { requestSupervisor, type ApiOutcome, type ContractEvaluationResult, type SessionResult } from '../supervisorApi';
import { contractExitCode } from './contract';

interface RunOptions {
	readonly contractPath?: string;
	readonly wait?: boolean;
}

async function waitForRun(context: CommandContext, initial: SessionResult): Promise<ApiOutcome<SessionResult>> {
	let current = initial;
	const deadline = Date.now() + 30 * 60 * 1_000;
	while (current.session.state === 'running') {
		if (Date.now() > deadline) {
			return { kind: 'error', message: `Timed out waiting for ${current.session.sessionId}. Its retained session remains available.` };
		}
		const outcome = await requestSupervisor<SessionResult>(context, `/v1/sessions/${encodeURIComponent(current.session.sessionId)}`);
		if (outcome.kind === 'error') {
			return outcome;
		}
		current = outcome.data;
		if (current.session.state === 'running') {
			await new Promise<void>((resolve) => setTimeout(resolve, 100));
		}
	}
	return { kind: 'ok', data: current };
}

function printRun(context: CommandContext, data: SessionResult, evaluation?: ContractEvaluationResult): void {
	if (context.format === 'pretty') {
		writeLine(context.stdout, `Session ${data.session.sessionId}: ${data.session.state}`);
		for (const decision of evaluation?.decisions ?? []) {
			writeLine(context.stdout, `${decision.result.toUpperCase()} ${decision.ruleId}: ${decision.message}`);
		}
		writeLine(context.stdout, `Run 'agent-contract logs ${data.session.sessionId}' to inspect its committed evidence.`);
	} else {
		const result = { schemaVersion: 1, command: 'run', result: { ...data, ...(evaluation === undefined ? {} : { evaluation }) } };
		(context.format === 'jsonl' ? writeJsonLine : writeJson)(context.stdout, result);
	}
}

export async function runCommand(context: CommandContext, command: readonly string[], actor: string | undefined, isolated: boolean, options: RunOptions = {}): Promise<ExitCode> {
	const executable = command[0];
	if (executable === undefined) {
		writeLine(context.stderr, 'Usage: agent-contract run [--contract <file>] [--wait] [--isolated] -- <executable> [arguments...]');
		return ExitCode.InvalidInvocation;
	}
	let contractYaml: string | undefined;
	if (options.contractPath !== undefined) {
		try {
			contractYaml = await readFile(options.contractPath, 'utf8');
		} catch (error) {
			writeLine(context.stderr, `Could not read contract: ${error instanceof Error ? error.message : String(error)}`);
			return ExitCode.InvalidInvocation;
		}
	}
	const outcome = await requestSupervisor<SessionResult>(context, '/v1/runs', 'POST', {
		workspacePath: process.cwd(), executable, args: command.slice(1), isolated, ...(actor === undefined ? {} : { actor }),
		...(contractYaml === undefined ? {} : { contractYaml }),
	});
	if (outcome.kind === 'error') {
		writeLine(context.stderr, outcome.message);
		return outcome.statusCode === 400 || outcome.statusCode === 403 ? ExitCode.InvalidInvocation : ExitCode.Unavailable;
	}
	const terminal = options.wait ? await waitForRun(context, outcome.data) : outcome;
	if (terminal.kind === 'error') {
		writeLine(context.stderr, terminal.message);
		return ExitCode.Unavailable;
	}
	let evaluation: ContractEvaluationResult | undefined;
	if (options.wait && contractYaml !== undefined) {
		const evaluated = await requestSupervisor<ContractEvaluationResult>(context, `/v1/sessions/${encodeURIComponent(terminal.data.session.sessionId)}/contracts/evaluate`, 'POST', { contractYaml });
		if (evaluated.kind === 'error') {
			writeLine(context.stderr, evaluated.message);
			return ExitCode.Unavailable;
		}
		evaluation = evaluated.data;
	}
	printRun(context, terminal.data, evaluation);
	if (terminal.data.session.state === 'failed' || terminal.data.session.state === 'interrupted') {
		return ExitCode.FindingFailed;
	}
	return evaluation === undefined ? ExitCode.Ok : contractExitCode(evaluation.decisions);
}