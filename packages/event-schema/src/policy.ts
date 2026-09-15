import type { UnknownReason } from './evidence';

export const POLICY_RESULTS = ['pass', 'fail', 'unknown'] as const;
export type PolicyResult = (typeof POLICY_RESULTS)[number];

export interface PolicyDecision {
	readonly schemaVersion: number;
	readonly decisionId: string;
	readonly sessionId: string;
	readonly contractName: string;
	readonly ruleId: string;
	readonly result: PolicyResult;
	readonly message: string;
	readonly evidenceEventIds: readonly string[];
	readonly evaluatedAt: string;
	readonly unknownReason?: UnknownReason;
}

export function isPolicyResult(value: unknown): value is PolicyResult {
	return typeof value === 'string' && (POLICY_RESULTS as readonly string[]).includes(value);
}