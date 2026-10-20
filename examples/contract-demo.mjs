import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs, promisify } from 'node:util';

import { LocalSupervisorClient, ModelLoggerTelemetry } from '@agent-contract-lab/adapter-sdk';
import { startSupervisor } from '@agent-contract-lab/local-supervisor';
import { createLocalModelLogger } from 'model-worklog-sdk';
import { TraceDetailSchema, TraceListSchema } from 'model-worklog-schema';
import { createTraceCredential, startSupervisor as startTraceCollector } from 'model-worklog-supervisor';

const runFile = promisify(execFile);
const PROJECT_ID = 'contract-demo';
const FIXED_INVENTORY = `function inventoryValue(items) {
\treturn items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
}

module.exports = { inventoryValue };
`;

async function request(supervisor, pathname, method = 'GET', body, token = supervisor.authToken, tokenHeader = 'x-agent-contract-token') {
	const response = await fetch(new URL(pathname, supervisor.url), {
		method, redirect: 'error', headers: { 'content-type': 'application/json', [tokenHeader]: token },
		...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(35_000),
	});
	assert.ok(response.ok, `${pathname} returned HTTP ${response.status}`);
	return response.json();
}

async function createFixture(directory) {
	const workspacePath = join(directory, 'workspace');
	await cp(new URL('./fixtures/inventory/', import.meta.url), workspacePath, { recursive: true });
	const git = (args) => runFile('git', [
		'-c', 'core.hooksPath=/dev/null', '-c', 'user.name=Contract Demo', '-c', 'user.email=demo@example.invalid',
		'-c', 'commit.gpgSign=false', '-C', workspacePath, ...args,
	]);
	await git(['init', '--initial-branch=main']);
	await git(['add', '.']);
	await git(['commit', '-m', 'Seed intentionally failing inventory fixture']);
	return realpath(workspacePath);
}

function fixtureContract() {
	const testCommand = `${process.execPath} --test src/inventory.test.cjs`;
	return JSON.stringify({
		version: 1, name: 'inventory-source-only',
		assertions: {
			paths: { allow: ['src/**'], deny: ['src/private/**'] },
			commands: { allow: [testCommand], deny: ['rm *'], requireSuccess: [testCommand], requirePreAction: true },
			evidence: { require: ['command-result', 'filesystem-diff'] },
		},
	});
}

async function runScriptedRepair(client, workspacePath, telemetry) {
	const session = await client.startContractSession({
		workspacePath, actor: 'scripted-demo', title: 'Repair inventory totals under a source-only contract',
		contractYaml: fixtureContract(), telemetry,
	});
	await session.userMessage('Repair inventory totals. Change only src/ and run the focused tests.');
	await session.plan('Inspect the implementation, repair the quantity calculation, and rerun the focused tests.');
	const read = await session.executeAction({ kind: 'file.read', path: 'src/inventory.cjs' });
	assert.equal(read.status, 'completed');
	assert.match(read.result.content, /item\.unitPrice/);
	const blockedWrite = await session.executeAction({ kind: 'file.write', path: 'README.md', content: 'This must never be written.' });
	const blockedCommand = await session.executeAction({ kind: 'command', executable: 'rm', args: ['-rf', 'src'] });
	assert.equal(blockedWrite.status, 'blocked');
	assert.equal(blockedCommand.status, 'blocked');
	const testAction = { kind: 'command', executable: process.execPath, args: ['--test', 'src/inventory.test.cjs'] };
	const before = await session.executeAction(testAction);
	assert.equal(before.status, 'failed', 'The initial fixture must actually fail.');
	const repair = await session.executeAction({ kind: 'file.write', path: 'src/inventory.cjs', content: FIXED_INVENTORY });
	assert.equal(repair.status, 'completed');
	const after = await session.executeAction(testAction);
	assert.equal(after.status, 'completed', 'The repaired fixture must actually pass.');
	await session.agentMessage('Inventory totals now include quantity. The focused tests pass.');
	await session.complete();
	return { sessionId: session.record.sessionId, blockedActions: 2, failedBeforeRepair: !before.success, passedAfterRepair: after.success };
}

async function collectTrace(collector) {
	const reader = await createTraceCredential({ url: collector.url, adminToken: collector.authToken, role: 'reader', projects: [PROJECT_ID] });
	const listed = TraceListSchema.parse(await request(collector, `/v2/traces?projectId=${PROJECT_ID}`, 'GET', undefined, reader.token, 'x-model-worklog-token'));
	assert.equal(listed.traces.length, 1);
	const traceId = listed.traces[0].traceId;
	const trace = TraceDetailSchema.parse(await request(collector, `/v2/traces/${traceId}?projectId=${PROJECT_ID}`, 'GET', undefined, reader.token, 'x-model-worklog-token'));
	assert.equal(trace.spans.length, 7);
	assert.ok(trace.spans.every((stored) => stored.evidenceGrade === 'model-declared'));
	const root = trace.spans.find((stored) => stored.span.kind === 'agent');
	assert.ok(root);
	assert.equal(trace.spans.filter((stored) => stored.span.parentSpanId === root.span.spanId).length, 6);
	assert.equal(trace.spans.filter((stored) => stored.span.events.some((event) => event.name === 'agent-contract.action.blocked')).length, 2);
	assert.equal(trace.spans.filter((stored) => stored.span.events.some((event) => event.name === 'agent-contract.action.failed')).length, 1);
	return { trace, readerToken: reader.token };
}

