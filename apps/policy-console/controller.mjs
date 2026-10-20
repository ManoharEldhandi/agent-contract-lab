import { LocalSupervisorClient } from '@agent-contract-lab/adapter-sdk';
import {
	LocalKnowledgeIndex,
	redactJson,
	redactText,
} from '@agent-contract-lab/local-supervisor';
import { parseContract } from '@agent-contract-lab/policy-engine';
import { parse } from 'yaml';

import {
	KNOWLEDGE_DOCUMENTS,
	REPAIRED_INVENTORY,
	policyPreset,
} from './fixture.mjs';

function validatedPolicy(yaml) {
	if (typeof yaml !== 'string' || Buffer.byteLength(yaml) > 64 * 1024) {
		throw new Error('Policy YAML must be no larger than 64 KiB.');
	}
	const result = parseContract(parse(yaml, { maxAliasCount: 0 }));
	if (!result.ok) {
		throw new Error(result.issues.join('; '));
	}
	return result.contract;
}

function requireStatus(action, expected) {
	if (action.status !== expected) {
		throw new Error(
			`Expected ${expected}; received ${action.status}: ${action.decision.message}`,
		);
	}
	return action;
}

export class PolicyConsoleController {
	constructor(supervisor, workspacePath, options = {}) {
		this.supervisor = supervisor;
		this.workspacePath = workspacePath;
		this.model = options.model ?? 'review-model';
		this.modelConfigured = options.modelConfigured ?? false;
		this.client = new LocalSupervisorClient({
			supervisorUrl: supervisor.url,
			token: supervisor.authToken,
		});
		this.policyYaml = policyPreset(this.model);
		this.running = false;
		this.stopping = false;
		this.mode = 'fixture';
		this.error = null;
	}

