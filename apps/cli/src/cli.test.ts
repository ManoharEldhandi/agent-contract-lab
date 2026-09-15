import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCli } from './cli';
import { ExitCode } from './constants';
import type { OutputStream } from './output';
import type { FetchLike } from './protocolClient';

class Capture implements OutputStream {
	data = '';
	readonly isTTY?: boolean;
	constructor(isTTY?: boolean) {
		this.isTTY = isTTY;
	}
	write(chunk: string): boolean {
		this.data += chunk;
		return true;
	}
}

function validHealthBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		status: 'ok',
		supervisorVersion: '0.1.0',
		apiVersion: '1.0',
		schemaVersion: 1,
		instanceId: 'sup_abc',
		startedAt: '2026-09-11T14:00:00.000Z',
		capabilities: { adapters: [], features: ['health'] },
		...overrides,
	};
}

function jsonFetch(body: unknown, status = 200): FetchLike {
	return async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

const unreachableFetch: FetchLike = async () => {
	throw new Error('connect ECONNREFUSED');
};

interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

async function run(argv: string[], fetchImpl?: FetchLike, env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
	const stdout = new Capture(false);
	const stderr = new Capture(false);
	const code = await runCli({ argv, env, stdout, stderr, fetchImpl });
	return { code, stdout: stdout.data, stderr: stderr.data };
}

test('no arguments prints help to stderr and returns InvalidInvocation', async () => {
	const result = await run([]);
	assert.equal(result.code, ExitCode.InvalidInvocation);
	assert.match(result.stderr, /Usage:/);
});

test('--help returns Ok and prints to stdout', async () => {
	const result = await run(['--help']);
	assert.equal(result.code, ExitCode.Ok);
	assert.match(result.stdout, /Usage:/);
});

test('--version prints the version', async () => {
	const result = await run(['--version']);
	assert.equal(result.code, ExitCode.Ok);
	assert.match(result.stdout, /0\.1\.0/);
});

test('unknown command returns InvalidInvocation', async () => {
	const result = await run(['frobnicate']);
	assert.equal(result.code, ExitCode.InvalidInvocation);
	assert.match(result.stderr, /Unknown command/);
});

test('invalid --format returns InvalidInvocation', async () => {
	const result = await run(['doctor', '--format', 'xml']);
	assert.equal(result.code, ExitCode.InvalidInvocation);
});

test('supervisor with no subcommand returns InvalidInvocation', async () => {
	const result = await run(['supervisor']);
	assert.equal(result.code, ExitCode.InvalidInvocation);
});

test('supervisor status ok returns Ok and emits JSON result', async () => {
	const result = await run(['supervisor', 'status', '--format', 'json'], jsonFetch(validHealthBody()));
	assert.equal(result.code, ExitCode.Ok);
	const parsed = JSON.parse(result.stdout) as { command: string; result: { status: string } };
	assert.equal(parsed.command, 'supervisor.status');
	assert.equal(parsed.result.status, 'ok');
});

test('supervisor status unreachable returns Unavailable', async () => {
	const result = await run(['supervisor', 'status'], unreachableFetch);
	assert.equal(result.code, ExitCode.Unavailable);
});

test('supervisor status incompatible returns Unavailable', async () => {
	const result = await run(['supervisor', 'status'], jsonFetch(validHealthBody({ apiVersion: '2.0' })));
	assert.equal(result.code, ExitCode.Unavailable);
});

test('supervisor status malformed returns Internal', async () => {
	const result = await run(['supervisor', 'status'], jsonFetch({ status: 'ok' }));
	assert.equal(result.code, ExitCode.Internal);
});

test('doctor returns Ok even when the supervisor is down', async () => {
	const result = await run(['doctor', '--format', 'json'], unreachableFetch);
	assert.equal(result.code, ExitCode.Ok);
	const parsed = JSON.parse(result.stdout) as { ok: boolean; checks: { name: string; status: string }[] };
	assert.equal(parsed.ok, true);
	const supervisor = parsed.checks.find((check) => check.name === 'supervisor');
	assert.equal(supervisor?.status, 'warn');
});

test('doctor --require-supervisor returns Unavailable when the supervisor is down', async () => {
	const result = await run(['doctor', '--require-supervisor'], unreachableFetch);
	assert.equal(result.code, ExitCode.Unavailable);
});

test('doctor reports a connected supervisor', async () => {
	const result = await run(['doctor', '--format', 'json'], jsonFetch(validHealthBody()));
	assert.equal(result.code, ExitCode.Ok);
	const parsed = JSON.parse(result.stdout) as { checks: { name: string; status: string }[] };
	const supervisor = parsed.checks.find((check) => check.name === 'supervisor');
	assert.equal(supervisor?.status, 'ok');
});
