export interface ParsedArgs {
	readonly positionals: string[];
	readonly options: Record<string, string | boolean>;
}

/**
 * Minimal, dependency-free argument parser.
 *
 * Supports `--key value`, `--key=value`, boolean `--flag`, short `-f`, and `--`
 * to stop option parsing. Values that look like the next option are not consumed.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
	const positionals: string[] = [];
	const options: Record<string, string | boolean> = {};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined) {
			continue;
		}

		if (arg === '--') {
			positionals.push(...argv.slice(index + 1));
			break;
		}

		if (arg.startsWith('--')) {
			const body = arg.slice(2);
			const equals = body.indexOf('=');
			if (equals >= 0) {
				options[body.slice(0, equals)] = body.slice(equals + 1);
				continue;
			}
			const next = argv[index + 1];
			if (next !== undefined && !next.startsWith('-')) {
				options[body] = next;
				index += 1;
			} else {
				options[body] = true;
			}
			continue;
		}

		if (arg.startsWith('-') && arg.length > 1) {
			options[arg.slice(1)] = true;
			continue;
		}

		positionals.push(arg);
	}

	return { positionals, options };
}

export function optionString(options: ParsedArgs['options'], key: string): string | undefined {
	const value = options[key];
	return typeof value === 'string' ? value : undefined;
}

export function optionFlag(options: ParsedArgs['options'], ...keys: string[]): boolean {
	return keys.some((key) => options[key] === true || options[key] === 'true');
}
