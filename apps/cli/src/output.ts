import type { EnvRecord } from './constants';

export interface OutputStream {
	write(chunk: string): unknown;
	readonly isTTY?: boolean;
}

export type OutputFormat = 'pretty' | 'json' | 'jsonl';

/**
 * Resolves color usage. `NO_COLOR` (any value) disables; `FORCE_COLOR` enables;
 * otherwise color follows whether the stream is a TTY.
 */
export function resolveColor(isTTY: boolean, env: EnvRecord): boolean {
	if (env.NO_COLOR !== undefined) {
		return false;
	}
	if (env.FORCE_COLOR !== undefined) {
		return true;
	}
	return isTTY;
}

/** Default output is `pretty` only for an interactive TTY; otherwise `json`. */
export function resolveFormat(requested: string | undefined, isTTY: boolean): OutputFormat | undefined {
	if (requested === undefined) {
		return isTTY ? 'pretty' : 'json';
	}
	if (requested === 'pretty' || requested === 'json' || requested === 'jsonl') {
		return requested;
	}
	return undefined;
}

const COLORS = {
	reset: '\u001b[0m',
	bold: '\u001b[1m',
	red: '\u001b[31m',
	green: '\u001b[32m',
	yellow: '\u001b[33m',
	dim: '\u001b[2m',
} as const;

export type ColorName = Exclude<keyof typeof COLORS, 'reset'>;

export function colorize(text: string, color: ColorName, enabled: boolean): string {
	if (!enabled) {
		return text;
	}
	return `${COLORS[color]}${text}${COLORS.reset}`;
}

export function writeLine(stream: OutputStream, text = ''): void {
	stream.write(`${text}\n`);
}

/** Serializes a versioned result object for `--format json`. */
export function writeJson(stream: OutputStream, value: unknown): void {
	stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Emits one compact JSON object per line for streaming and command pipelines. */
export function writeJsonLine(stream: OutputStream, value: unknown): void {
	stream.write(`${JSON.stringify(value)}\n`);
}
