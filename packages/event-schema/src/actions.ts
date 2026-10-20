import type { JsonObject } from './events';

export type SupervisorAction =
	| { readonly kind: 'command'; readonly executable: string; readonly args?: readonly string[]; readonly timeoutMs?: number }
	| { readonly kind: 'file.read'; readonly path: string }
	| { readonly kind: 'file.write'; readonly path: string; readonly content: string }
	| { readonly kind: 'knowledge.search'; readonly query: string; readonly limit?: number }
	| { readonly kind: 'model.call'; readonly model: string; readonly prompt: string; readonly maxOutputTokens: number; readonly knowledgeQuery?: string; readonly timeoutMs?: number };

export interface KnowledgeDocumentInput {
	readonly source: string;
	readonly title: string;
	readonly content: string;
}

export interface ActionDecision {
	readonly allowed: boolean;
	readonly ruleIds: readonly string[];
	readonly message: string;
}

export interface ContractActionResult {
	readonly correlationId: string;
	readonly status: 'completed' | 'failed' | 'blocked';
	readonly success: boolean;
	readonly decision: ActionDecision;
	readonly result: JsonObject;
}
