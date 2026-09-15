/** Stable process exit codes shared by every CLI command. */
export const ExitCode = {
	Ok: 0,
	FindingFailed: 2,
	Unknown: 3,
	InvalidInvocation: 4,
	Unavailable: 5,
	Internal: 6,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export const CLI_VERSION = '0.1.0' as const;

export const DEFAULT_SUPERVISOR_URL = 'http://127.0.0.1:43199' as const;

/** Portable environment map (process.env is assignable to this). */
export type EnvRecord = Record<string, string | undefined>;
