import { createServer, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { HealthResponse } from '@agent-contract-lab/event-schema';

import { buildHealthResponse, createIdentity } from './health';
import { route } from './router';
import { SUPERVISOR_VERSION } from './version';

/** Hosts the supervisor may bind to. Never a routable remote address. */
export const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', '::1']);

export interface StartOptions {
	readonly version?: string;
	readonly host?: string;
	/** Port to bind; 0 selects an ephemeral port (used by tests). */
	readonly port?: number;
	readonly now?: () => Date;
}

export interface RunningSupervisor {
	readonly url: string;
	readonly host: string;
	readonly port: number;
	readonly instanceId: string;
	close(): Promise<void>;
}

export function createRequestListener(health: HealthResponse): RequestListener {
	return (req, res) => {
		// Discard any request body so the socket can be reused.
		req.resume();

		const method = req.method ?? 'GET';
		let pathname = '/';
		try {
			pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
		} catch {
			pathname = '/';
		}

		const result = route(method, pathname, { health });
		const payload = JSON.stringify(result.body);
		res.writeHead(result.statusCode, {
			'content-type': 'application/json; charset=utf-8',
			'content-length': Buffer.byteLength(payload),
		});
		if (method === 'HEAD') {
			res.end();
		} else {
			res.end(payload);
		}
	};
}

function formatUrl(host: string, port: number): string {
	const displayHost = host === '::1' ? '[::1]' : host;
	return `http://${displayHost}:${port}`;
}

export async function startSupervisor(options: StartOptions = {}): Promise<RunningSupervisor> {
	const host = options.host ?? '127.0.0.1';
	if (!LOOPBACK_HOSTS.has(host)) {
		throw new Error(`refusing to bind supervisor to non-loopback host ${host}`);
	}

	const identity = createIdentity(options.version ?? SUPERVISOR_VERSION, options.now?.() ?? new Date());
	const health = buildHealthResponse(identity);
	const server: Server = createServer(createRequestListener(health));

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error): void => {
			server.removeListener('error', onError);
			reject(error);
		};
		server.once('error', onError);
		server.listen(options.port ?? 0, host, () => {
			server.removeListener('error', onError);
			resolve();
		});
	});

	const address = server.address() as AddressInfo;
	return {
		url: formatUrl(host, address.port),
		host,
		port: address.port,
		instanceId: identity.instanceId,
		close: () =>
			new Promise<void>((resolve, reject) => {
				if (!server.listening) {
					resolve();
					return;
				}
				server.close((error) => {
					if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') {
						reject(error);
					} else {
						resolve();
					}
				});
			}),
	};
}
