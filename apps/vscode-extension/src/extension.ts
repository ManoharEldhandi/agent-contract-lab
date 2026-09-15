import * as vscode from 'vscode';
import { discoverInstructionSources, formatInstructionSourceCount } from './instructionSources';
import { evaluateContract, getEvidenceBundle, getSessionEventSnapshot, listSessions, parseCommandArray, startManagedRun, trustWorkspace, type SupervisorSession } from './supervisorApi';
import { describeConnection, probeSupervisor, type SupervisorConnection } from './supervisorClient';

class ContractLabView implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private supervisorLabel = 'not connected';
	private supervisorDetail = 'Run "Connect Local Supervisor" to check availability.';
	private discoveredInstructions = 0;
	private sessions: readonly SupervisorSession[] = [];

	readonly onDidChangeTreeData = this.changeEmitter.event;

	constructor(private readonly view: 'session' | 'instructions' | 'policies' | 'contracts') {}

	getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
		return item;
	}

	getChildren(): vscode.TreeItem[] {
		switch (this.view) {
			case 'session':
				return [
					this.item(`Local supervisor: ${this.supervisorLabel}`, 'plug', 'agent-contract-lab.connectSupervisor', this.supervisorDetail),
					this.item('Trust workspace for managed runs', 'shield', 'agent-contract-lab.trustWorkspace'),
					this.item('Start monitored run', 'play', 'agent-contract-lab.startMonitoredRun'),
					this.item('Refresh recorded sessions', 'refresh', 'agent-contract-lab.refreshSessions'),
					...this.sessions.map((session) => this.item(
						`${session.sessionId.slice(0, 20)} (${session.state}, ${session.eventCount} events, ${formatTokenUsage(session)})`,
						'symbol-event',
						'agent-contract-lab.openSessionLog',
						`${session.runMode} run by ${session.actor}`,
						[session.sessionId],
					)),
				];
			case 'instructions':
				return [
					this.item(formatInstructionSourceCount(this.discoveredInstructions), 'book', 'agent-contract-lab.openEffectiveInstructions'),
					this.item('Inspect workspace instruction sources', 'search', 'agent-contract-lab.openEffectiveInstructions'),
				];
			case 'policies':
				return [
					this.item('Deterministic policy engine: planned', 'shield'),
					this.item('No active policy decisions', 'circle-outline'),
				];
			case 'contracts':
				return [
					this.item('Run contract suite', 'beaker', 'agent-contract-lab.runContractSuite'),
					this.item('No contract reports yet', 'history'),
				];
		}
	}

	setSupervisor(label: string, detail: string): void {
		this.supervisorLabel = label;
		this.supervisorDetail = detail;
		this.changeEmitter.fire();
	}

	setInstructionCount(discoveredInstructions: number): void {
		this.discoveredInstructions = discoveredInstructions;
		this.changeEmitter.fire();
	}

	setSessions(sessions: readonly SupervisorSession[]): void {
		this.sessions = sessions;
		this.changeEmitter.fire();
	}

	private item(label: string, icon: string, command?: string, tooltip?: string, argumentsValue?: readonly unknown[]): vscode.TreeItem {
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(icon);
		if (tooltip) {
			item.tooltip = tooltip;
		}
		if (command) {
			item.command = { command, title: label, ...(argumentsValue === undefined ? {} : { arguments: [...argumentsValue] }) };
		}
		return item;
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const output = vscode.window.createOutputChannel('Agent Contract Lab');
	const sessionView = new ContractLabView('session');
	const instructionView = new ContractLabView('instructions');

	context.subscriptions.push(
		output,
		vscode.window.registerTreeDataProvider('agent-contract-lab.session', sessionView),
		vscode.window.registerTreeDataProvider('agent-contract-lab.instructions', instructionView),
		vscode.window.registerTreeDataProvider('agent-contract-lab.policies', new ContractLabView('policies')),
		vscode.window.registerTreeDataProvider('agent-contract-lab.contracts', new ContractLabView('contracts')),
		vscode.commands.registerCommand('agent-contract-lab.connectSupervisor', async () => {
			if (!requireTrustedWorkspace()) {
				return;
			}

			const connection = await connectToSupervisor(output);
			const { label, detail } = describeConnection(connection);
			sessionView.setSupervisor(label, detail);
			reportConnection(connection);
			if (connection.kind === 'connected') {
				await refreshSessions(sessionView, output);
			}
		}),
		vscode.commands.registerCommand('agent-contract-lab.openEffectiveInstructions', async () => {
			const sources = await discoverInstructionSources();
			instructionView.setInstructionCount(sources.length);
			output.clear();
			output.appendLine('Discovered instruction sources:');
			for (const source of sources) {
				output.appendLine(`- ${source}`);
			}
			if (sources.length === 0) {
				output.appendLine('- None found in the current workspace.');
			}
			output.show(true);
		}),
		vscode.commands.registerCommand('agent-contract-lab.refreshSessions', async () => {
			if (!requireTrustedWorkspace()) {
				return;
			}
			await refreshSessions(sessionView, output);
		}),
		vscode.commands.registerCommand('agent-contract-lab.trustWorkspace', async () => {
			if (!requireTrustedWorkspace()) {
				return;
			}
			const workspacePath = activeWorkspacePath();
			if (workspacePath === undefined) {
				return;
			}
			const url = configuredSupervisorUrl();
			if (url === undefined) {
				return;
			}
			try {
				await trustWorkspace(url, workspacePath);
				vscode.window.showInformationMessage('Workspace trusted for Agent Contract Lab managed runs.');
			} catch (error) {
				vscode.window.showWarningMessage(`Could not trust workspace: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
		vscode.commands.registerCommand('agent-contract-lab.startMonitoredRun', async () => {
			if (!requireTrustedWorkspace()) {
				return;
			}
			const workspacePath = activeWorkspacePath();
			if (workspacePath === undefined) {
				return;
			}
			const input = await vscode.window.showInputBox({ title: 'Start monitored command', prompt: 'Command as a JSON string array', value: '["npm", "test"]' });
			if (input === undefined) {
				return;
			}
			const command = parseCommandArray(input);
			if (command === undefined) {
				vscode.window.showWarningMessage('Enter a non-empty JSON array of command strings.');
				return;
			}
			const url = configuredSupervisorUrl();
			if (url === undefined) {
				return;
			}
			try {
				const session = await startManagedRun(url, workspacePath, command[0]!, command.slice(1));
				vscode.window.showInformationMessage(`Started monitored session ${session.sessionId}.`);
				await refreshSessions(sessionView, output);
			} catch (error) {
				vscode.window.showWarningMessage(`Could not start monitored run: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
		vscode.commands.registerCommand('agent-contract-lab.openSessionLog', async (sessionId: string) => {
			if (!requireTrustedWorkspace()) {
				return;
			}
			const url = configuredSupervisorUrl();
			if (url === undefined) {
				return;
			}
			try {
				await followSessionLog(url, sessionId, sessionView, output);
			} catch (error) {
				vscode.window.showWarningMessage(`Could not read session log: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
		vscode.commands.registerCommand('agent-contract-lab.runContractSuite', async () => {
			if (!requireTrustedWorkspace()) {
				return;
			}
			const workspacePath = activeWorkspacePath();
			if (workspacePath === undefined) {
				return;
			}
			const url = configuredSupervisorUrl();
			if (url === undefined) {
				return;
			}
			try {
				const sessions = await listSessions(url);
				const selected = await vscode.window.showQuickPick(
					sessions.map((session) => ({ label: session.sessionId, description: `${session.state}, ${session.eventCount} events`, session })),
					{ title: 'Evaluate contract against session', placeHolder: 'Select a retained session' },
				);
				if (selected === undefined) {
					return;
				}
				const file = await vscode.window.showOpenDialog({
					title: 'Select contract YAML',
					defaultUri: vscode.Uri.file(workspacePath),
					canSelectFiles: true,
					canSelectFolders: false,
					canSelectMany: false,
					filters: { 'YAML contracts': ['yaml', 'yml'] },
				});
				const contractUri = file?.[0];
				if (contractUri === undefined) {
					return;
				}
				if (vscode.workspace.getWorkspaceFolder(contractUri) === undefined) {
					vscode.window.showWarningMessage('Select a contract file from the trusted workspace.');
					return;
				}
				const contractYaml = new TextDecoder().decode(await vscode.workspace.fs.readFile(contractUri));
				const result = await evaluateContract(url, selected.session.sessionId, contractYaml);
				output.clear();
				output.appendLine(`Contract ${result.contractName} for ${selected.session.sessionId}`);
				for (const decision of result.decisions) {
					output.appendLine(`${decision.result.toUpperCase()}  ${decision.ruleId}  ${decision.message}`);
					if (decision.unknownReason !== undefined) {
						output.appendLine(`Evidence gap: ${decision.unknownReason}`);
					}
				}
				output.show(true);
				await refreshSessions(sessionView, output);
			} catch (error) {
				vscode.window.showWarningMessage(`Could not evaluate contract: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
		vscode.commands.registerCommand('agent-contract-lab.exportEvidenceBundle', async () => {
			const url = configuredSupervisorUrl();
			if (url === undefined) {
				return;
			}
			try {
				const sessions = await listSessions(url);
				const selected = await vscode.window.showQuickPick(
					sessions.map((session) => ({ label: session.sessionId, description: `${session.state}, ${session.eventCount} events`, session })),
					{ title: 'Export evidence bundle', placeHolder: 'Select a retained session' },
				);
				if (selected === undefined) {
					return;
				}
				const destination = await vscode.window.showSaveDialog({
					title: 'Export Agent Contract Lab evidence bundle',
					defaultUri: vscode.Uri.file(`agent-contract-${selected.session.sessionId}.bundle.json`),
					filters: { 'Evidence bundle JSON': ['json'] },
				});
				if (destination === undefined) {
					return;
				}
				const bundle = await getEvidenceBundle(url, selected.session.sessionId);
				await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(`${JSON.stringify(bundle, null, 2)}\n`));
				vscode.window.showInformationMessage(`Exported evidence bundle for ${selected.session.sessionId}.`);
			} catch (error) {
				vscode.window.showWarningMessage(`Could not export evidence bundle: ${error instanceof Error ? error.message : String(error)}`);
			}
		}),
	);
}

function requireTrustedWorkspace(): boolean {
	if (vscode.workspace.isTrusted) {
		return true;
	}

	vscode.window.showWarningMessage('Trust this workspace before connecting Agent Contract Lab to local processes.');
	return false;
}

async function connectToSupervisor(output: vscode.OutputChannel): Promise<SupervisorConnection> {
	const url = configuredSupervisorUrl();
	if (url === undefined) {
		return { kind: 'unreachable', message: 'No valid loopback supervisor URL is configured.' };
	}

	const connection = await probeSupervisor(url);
	output.appendLine(`Supervisor probe at ${url.origin}: ${connection.kind}`);
	return connection;
}

function configuredSupervisorUrl(): URL | undefined {
	const configuredUrl = vscode.workspace.getConfiguration('agent-contract-lab').get<string>('supervisorUrl');
	if (!configuredUrl) {
		vscode.window.showWarningMessage('No local supervisor URL is configured.');
		return undefined;
	}
	try {
		const url = new URL(configuredUrl);
		const host = url.hostname.replace(/^\[(.+)\]$/, '$1');
		if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
			vscode.window.showWarningMessage(`Supervisor URL must be loopback, received ${host}.`);
			return undefined;
		}
		return url;
	} catch {
		vscode.window.showWarningMessage(`Invalid supervisor URL: ${configuredUrl}`);
		return undefined;
	}
}

function activeWorkspacePath(): string | undefined {
	const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
	if (workspacePath === undefined) {
		vscode.window.showWarningMessage('Open a workspace folder before starting an Agent Contract Lab run.');
	}
	return workspacePath;
}

function formatTokenUsage(session: SupervisorSession): string {
	return session.tokenUsage.status === 'reported'
		? `${session.tokenUsage.totalTokens} tokens (${session.tokenUsage.source})`
		: `tokens ${session.tokenUsage.reason}`;
}

async function refreshSessions(sessionView: ContractLabView, output: vscode.OutputChannel): Promise<void> {
	const url = configuredSupervisorUrl();
	if (url === undefined) {
		return;
	}
	try {
		const sessions = await listSessions(url);
		sessionView.setSessions(sessions);
		output.appendLine(`Loaded ${sessions.length} recorded session${sessions.length === 1 ? '' : 's'}.`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		sessionView.setSessions([]);
		output.appendLine(`Could not load sessions: ${message}`);
		vscode.window.showWarningMessage(`Could not load recorded sessions: ${message}`);
	}
}

async function followSessionLog(url: URL, sessionId: string, sessionView: ContractLabView, output: vscode.OutputChannel): Promise<void> {
	let afterSequence = 0;
	output.clear();
	output.appendLine(`Session ${sessionId}`);
	for (;;) {
		const snapshot = await getSessionEventSnapshot(url, sessionId, { afterSequence });
		for (const event of snapshot.events) {
			output.appendLine(`${String(event.sequence).padStart(4, '0')}  ${event.occurredAt}  ${event.evidenceGrade}  ${event.actor}  ${event.kind}`);
			output.appendLine(JSON.stringify(event.payload, null, 2));
			if (event.unknownReason !== undefined) {
				output.appendLine(`Evidence gap: ${event.unknownReason}`);
			}
		}
		output.show(true);
		afterSequence = snapshot.cursor.nextSequence;
		await refreshSessions(sessionView, output);
		if (snapshot.terminal) {
			return;
		}
		await new Promise<void>((resolve) => setTimeout(resolve, 250));
	}
}

function reportConnection(connection: SupervisorConnection): void {
	switch (connection.kind) {
		case 'connected':
			vscode.window.showInformationMessage(`Connected to the Agent Contract Lab supervisor ${connection.health.supervisorVersion}.`);
			return;
		case 'incompatible':
			vscode.window.showWarningMessage(`Supervisor API ${connection.health.apiVersion} is not compatible with this extension.`);
			return;
		case 'http-error':
		case 'malformed':
			vscode.window.showWarningMessage('The local supervisor responded but its health could not be verified.');
			return;
		case 'unreachable':
			vscode.window.showWarningMessage('Local supervisor is unavailable. Start it before monitoring a run.');
			return;
	}
}

export function deactivate() {}
