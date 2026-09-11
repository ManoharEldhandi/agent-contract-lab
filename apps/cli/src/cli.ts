import { doctorCommand } from './commands/doctor';
import { supervisorStatusCommand } from './commands/supervisorStatus';
import { optionFlag, optionString, parseArgs } from './args';
import { CLI_VERSION, DEFAULT_SUPERVISOR_URL, ExitCode, type EnvRecord } from './constants';
import type { CommandContext } from './context';
import { resolveColor, resolveFormat, writeLine, type OutputStream } from './output';
import type { FetchLike } from './protocolClient';

export interface CliEnvironment {
	readonly argv: readonly string[];
	readonly env: EnvRecord;
	readonly stdout: OutputStream;
	readonly stderr: OutputStream;
	readonly fetchImpl?: FetchLike;
}

const HELP = `agent-contract — local-first evidence and contracts for AI coding agents

Usage:
  agent-contract <command> [options]

Commands:
  doctor                 Check the CLI installation and supervisor reachability
  supervisor status      Show the local supervisor health and capabilities

Options:
  --supervisor-url <url> Loopback supervisor URL (default ${DEFAULT_SUPERVISOR_URL})
  --format <pretty|json> Output format (default: pretty on a TTY, else json)
  --require-supervisor   Make doctor fail when the supervisor is unavailable
  --version, -V          Print the CLI version
  --help, -h             Show this help

Environment:
  AGENT_CONTRACT_SUPERVISOR_URL  Overrides the default supervisor URL
  NO_COLOR / FORCE_COLOR         Disable / force ANSI color`;

export async function runCli(environment: CliEnvironment): Promise<number> {
	const { positionals, options } = parseArgs(environment.argv);

	if (optionFlag(options, 'version', 'V')) {
		writeLine(environment.stdout, CLI_VERSION);
		return ExitCode.Ok;
	}

	const wantsHelp = optionFlag(options, 'help', 'h');
	if (positionals.length === 0) {
		writeLine(wantsHelp ? environment.stdout : environment.stderr, HELP);
		return wantsHelp ? ExitCode.Ok : ExitCode.InvalidInvocation;
	}
	if (wantsHelp) {
		writeLine(environment.stdout, HELP);
		return ExitCode.Ok;
	}

	const isTTY = Boolean(environment.stdout.isTTY);
	const format = resolveFormat(optionString(options, 'format'), isTTY);
	if (format === undefined) {
		writeLine(environment.stderr, 'Invalid --format. Use "pretty" or "json".');
		return ExitCode.InvalidInvocation;
	}

	const context: CommandContext = {
		stdout: environment.stdout,
		stderr: environment.stderr,
		env: environment.env,
		format,
		color: resolveColor(isTTY, environment.env),
		supervisorUrl: optionString(options, 'supervisor-url') ?? environment.env.AGENT_CONTRACT_SUPERVISOR_URL ?? DEFAULT_SUPERVISOR_URL,
		fetchImpl: environment.fetchImpl,
	};

	const command = positionals[0];
	switch (command) {
		case 'doctor':
			return doctorCommand(context, { requireSupervisor: optionFlag(options, 'require-supervisor') });
		case 'supervisor': {
			const sub = positionals[1];
			if (sub === 'status') {
				return supervisorStatusCommand(context);
			}
			writeLine(environment.stderr, sub === undefined ? 'Usage: agent-contract supervisor status' : `Unknown supervisor subcommand: ${sub}`);
			return ExitCode.InvalidInvocation;
		}
		default:
			writeLine(environment.stderr, `Unknown command: ${command}`);
			writeLine(environment.stderr, HELP);
			return ExitCode.InvalidInvocation;
	}
}
