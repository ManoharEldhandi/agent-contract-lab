import * as vscode from 'vscode';
import { discoverInstructionSources, formatInstructionSourceCount } from './instructionSources';

type ConnectionState = 'not connected' | 'connected' | 'unavailable';

class ContractLabView implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly changeEmitter = new vscode.EventEmitter<void>();
	private connectionState: ConnectionState = 'not connected';
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
					this.item(`Local supervisor: ${this.connectionState}`, 'plug', 'agent-contract-lab.connectSupervisor'),
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

	setConnectionState(connectionState: ConnectionState): void {
		this.connectionState = connectionState;
		this.changeEmitter.fire();
	}

	setInstructionCount(discoveredInstructions: number): void {
		this.discoveredInstructions = discoveredInstructions;
		this.changeEmitter.fire();
	}

	private item(label: string, icon: string, command?: string): vscode.TreeItem {
		const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
		item.iconPath = new vscode.ThemeIcon(icon);
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

			const connected = await connectToSupervisor(output);
			sessionView.setConnectionState(connected ? 'connected' : 'unavailable');
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

async function connectToSupervisor(output: vscode.OutputChannel): Promise<boolean> {
	const configuredUrl = vscode.workspace.getConfiguration('agent-contract-lab').get<string>('supervisorUrl');
	if (!configuredUrl) {
		vscode.window.showErrorMessage('Agent Contract Lab has no configured supervisor URL.');
		return false;
	}

	let url: URL;
	try {
		url = new URL(configuredUrl);
	} catch {
		vscode.window.showErrorMessage('Agent Contract Lab supervisor URL is invalid.');
		return false;
	}

	if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
		vscode.window.showErrorMessage('Agent Contract Lab connects only to a local supervisor endpoint.');
		return false;
	}

	try {
		const response = await fetch(new URL('/health', url), { signal: AbortSignal.timeout(1500) });
		if (!response.ok) {
			throw new Error(`Supervisor returned HTTP ${response.status}.`);
		}
		output.appendLine(`Connected to local supervisor at ${url.origin}.`);
		vscode.window.showInformationMessage('Connected to the Agent Contract Lab supervisor.');
		return true;
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown connection error.';
		output.appendLine(`Supervisor connection failed: ${message}`);
		vscode.window.showWarningMessage('Local supervisor is unavailable. Start it before monitoring a run.');
		return false;
	}
}

export function deactivate() {}
