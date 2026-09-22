#!/usr/bin/env node
import { startSupervisor } from './server';
import { DEFAULT_SUPERVISOR_PORT, SUPERVISOR_VERSION } from './version';

function resolvePort(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === '') {
		return DEFAULT_SUPERVISOR_PORT;
	}
	const parsed = Number.parseInt(raw, 10);
	if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
		throw new Error(`invalid AGENT_CONTRACT_SUPERVISOR_PORT: ${raw}`);
	}
	return parsed;
}

function resolveHost(raw: string | undefined): '127.0.0.1' | '::1' {
	if (raw === undefined || raw.trim() === '') {
		return '127.0.0.1';
	}
	if (raw === '127.0.0.1' || raw === '::1') {
		return raw;
	}
	throw new Error(`invalid AGENT_CONTRACT_SUPERVISOR_HOST: ${raw}`);
}

async function main(): Promise<void> {
	const port = resolvePort(process.env.AGENT_CONTRACT_SUPERVISOR_PORT);
	const running = await startSupervisor({ version: SUPERVISOR_VERSION, host: resolveHost(process.env.AGENT_CONTRACT_SUPERVISOR_HOST), port });
	process.stderr.write(`agent-contract supervisor ${SUPERVISOR_VERSION} listening on ${running.url} (instance ${running.instanceId})\n`);

	let closing = false;
	const shutdown = (): void => {
		if (closing) {
			return;
		}
		closing = true;
		running
			.close()
			.then(() => process.exit(0))
			.catch(() => process.exit(1));
	};
	process.on('SIGINT', shutdown);
	process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
	const message = error instanceof Error ? error.message : String(error);
	process.stderr.write(`supervisor failed to start: ${message}\n`);
	process.exit(1);
});
