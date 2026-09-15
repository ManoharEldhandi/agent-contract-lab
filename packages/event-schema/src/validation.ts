/**
 * Boundary validation primitives.
 *
 * Every value that crosses a process boundary (HTTP body, adapter message,
 * stored record) is validated with these helpers so malformed input becomes a
 * structured {@link ParseResult} instead of an unchecked cast.
 */

export interface ParseIssue {
	readonly path: string;
	readonly message: string;
}

export type ParseResult<T> =
	| { readonly ok: true; readonly value: T }
	| { readonly ok: false; readonly issues: readonly ParseIssue[] };

export function ok<T>(value: T): ParseResult<T> {
	return { ok: true, value };
}

export function err<T = never>(path: string, message: string): ParseResult<T> {
	return { ok: false, issues: [{ path, message }] };
}

export function errs<T = never>(issues: readonly ParseIssue[]): ParseResult<T> {
	return { ok: false, issues };
}

/** Push the issues of any failed results into a shared sink. */
export function collectIssues(sink: ParseIssue[], ...results: readonly ParseResult<unknown>[]): void {
	for (const result of results) {
		if (!result.ok) {
			sink.push(...result.issues);
		}
	}
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A short, safe description of a value's runtime kind for error messages. */
export function describe(value: unknown): string {
	if (value === null) {
		return 'null';
	}
	if (Array.isArray(value)) {
		return 'array';
	}
	return typeof value;
}

export function joinPath(base: string, key: string | number): string {
	if (typeof key === 'number') {
		return `${base}[${key}]`;
	}
	return base === '' ? key : `${base}.${key}`;
}

export function requireString(obj: Record<string, unknown>, key: string, path: string): ParseResult<string> {
	const value = obj[key];
	if (typeof value !== 'string') {
		return err(joinPath(path, key), `expected string, received ${describe(value)}`);
	}
	return ok(value);
}

export function requireNonEmptyString(obj: Record<string, unknown>, key: string, path: string): ParseResult<string> {
	const result = requireString(obj, key, path);
	if (!result.ok) {
		return result;
	}
	if (result.value.trim() === '') {
		return err(joinPath(path, key), 'expected non-empty string');
	}
	return result;
}

export function requireInteger(obj: Record<string, unknown>, key: string, path: string): ParseResult<number> {
	const value = obj[key];
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		return err(joinPath(path, key), `expected integer, received ${describe(value)}`);
	}
	return ok(value);
}

export function requireBoolean(obj: Record<string, unknown>, key: string, path: string): ParseResult<boolean> {
	const value = obj[key];
	if (typeof value !== 'boolean') {
		return err(joinPath(path, key), `expected boolean, received ${describe(value)}`);
	}
	return ok(value);
}

export function requireRecord(obj: Record<string, unknown>, key: string, path: string): ParseResult<Record<string, unknown>> {
	const value = obj[key];
	if (!isRecord(value)) {
		return err(joinPath(path, key), `expected object, received ${describe(value)}`);
	}
	return ok(value);
}

export function requireStringArray(obj: Record<string, unknown>, key: string, path: string): ParseResult<string[]> {
	const value = obj[key];
	const fieldPath = joinPath(path, key);
	if (!Array.isArray(value)) {
		return err(fieldPath, `expected array of strings, received ${describe(value)}`);
	}
	const issues: ParseIssue[] = [];
	const out: string[] = [];
	value.forEach((element, index) => {
		if (typeof element !== 'string') {
			issues.push({ path: joinPath(fieldPath, index), message: `expected string, received ${describe(element)}` });
		} else {
			out.push(element);
		}
	});
	if (issues.length > 0) {
		return errs(issues);
	}
	return ok(out);
}

export function requireEnum<T extends string>(
	obj: Record<string, unknown>,
	key: string,
	path: string,
	allowed: readonly T[],
): ParseResult<T> {
	const value = obj[key];
	if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
		return err(joinPath(path, key), `expected one of [${allowed.join(', ')}], received ${describe(value)}`);
	}
	return ok(value as T);
}
