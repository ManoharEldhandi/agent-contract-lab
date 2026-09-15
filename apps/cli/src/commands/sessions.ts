import { ExitCode } from '../constants';
import type { CommandContext } from '../context';
import { writeJson, writeJsonLine, writeLine } from '../output';
import { requestSupervisor, type SessionsResult } from '../supervisorApi';

export async function sessionsCommand(context: CommandContext): Promise<ExitCode> {
	const outcome = await requestSupervisor<SessionsResult>(context, '/v1/sessions');
	if (outcome.kind === 'error') {
		writeLine(context.stderr, outcome.message);
		return ExitCode.Unavailable;
	}
	if (context.format === 'jsonl') {
		for (const session of outcome.data.sessions) {
			writeJsonLine(context.stdout, session);
		}
		return ExitCode.Ok;
	}
	if (context.format === 'json') {
		writeJson(context.stdout, { schemaVersion: 1, command: 'sessions.list', result: outcome.data });
		return ExitCode.Ok;
	}
	if (outcome.data.sessions.length === 0) {
		writeLine(context.stdout, 'No sessions recorded.');
		return ExitCode.Ok;
	}
	writeLine(context.stdout, 'SESSION                                STATE        MODE      EVENTS  TOKENS');
	for (const session of outcome.data.sessions) {
		const tokens = session.tokenUsage.status === 'reported' ? String(session.tokenUsage.totalTokens) : `unknown (${session.tokenUsage.reason})`;
		writeLine(context.stdout, `${session.sessionId.padEnd(38)} ${session.state.padEnd(12)} ${session.runMode.padEnd(9)} ${String(session.eventCount).padEnd(7)} ${tokens}`);
	}
	return ExitCode.Ok;
}