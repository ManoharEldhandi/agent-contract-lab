import * as vscode from 'vscode';
import { discoverInstructionSources, formatInstructionSourceCount } from './instructionSources';
import { describeConnection, probeSupervisor, type SupervisorConnection } from './supervisorClient';

class ContractLabView implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private supervisorLabel = 'not connected';
	private supervisorDetail = 'Run "Connect Local Supervisor" to check availability.';
	private discoveredInstructions = 0;

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
					this.item('Start monitored run', 'play', 'agent-contract-lab.startMonitoredRun'),
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

	private item(label: string, icon: string, command?: string, tooltip?: string): vscode.TreeItem {
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(icon);
		if (tooltip) {
			item.tooltip = tooltip;
		}
		if (command) {
			item.command = { command, title: label };
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
		vscode.commands.registerCommand('agent-contract-lab.startMonitoredRun', () => {
			vscode.window.showInformationMessage('A monitored run will be available after the local supervisor is implemented.');
		}),
		vscode.commands.registerCommand('agent-contract-lab.runContractSuite', () => {
			vscode.window.showInformationMessage('Contract execution is planned for the local supervisor milestone.');
		}),
		vscode.commands.registerCommand('agent-contract-lab.exportEvidenceBundle', () => {
			vscode.window.showInformationMessage('Evidence export is planned after contract reports are available.');
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
	const configuredUrl = vscode.workspace.getConfiguration('agent-contract-lab').get<string>('supervisorUrl');
	if (!configuredUrl) {
		return { kind: 'unreachable', message: 'No supervisor URL is configured.' };
	}

	let url: URL;
	try {
		url = new URL(configuredUrl);
	} catch {
		return { kind: 'unreachable', message: `Invalid supervisor URL: ${configuredUrl}` };
	}

	const host = url.hostname.replace(/^\[(.+)\]$/, '$1');
	if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
		return { kind: 'unreachable', message: `Supervisor URL must be loopback, received ${host}.` };
	}

	const connection = await probeSupervisor(url);
	output.appendLine(`Supervisor probe at ${url.origin}: ${connection.kind}`);
	return connection;
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