async function exportArtifacts(outputDirectory, report, bundle, trace) {
	await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
	for (const [filename, content] of [['report.json', report], ['evidence.bundle.json', bundle], ['model-logger.trace.json', trace]]) {
		await writeFile(join(outputDirectory, filename), `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
	}
}

const { values } = parseArgs({ options: { output: { type: 'string', default: '.agent-contract-demo' } } });
const outputDirectory = resolve(values.output);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'agent-contract-demo-')));
let supervisor;
let traceCollector;
let logger;

try {
	const workspacePath = await createFixture(temporary);
	const original = await readFile(join(workspacePath, 'src/inventory.cjs'), 'utf8');
	supervisor = await startSupervisor({ host: '127.0.0.1', port: 0, dataDirectory: join(temporary, 'contracts') });
	traceCollector = await startTraceCollector({ host: '127.0.0.1', port: 0, dataDirectory: join(temporary, 'traces') });
	const writer = await createTraceCredential({ url: traceCollector.url, adminToken: traceCollector.authToken, role: 'writer', projects: [PROJECT_ID] });
	logger = await createLocalModelLogger({ projectId: PROJECT_ID, serviceName: 'agent-contract-demo', endpoint: traceCollector.url, token: writer.token });
	await request(supervisor, '/v1/workspaces/trust', 'POST', { workspacePath });
	const client = new LocalSupervisorClient({ supervisorUrl: supervisor.url, token: supervisor.authToken });
	const scenario = await logger.trace({ name: 'inventory.contract-repair', kind: 'agent' }, () => runScriptedRepair(client, workspacePath, new ModelLoggerTelemetry(logger)));
	const delivery = await logger.shutdown();
	assert.equal(delivery.success, true);
	const { events } = await client.getEvents(scenario.sessionId);
	const decisions = events.filter((event) => event.kind === 'policy.decision' && event.evidenceGrade === 'computed' && event.payload.phase !== 'pre-action');
	assert.ok(decisions.length > 0);
	assert.ok(decisions.every((event) => event.payload.result === 'pass'), JSON.stringify(decisions.map((event) => event.payload)));
	assert.equal(await readFile(join(workspacePath, 'src/inventory.cjs'), 'utf8'), original, 'The source checkout must stay unchanged.');
	const { bundle } = await request(supervisor, `/v1/sessions/${scenario.sessionId}/evidence-bundle`);
	assert.equal((await request(supervisor, '/v1/evidence-bundles/verify', 'POST', { bundle })).verification.valid, true);
	const tampered = structuredClone(bundle);
	tampered.session.actor = 'tampered';
	assert.equal((await request(supervisor, '/v1/evidence-bundles/verify', 'POST', { bundle: tampered })).verification.valid, false);
	const { trace, readerToken } = await collectTrace(traceCollector);
	const exported = JSON.stringify({ bundle, trace });
	for (const credential of [supervisor.authToken, traceCollector.authToken, writer.token, readerToken]) {
		assert.equal(exported.includes(credential), false, 'Credentials must not appear in exported artifacts.');
	}
	assert.equal(JSON.stringify(bundle).includes(workspacePath), false);
	const report = {
		schemaVersion: 1, scenario: 'scripted-offline-repair', contractName: 'inventory-source-only', verdict: 'pass',
		...scenario, contractAssertions: decisions.length, sourceUnchanged: true, evidenceVerified: true, tamperDetected: true,
		modelLogger: { sdkVersion: '2.1.0', traceId: trace.spans[0].span.traceId, spans: trace.spans.length, delivery },
		limitations: ['The repair is scripted, not a model response.', 'Only supervisor-owned actions are intercepted.', 'Allowed commands are not OS-sandboxed; child processes are not individually intercepted.', 'No model usage or cost is invented.'],
	};
	await exportArtifacts(outputDirectory, report, bundle, trace);
	console.log('PASS: source-only contract, blocked write, blocked command, failing test, repair, passing tests.');
	console.log(`PASS: ${decisions.length} contract assertions, unchanged source checkout, verified bundle, tamper detection.`);
	console.log(`PASS: Model Logger SDK 2.1.0 delivered ${trace.spans.length} correlated spans without exposing credentials.`);
	console.log(`Report: ${join(outputDirectory, 'report.json')}`);
	console.log(`Evidence: ${join(outputDirectory, 'evidence.bundle.json')}`);
	console.log(`Trace: ${join(outputDirectory, 'model-logger.trace.json')}`);
} finally {
	await logger?.shutdown();
	await supervisor?.close();
	await traceCollector?.close();
	await rm(temporary, { recursive: true, force: true });
}
