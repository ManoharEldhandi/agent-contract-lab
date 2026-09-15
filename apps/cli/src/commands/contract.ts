import { readFile } from 'node:fs/promises';

import { ExitCode } from '../constants';
import type { CommandContext } from '../context';
import { writeJson, writeJsonLine, writeLine } from '../output';
import { requestSupervisor, type ContractEvaluationResult } from '../supervisorApi';

export async function contractCommand(context: CommandContext, subcommand: string | undefined, sessionId: string | undefined, contractPath: string | undefined): Promise<ExitCode> {
	if (subcommand !== 'evaluate' || sessionId === undefined || contractPath === undefined) {
		writeLine(context.stderr, 'Usage: agent-contract contract evaluate <session-id> <contract.yaml>');
		return ExitCode.InvalidInvocation;
	}
	let contractYaml: string;
	try {
		contractYaml = await readFile(contractPath, 'utf8');
	} catch (error) {
		writeLine(context.stderr, `Could not read contract: ${error instanceof Error ? error.message : String(error)}`);
		return ExitCode.InvalidInvocation;
	}
	const outcome = await requestSupervisor<ContractEvaluationResult>(context, `/v1/sessions/${encodeURIComponent(sessionId)}/contracts/evaluate`, 'POST', { contractYaml });
	if (outcome.kind === 'error') {
		writeLine(context.stderr, outcome.message);
		return outcome.statusCode === 400 ? ExitCode.InvalidInvocation : ExitCode.Unavailable;
	}
	if (context.format === 'jsonl') {
		for (const decision of outcome.data.decisions) {
			writeJsonLine(context.stdout, decision);
		}
		return outcome.data.decisions.some((decision) => decision.result === 'fail') ? ExitCode.FindingFailed : outcome.data.decisions.some((decision) => decision.result === 'unknown') ? ExitCode.Unknown : ExitCode.Ok;
	}
	if (context.format === 'json') {
		writeJson(context.stdout, { schemaVersion: 1, command: 'contract.evaluate', result: outcome.data });
	} else {
		writeLine(context.stdout, `Contract ${outcome.data.contractName}`);
		writeLine(context.stdout, 'RESULT   RULE                         MESSAGE');
		for (const decision of outcome.data.decisions) {
			writeLine(context.stdout, `${decision.result.padEnd(8)} ${decision.ruleId.padEnd(28)} ${decision.message}`);
			if (decision.unknownReason !== undefined) {
				writeLine(context.stdout, `         evidence gap: ${decision.unknownReason}`);
			}
		}
	}
	if (outcome.data.decisions.some((decision) => decision.result === 'fail')) {
		return ExitCode.FindingFailed;
	}
	return outcome.data.decisions.some((decision) => decision.result === 'unknown') ? ExitCode.Unknown : ExitCode.Ok;
}