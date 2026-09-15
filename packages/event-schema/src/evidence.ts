/** Evidence grades and unknown-reason codes from the evidence model. */

export const EVIDENCE_GRADES = [
	'observed-native',
	'observed-boundary',
	'computed',
	'model-declared',
	'unknown',
] as const;

export type EvidenceGrade = (typeof EVIDENCE_GRADES)[number];

export function isEvidenceGrade(value: unknown): value is EvidenceGrade {
	return typeof value === 'string' && (EVIDENCE_GRADES as readonly string[]).includes(value);
}

/**
 * Stable reasons an assertion or query result is `unknown`. An unknown result
 * always carries at least one of these; it never disguises an unimplemented
 * evaluator feature.
 */
export const UNKNOWN_REASONS = [
	'unsupported-capability',
	'not-observed',
	'redacted',
	'truncated',
	'not-retained',
	'adapter-error',
	'integrity-failure',
	'timeout',
	'ambiguous',
] as const;

export type UnknownReason = (typeof UNKNOWN_REASONS)[number];

export function isUnknownReason(value: unknown): value is UnknownReason {
	return typeof value === 'string' && (UNKNOWN_REASONS as readonly string[]).includes(value);
}
