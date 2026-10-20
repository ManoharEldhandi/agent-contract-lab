import type { ContractActionResult, SupervisorAction } from '@agent-contract-lab/event-schema';

import type { ActionTelemetry } from './index';

export interface ModelLoggerSpan {
	addEvent(name: string): void;
}

export interface ModelLoggerTrace {
	trace<Result>(options: {
		readonly name: string;
		readonly kind: 'tool';
		readonly attributes: Readonly<Record<string, string>>;
	}, operation: (span?: ModelLoggerSpan) => Promise<Result>): Promise<Result>;
}

export interface ModelLoggerTelemetryOptions {
	readonly onTelemetryError?: (error: unknown) => void;
}

export class ModelLoggerTelemetry implements ActionTelemetry {
	constructor(private readonly logger: ModelLoggerTrace, private readonly options: ModelLoggerTelemetryOptions = {}) {}

	observe(action: SupervisorAction, operation: () => Promise<ContractActionResult>): Promise<ContractActionResult> {
		let execution: Promise<ContractActionResult> | undefined;
		const runOnce = (): Promise<ContractActionResult> => execution ??= Promise.resolve().then(operation);
		try {
			const telemetry = this.logger.trace({
				name: `agent-contract.${action.kind}`, kind: 'tool',
				attributes: { 'tool.name': action.kind },
			}, async (span) => {
				const result = await runOnce();
				span?.addEvent(`agent-contract.action.${result.status}`);
				span?.addEvent(result.decision.allowed ? 'agent-contract.policy.allowed' : 'agent-contract.policy.refused');
				return result;
			});
			void telemetry.catch((error: unknown) => {
				void runOnce().then(
					() => this.report(error),
					(operationError: unknown) => { if (operationError !== error) { this.report(error); } },
				);
			});
		} catch (error) {
			this.report(error);
		}
		return runOnce();
	}

	private report(error: unknown): void {
		try {
			this.options.onTelemetryError?.(error);
		} catch {}
	}
}
