import assert from 'node:assert/strict';
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { WorkspaceActionExecutor } from './workspaceActions';

const directories: string[] = [];

async function workspace(): Promise<string> {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'agent-contract-actions-')));
	directories.push(directory);
	await mkdir(join(directory, 'src'));
	return directory;
}

after(async () => {
	await Promise.all(directories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test('workspace actions perform real bounded file reads and writes', async () => {
	const root = await workspace();
	const executor = new WorkspaceActionExecutor(root);
	const written = await executor.execute({ kind: 'file.write', path: 'src/app.ts', content: 'export const answer = 42;\n' });
	assert.equal(written.success, true);
	assert.equal(written.result.operation, 'created');
	assert.equal((await executor.execute({ kind: 'file.read', path: 'src/app.ts' })).result.content, 'export const answer = 42;\n');
	await assert.rejects(executor.execute({ kind: 'file.write', path: 'src/big', content: 'x'.repeat(256 * 1024 + 1) }), /size limit/);
});

test('workspace actions refuse traversal, symlink files, symlink parents, and hardlinks without changing targets', async () => {
	const root = await workspace();
	const outside = await workspace();
	await writeFile(join(outside, 'secret'), 'unchanged');
	await symlink(join(outside, 'secret'), join(root, 'src', 'linked'));
	await symlink(outside, join(root, 'external'));
	await link(join(outside, 'secret'), join(root, 'src', 'hardlinked'));
	const executor = new WorkspaceActionExecutor(root);
	for (const path of ['../secret', join(outside, 'secret'), 'src/linked', 'external/secret', 'src/hardlinked']) {
		await assert.rejects(executor.execute({ kind: 'file.write', path, content: 'changed' }), path);
	}
	assert.equal(await readFile(join(outside, 'secret'), 'utf8'), 'unchanged');
});

test('workspace commands bound output, enforce deadlines, and do not inherit supervisor credentials', async () => {
	const root = await workspace();
	const executor = new WorkspaceActionExecutor(root, { ...process.env, AGENT_CONTRACT_TOKEN: 'never-inherit', MODEL_WORKLOG_TOKEN: 'never-inherit' });
	const result = await executor.execute({ kind: 'command', executable: process.execPath, args: ['-e', 'process.stdout.write(String(process.env.AGENT_CONTRACT_TOKEN)); process.stdout.write("x".repeat(100000))'], timeoutMs: 2_000 });
	assert.equal(result.success, true);
	assert.equal(result.result.truncated, true);
	assert.equal(Buffer.byteLength(String(result.result.stdout)), 64 * 1024);
	assert.equal(String(result.result.stdout).startsWith('undefined'), true);
	const timeout = await executor.execute({ kind: 'command', executable: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 100 });
	assert.equal(timeout.success, false);
	assert.equal(timeout.result.timedOut, true);
	executor.stop();
	await assert.rejects(executor.execute({ kind: 'file.read', path: 'src/app.ts' }), /stopped/);
});
