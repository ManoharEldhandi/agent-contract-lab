import { ExitCode } from '../constants';
import type { CommandContext } from '../context';
import { fetchHealth } from '../protocolClient';
import { renderStatusPretty, writeStatusJson } from '../render';

export async function supervisorStatusCommand(context: CommandContext): Promise<ExitCode> {
	const outcome = await fetchHealth(context.supervisorUrl, { fetchImpl: context.fetchImpl });

	if (context.format === 'pretty') {
		renderStatusPretty(context, outcome);
	} else {
		writeStatusJson(context, 'supervisor.status', outcome);
	}

	switch (outcome.kind) {
		case 'ok':
			return ExitCode.Ok;
		case 'malformed':
			return ExitCode.Internal;
		case 'incompatible':
		case 'http-error':
		case 'unreachable':
			return ExitCode.Unavailable;
	}
}
