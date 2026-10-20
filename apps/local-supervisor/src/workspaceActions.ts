import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import type { ActionExecutor, ActionOutcome, ContractAction } from './contractExecution';
import { boundedUtf8 } from './textBounds';

export const MAX_ACTION_FILE_BYTES = 256 * 1024;
const MAX_ACTION_OUTPUT_BYTES = 64 * 1024;

function commandEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'LC_ALL'].flatMap((key) => {
		const value = environment[key];
		return value === undefined ? [] : [[key, value]];
	}));
}

function terminate(child: ChildProcess): void {
	try {
		if (process.platform !== 'win32' && child.pid !== undefined) {
			process.kill(-child.pid, 'SIGKILL');
		} else {
			child.kill('SIGKILL');
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
			child.kill('SIGKILL');
		}
	}
}

function isWithin(root: string, candidate: string): boolean {
	const path = relative(root, candidate);
	return path !== '' && path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(path);
}

export class WorkspaceActionExecutor implements ActionExecutor {
	private readonly environment: NodeJS.ProcessEnv;
	private readonly children = new Set<ChildProcess>();
	private stopped = false;

	constructor(private readonly workspacePath: string, environment: NodeJS.ProcessEnv = process.env, private readonly limits: { readonly maxOutputBytes?: number } = {}) {
		this.environment = Object.freeze(commandEnvironment(environment));
	}

	execute(action: ContractAction): Promise<ActionOutcome> {
		if (this.stopped) {
			return Promise.reject(new Error('workspace executor has stopped'));
		}
		if (action.kind === 'command') {
			return this.command(action);
		}
		if (action.kind === 'file.read') { return this.read(action.path); }
		if (action.kind === 'file.write') { return this.write(action.path, action.content); }
		return Promise.reject(new Error('workspace executor does not handle this action kind'));
	}

	stop(): void {
		this.stopped = true;
		for (const child of this.children) {
			terminate(child);
		}
	}

	private command(action: Extract<ContractAction, { readonly kind: 'command' }>): Promise<ActionOutcome> {
		return new Promise((resolveResult, reject) => {
			const child = spawn(action.executable, [...action.args], {
				cwd: this.workspacePath, env: this.environment, shell: false, windowsHide: true,
				detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
			});
			this.children.add(child);
			const stdout: Buffer[] = [];
			const stderr: Buffer[] = [];
			const outputLimit = Math.min(MAX_ACTION_OUTPUT_BYTES, this.limits.maxOutputBytes ?? MAX_ACTION_OUTPUT_BYTES);
			let remaining = outputLimit;
			let truncated = false;
			let timedOut = false;
			const capture = (chunks: Buffer[], chunk: Buffer): void => {
				if (remaining === 0) {
					truncated = true;
					return;
				}
				const retained = Buffer.from(chunk.subarray(0, remaining));
				chunks.push(retained);
				remaining -= retained.length;
				truncated ||= retained.length < chunk.length;
			};
			child.stdout.on('data', (chunk: Buffer) => capture(stdout, chunk));
			child.stderr.on('data', (chunk: Buffer) => capture(stderr, chunk));
			const deadline = setTimeout(() => { timedOut = true; terminate(child); }, action.timeoutMs);
			deadline.unref();
			const cleanup = (): void => { clearTimeout(deadline); this.children.delete(child); };
			child.once('error', (error) => { cleanup(); reject(error); });
			child.once('close', (exitCode, signal) => {
				cleanup();
				const rawStdout = Buffer.concat(stdout).toString('utf8');
				const rawStderr = Buffer.concat(stderr).toString('utf8');
				const output = boundedUtf8(rawStdout, outputLimit);
				const errorOutput = boundedUtf8(rawStderr, Math.max(0, outputLimit - Buffer.byteLength(output)));
				resolveResult(Object.freeze({
					success: exitCode === 0 && signal === null && !timedOut,
					result: Object.freeze({ exitCode, signal, timedOut, truncated: truncated || output !== rawStdout || errorOutput !== rawStderr, stdout: output, stderr: errorOutput }),
				}));
			});
		});
	}

	private async filePath(path: string): Promise<string> {
		const normalized = path.replace(/\\/g, '/');
		if (normalized.includes('\0') || /^[a-z]:/i.test(normalized) || isAbsolute(normalized) || normalized.split('/').includes('..')) {
			throw new Error('file path must be workspace-relative without traversal');
		}
		const target = resolve(this.workspacePath, normalized);
		if (!isWithin(this.workspacePath, target)) {
			throw new Error('file path must remain inside the workspace');
		}
		const parent = await realpath(dirname(target));
		if (parent !== dirname(target)) {
			throw new Error('symlinked parent directories are not permitted for supervised file access');
		}
		return target;
	}

	private async read(path: string): Promise<ActionOutcome> {
		const target = await this.filePath(path);
		const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const metadata = await handle.stat();
			if (!metadata.isFile() || metadata.nlink !== 1 || metadata.size > MAX_ACTION_FILE_BYTES) {
				throw new Error('supervised reads require a regular, unlinked file within the size limit');
			}
			const limit = Math.min(MAX_ACTION_FILE_BYTES, this.limits.maxOutputBytes ?? MAX_ACTION_FILE_BYTES);
			const buffer = Buffer.alloc(limit + 1);
			const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
			if (bytesRead > MAX_ACTION_FILE_BYTES) {
				throw new Error('file exceeds the supervised read size limit');
			}
			const raw = buffer.subarray(0, Math.min(bytesRead, limit)).toString('utf8');
			const content = boundedUtf8(raw, limit);
			return Object.freeze({ success: true, result: Object.freeze({ path, content, bytesRead: Math.min(bytesRead, limit), truncated: bytesRead > limit || content !== raw }) });
		} finally {
			await handle.close();
		}
	}

	private async write(path: string, content: string): Promise<ActionOutcome> {
		if (Buffer.byteLength(content) > MAX_ACTION_FILE_BYTES) {
			throw new Error('content exceeds the supervised write size limit');
		}
		const target = await this.filePath(path);
		const existing = await lstat(target).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== 'ENOENT') { throw error; }
			return undefined;
		});
		const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
		try {
			const metadata = await handle.stat();
			if (!metadata.isFile() || metadata.nlink !== 1) {
				throw new Error('supervised writes require a regular file without hardlinks');
			}
			await handle.truncate(0);
			await handle.writeFile(content, 'utf8');
			return Object.freeze({ success: true, result: Object.freeze({ path, operation: existing === undefined ? 'created' : 'modified', bytesWritten: Buffer.byteLength(content) }) });
		} finally {
			await handle.close();
		}
	}
}