	async api(pathname, method = 'GET', body) {
		const response = await fetch(new URL(pathname, this.supervisor.url), {
			method,
			redirect: 'error',
			headers: {
				'content-type': 'application/json',
				'x-agent-contract-token': this.supervisor.authToken,
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) }),
			signal: AbortSignal.timeout(35_000),
		});
		const result = await response.json();
		if (!response.ok) {
			throw new Error(
				result.error?.message ?? `Supervisor returned HTTP ${response.status}`,
			);
		}
		return result;
	}

	async ready() {
		await this.api('/v1/workspaces/trust', 'POST', {
			workspacePath: this.workspacePath,
		});
		await this.newSession();
	}

	async newSession() {
		if (this.session !== undefined) {
			const current = await this.api(
				`/v1/sessions/${this.session.record.sessionId}`,
			);
			if (current.session.state === 'running') {
				await this.session.complete('interrupted');
			}
		}
		this.activePolicy = validatedPolicy(this.policyYaml);
		this.session = await this.client.startContractSession({
			workspacePath: this.workspacePath,
			actor: 'policy-console',
			title: 'Inventory repair',
			contractYaml: this.policyYaml,
			knowledgeDocuments: KNOWLEDGE_DOCUMENTS,
		});
		this.knowledge?.close();
		this.knowledge = new LocalKnowledgeIndex([
			{
				source: `policy://${this.activePolicy.name}`,
				title: `Active policy: ${this.activePolicy.name}`,
				content: JSON.stringify(
					redactJson(JSON.parse(JSON.stringify(this.activePolicy))).value,
					null,
					2,
				).slice(0, 16_384),
				origin: 'attached-policy',
			},
			...KNOWLEDGE_DOCUMENTS.map((document) => ({
				...document,
				origin: 'user-supplied',
			})),
		]);
	}

	async snapshot() {
		const sessionId = this.session.record.sessionId;
		const [session, events, runtime] = await Promise.all([
			this.api(`/v1/sessions/${sessionId}`),
			this.client.getEvents(sessionId),
			this.session.getRuntime(),
		]);
		return {
			project: 'Depot Inventory',
			session: session.session,
			events: events.events,
			runtime,
			policyYaml: this.policyYaml,
			activeContractName: this.activePolicy.name,
			profiles: {
				balanced: policyPreset(this.model),
				review: policyPreset(this.model, 'review'),
				tight: policyPreset(this.model, 'tight'),
			},
			model: { configured: this.modelConfigured, name: this.model },
			run: { running: this.running, mode: this.mode, error: this.error },
			testCommand: {
				kind: 'command',
				executable: process.execPath,
				args: ['--test', 'src/inventory.test.cjs'],
			},
		};
	}

	setPolicy(yaml) {
		const contract = validatedPolicy(yaml);
		this.policyYaml = yaml;
		return { name: contract.name, appliesTo: 'next-session' };
	}

	validatePolicy(yaml) {
		return { name: validatedPolicy(yaml).name, valid: true };
	}

	search(query) {
		if (typeof query !== 'string' || query.trim() === '') {
			throw new Error('Enter a knowledge question.');
		}
		return this.knowledge.search(query, 4);
	}

	async perform(action) {
		if (this.running) {
			throw new Error('An automated run is active.');
		}
		return this.session.executeAction(action);
	}

	async transition(phase) {
		if (this.running) {
			throw new Error('An automated run is active.');
		}
		return this.session.transitionPhase(phase);
	}

	async complete() {
		if (this.running) {
			throw new Error('An automated run is active.');
		}
		return this.session.complete();
	}

	async start(mode = 'fixture') {
		if (this.running) {
			throw new Error('A run is already active.');
		}
		if (
			!['fixture', 'model'].includes(mode) ||
			(mode === 'model' && !this.modelConfigured)
		) {
			throw new Error('No connected model is configured.');
		}
		this.running = true;
		this.stopping = false;
		this.error = null;
		this.mode = mode;
		this.initializing = this.newSession();
		try {
			await this.initializing;
		} catch (error) {
			this.running = false;
			throw error;
		} finally {
			this.initializing = undefined;
		}
		if (this.stopping) {
			this.running = false;
			return { sessionId: this.session.record.sessionId };
		}
		this.job = this.runScenario(mode)
			.catch(async (error) => {
				if (!this.stopping) {
					this.error = redactText(
						error instanceof Error ? error.message : String(error),
					).value;
					try {
						await this.session.complete('failed');
					} catch {}
				}
			})
			.finally(() => {
				this.running = false;
			});
		return { sessionId: this.session.record.sessionId };
	}

	async runScenario(mode) {
		const action = async (request, expected) => {
			if (this.stopping) {
				throw new Error('Run stopped.');
			}
			return requireStatus(await this.session.executeAction(request), expected);
		};
		const transition = async (phase) => {
			if (this.stopping) {
				throw new Error('Run stopped.');
			}
			const decision = await this.session.transitionPhase(phase);
			if (!decision.allowed) {
				throw new Error(decision.message);
			}
		};
		await this.session.userMessage(
			'Repair inventory totals. Keep edits in src/ and verify the current revision.',
		);
		await action(
			{
				kind: 'knowledge.search',
				query: 'workflow tool access read before write',
			},
			'completed',
		);
		await action(
			{ kind: 'file.write', path: 'src/inventory.cjs', content: 'Too early.' },
			'blocked',
		);
		await action(
			{
				kind: 'command',
				executable: process.execPath,
				args: ['--test', 'src/inventory.test.cjs'],
			},
			'blocked',
		);
		const original = await action(
			{ kind: 'file.read', path: 'src/inventory.cjs' },
			'completed',
		);
		await transition('edit');
		await action(
			{ kind: 'file.write', path: 'README.md', content: 'Out of scope.' },
			'blocked',
		);
		await action(
			{
				kind: 'file.write',
				path: 'src/inventory.cjs',
				content: original.result.content,
			},
			'completed',
		);
		await transition('verify');
		const test = {
			kind: 'command',
			executable: process.execPath,
			args: ['--test', 'src/inventory.test.cjs'],
		};
		await action(test, 'failed');
		await action(test, 'failed');
		await action(test, 'blocked');
		try {
			await this.session.complete();
			throw new Error('Unverified completion was incorrectly accepted.');
		} catch (error) {
			if (!String(error).includes('runtime.verification')) {
				throw error;
			}
		}
		await transition('edit');
		let content = REPAIRED_INVENTORY;
		if (mode === 'model') {
			const response = await action(
				{
					kind: 'model.call',
					model: this.model,
					knowledgeQuery: 'inventory quantity read write verification',
					maxOutputTokens: 1_200,
					prompt: `Fix the quantity calculation. Return only JSON with exactly path and content fields. Path must be src/inventory.cjs. Current source:\n${original.result.content}`,
				},
				'completed',
			);
			const repair = JSON.parse(response.result.text);
			if (
				repair.path !== 'src/inventory.cjs' ||
				typeof repair.content !== 'string' ||
				Buffer.byteLength(repair.content) > 8_192
			) {
				throw new Error(
					'The model did not return a valid bounded source repair.',
				);
			}
			content = repair.content;
		}
		await action(
			{ kind: 'file.write', path: 'src/inventory.cjs', content },
			'completed',
		);
		await transition('verify');
		await action(test, 'completed');
		await this.session.complete();
	}

	async export() {
		return (
			await this.api(
				`/v1/sessions/${this.session.record.sessionId}/evidence-bundle`,
			)
		).bundle;
	}

	async reset() {
		if (this.running) {
			throw new Error('Stop the active run before resetting.');
		}
		this.running = true;
		try {
			await this.newSession();
			this.error = null;
			this.stopping = false;
		} finally {
			this.running = false;
		}
		return { sessionId: this.session.record.sessionId };
	}

	async stop() {
		this.stopping = true;
		await this.initializing;
		if (this.session !== undefined) {
			await this.api(
				`/v1/sessions/${this.session.record.sessionId}/cancel`,
				'POST',
				{},
			);
		}
		await this.job;
		this.running = false;
	}

	async close() {
		await this.stop();
		this.knowledge?.close();
	}
}
