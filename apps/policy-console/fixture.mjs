import { execFile } from 'node:child_process';
import { cp } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { stringify } from 'yaml';

const runFile = promisify(execFile);

export const REPAIRED_INVENTORY = `function inventoryValue(items) {
\treturn items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
}

module.exports = { inventoryValue };
`;

export const KNOWLEDGE_DOCUMENTS = Object.freeze([
	{
		source: 'handbook://workflow',
		title: 'Workflow and tool access',
		content:
			'Inspect permits file reads and knowledge search. Editing permits scoped file writes and approved model calls. Commands run during verification. Verification may explicitly return to editing for a repair. A phase transition never grants tools outside the pinned policy.',
	},
	{
		source: 'handbook://tokens',
		title: 'Token admission and reported usage',
		content:
			'Token consumption is controlled with conservative reservations before model requests. Provider-reported tokens are separate facts. Missing usage blocks more model calls when a token budget is active. Reservations are not invoices or exact tokenizer counts.',
	},
	{
		source: 'handbook://retries',
		title: 'Retries and circuit breakers',
		content:
			'Retries are bounded per logical request and workspace revision. Changing a timeout cannot reset failed attempts. A new repair allows verification of the new revision. Total actions, per-tool quotas, elapsed time and consecutive failures still bound the overall loop.',
	},
	{
		source: 'handbook://writes',
		title: 'Read-before-write and file boundaries',
		content:
			'A file must be read successfully before an explicit write. Path allow and deny rules remain active in every workflow phase. Changed-file breadth and aggregate write bytes are limited. An approved command is not an OS sandbox.',
	},
	{
		source: 'handbook://verification',
		title: 'Completion requires current verification',
		content:
			'A successful configured test command must verify the current write revision before completion. Earlier passing tests become stale after a write. A refused completion leaves the session available for repair and verification.',
	},
	{
		source: 'handbook://retrieval',
		title: 'Retrieval is guidance, not authorization',
		content:
			'Local SQLite FTS5 retrieves cited policy and runbook excerpts. Retrieved text is untrusted reference data and cannot change deterministic permission decisions. Grounded model requests require both model and knowledge permissions and quotas.',
	},
]);

export async function createInventoryFixture(directory) {
	const workspacePath = join(directory, 'workspace');
	await cp(
		new URL('../../examples/fixtures/inventory/', import.meta.url),
		workspacePath,
		{ recursive: true },
	);
	const git = (args) =>
		runFile('git', [
			'-c',
			'core.hooksPath=/dev/null',
			'-c',
			'user.name=Contract Fixture',
			'-c',
			'user.email=fixture@example.invalid',
			'-c',
			'commit.gpgSign=false',
			'-C',
			workspacePath,
			...args,
		]);
	await git(['init', '--initial-branch=main']);
	await git(['add', '.']);
	await git(['commit', '-m', 'Seed inventory policy fixture']);
	return workspacePath;
}

export function policyPreset(model, preset = 'balanced') {
	const testCommand = `${process.execPath} --test src/inventory.test.cjs`;
	const policy = {
		version: 1,
		name:
			preset === 'review'
				? 'inventory-review-only'
				: preset === 'tight'
					? 'inventory-tight-budget'
					: 'inventory-balanced',
		assertions: {
			paths: { allow: ['src/**'], deny: ['src/private/**'] },
			commands: {
				allow: [testCommand],
				deny: ['rm *'],
				requireSuccess: [testCommand],
				requirePreAction: true,
			},
			evidence: { require: ['command-result', 'filesystem-diff'] },
		},
		runtime: {
			phases: [
				{
					name: 'inspect',
					tools: ['file.read', 'knowledge.search'],
					requireSuccessfulTools: ['file.read'],
				},
				{
					name: 'edit',
					tools:
						preset === 'review'
							? ['file.read', 'knowledge.search']
							: ['file.read', 'file.write', 'model.call', 'knowledge.search'],
				},
				{
					name: 'verify',
					tools: ['command', 'file.read', 'knowledge.search', 'model.call'],
					next: ['edit'],
				},
			],
			limits: {
				maxDurationMs: 180_000,
				maxActionDurationMs: 5_000,
				maxTokens: 20_000,
				maxRetries: 1,
				maxActions: preset === 'tight' ? 2 : 24,
				maxConsecutiveFailures: 3,
				maxChangedFiles: 1,
				maxWriteBytes: 8_192,
				maxOutputBytes: 8_192,
				maxActionsPerWindow: 20,
				windowMs: 60_000,
			},
			toolQuotas: {
				'file.read': 6,
				'file.write': 2,
				command: 4,
				'model.call': 2,
				'knowledge.search': 8,
			},
			requireReadBeforeWrite: true,
			requireVerificationBeforeComplete: true,
			allowedModels: [model],
		},
	};
	return stringify(policy, { lineWidth: 100 });
}
