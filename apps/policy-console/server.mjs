import { createServer } from 'node:http';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { startSupervisor } from '@agent-contract-lab/local-supervisor';

import { PolicyConsoleController } from './controller.mjs';
import { createInventoryFixture } from './fixture.mjs';

const require = createRequire(import.meta.url);
const assets = new Map([
	[
		'/app.js',
		[
			new URL('./public/app.js', import.meta.url),
			'text/javascript; charset=utf-8',
		],
	],
	[
		'/style.css',
		[new URL('./public/style.css', import.meta.url), 'text/css; charset=utf-8'],
	],
	[
		'/assets/icons.js',
		[
			join(dirname(require.resolve('lucide')), '../umd/lucide.js'),
			'text/javascript; charset=utf-8',
		],
	],
	...['400', '500', '600'].map((weight) => [
		`/assets/plex-sans-${weight}.woff2`,
		[
			require.resolve(
				`@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-${weight}-normal.woff2`,
			),
			'font/woff2',
		],
	]),
	[
		'/assets/plex-mono.woff2',
		[
			require.resolve('@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2'),
			'font/woff2',
		],
	],
]);

function send(
	response,
	statusCode,
	payload,
	contentType = 'application/json; charset=utf-8',
) {
	const body =
		Buffer.isBuffer(payload) || typeof payload === 'string'
			? payload
			: JSON.stringify(payload);
	response.writeHead(statusCode, {
		'content-type': contentType,
		'content-length': Buffer.byteLength(body),
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
		'cross-origin-resource-policy': 'same-origin',
		'content-security-policy':
			"default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
	});
	response.end(body);
}

async function jsonBody(request) {
	if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
		throw new Error('Requests must use application/json.');
	}
	const chunks = [];
	let size = 0;
	for await (const chunk of request) {
		size += chunk.length;
		if (size > 64 * 1024) {
			throw new Error('Console request exceeds 64 KiB.');
		}
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function listen(server, port) {
	await new Promise((resolveListen, reject) => {
		const onError = (error) => {
			server.removeListener('listening', onListening);
			reject(error);
		};
		const onListening = () => {
			server.removeListener('error', onError);
			resolveListen();
		};
		server.once('error', onError);
		server.once('listening', onListening);
		server.listen(port, '127.0.0.1');
	});
}

export async function startPolicyConsole(options = {}) {
	const directory = await realpath(
		await mkdtemp(join(tmpdir(), 'agent-policy-console-')),
	);
	let supervisor;
	let controller;
	let server;
	try {
		const workspacePath = await createInventoryFixture(directory);
		supervisor = await startSupervisor({
			port: 0,
			dataDirectory: join(directory, 'supervisor'),
			modelProvider: options.modelProvider,
		});
		controller = new PolicyConsoleController(supervisor, workspacePath, {
			model:
				options.model ??
				process.env.AGENT_CONTRACT_MODEL_NAME ??
				'review-model',
			modelConfigured:
				options.modelProvider !== undefined ||
				Boolean(process.env.AGENT_CONTRACT_MODEL_URL),
		});
		await controller.ready();
		let origin = '';
		server = createServer((request, response) => {
			void (async () => {
				const expectedHost = new URL(origin).host;
				if (
					request.headers.host !== expectedHost ||
					request.headers['sec-fetch-site'] === 'cross-site' ||
					(request.headers.origin !== undefined &&
						request.headers.origin !== origin)
				) {
					request.resume();
					send(response, 403, {
						error: 'Cross-origin or invalid Host request refused.',
					});
					return;
				}
				const pathname = new URL(request.url ?? '/', origin).pathname;
				if (request.method === 'GET' && pathname === '/') {
					send(
						response,
						200,
						await readFile(new URL('./public/index.html', import.meta.url)),
						'text/html; charset=utf-8',
					);
					return;
				}
				if (request.method === 'GET' && assets.has(pathname)) {
					const [path, type] = assets.get(pathname);
					send(response, 200, await readFile(path), type);
					return;
				}
				if (request.method === 'GET' && pathname === '/api/state') {
					send(response, 200, await controller.snapshot());
					return;
				}
				if (request.method === 'GET' && pathname === '/api/export') {
					response.setHeader(
						'content-disposition',
						`attachment; filename="agent-contract-${controller.session.record.sessionId}.json"`,
					);
					send(response, 200, await controller.export());
					return;
				}
				if (request.method !== 'POST' || !pathname.startsWith('/api/')) {
					request.resume();
					send(response, 404, { error: 'Not found.' });
					return;
				}
				if (request.headers.origin !== origin) {
					request.resume();
					send(response, 403, { error: 'A same-origin request is required.' });
					return;
				}
				const body = await jsonBody(request);
				let result;
				switch (pathname) {
					case '/api/run':
						result = await controller.start(body.mode);
						break;
					case '/api/stop':
						await controller.stop();
						result = { stopped: true };
						break;
					case '/api/reset':
						result = await controller.reset();
						break;
					case '/api/action':
						result = await controller.perform(body);
						break;
					case '/api/phase':
						result = await controller.transition(body.phase);
						break;
					case '/api/complete':
						result = await controller.complete();
						break;
					case '/api/policy':
						result = controller.setPolicy(body.yaml);
						break;
					case '/api/policy/validate':
						result = controller.validatePolicy(body.yaml);
						break;
					case '/api/knowledge':
						result = controller.search(body.query);
						break;
					default:
						send(response, 404, { error: 'Not found.' });
						return;
				}
				send(response, 200, result);
			})().catch((error) => {
				if (!response.headersSent) {
					send(response, 400, {
						error: error instanceof Error ? error.message : String(error),
					});
				}
			});
		});
		server.requestTimeout = 40_000;
		server.headersTimeout = 5_000;
		const preferredPort =
			options.port ?? Number(process.env.AGENT_CONTRACT_CONSOLE_PORT ?? 43280);
		try {
			await listen(server, preferredPort);
		} catch (error) {
			if (error.code !== 'EADDRINUSE' || options.port !== undefined) {
				throw error;
			}
			await listen(server, 0);
		}
		origin = `http://127.0.0.1:${server.address().port}`;
		let closed;
		return {
			url: origin,
			close: () =>
				(closed ??= (async () => {
					server.closeAllConnections();
					await new Promise((resolveClose) => server.close(resolveClose));
					await controller.close();
					await supervisor.close();
					await rm(directory, { recursive: true, force: true });
				})()),
		};
	} catch (error) {
		server?.closeAllConnections();
		server?.close();
		await controller?.close();
		await supervisor?.close();
		await rm(directory, { recursive: true, force: true });
		throw error;
	}
}

if (
	process.argv[1] !== undefined &&
	pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
	const app = await startPolicyConsole();
	console.log(`Agent Contract Lab policy console: ${app.url}`);
	console.log(
		'Fixture agent is available. Connected model credentials are read only from the server environment.',
	);
	for (const signal of ['SIGINT', 'SIGTERM']) {
		process.once(signal, () => {
			void app.close().then(() => process.exit(0));
		});
	}
}
