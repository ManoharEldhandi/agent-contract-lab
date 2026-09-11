import * as vscode from 'vscode';

export const instructionPatterns = [
	'**/AGENTS.md',
	'**/CLAUDE.md',
	'**/.github/copilot-instructions.md',
	'**/.github/instructions/**/*.instructions.md',
] as const;

const excludedFolders = '**/{.git,node_modules,dist,out}/**';

export async function discoverInstructionSources(): Promise<string[]> {
	const files = await Promise.all(
		instructionPatterns.map((pattern) => vscode.workspace.findFiles(pattern, excludedFolders)),
	);

	return files
		.flat()
		.map((file) => vscode.workspace.asRelativePath(file, false))
		.sort((first, second) => first.localeCompare(second));
}

export function formatInstructionSourceCount(count: number): string {
	return `${count} instruction source${count === 1 ? '' : 's'} discovered`;
}
