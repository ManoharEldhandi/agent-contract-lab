import { readFile } from 'node:fs/promises';

const repositoryRoot = new URL('../', import.meta.url);
const manifestPaths = [
	'package.json',
	'packages/event-schema/package.json',
	'packages/policy-engine/package.json',
	'packages/adapter-sdk/package.json',
	'apps/local-supervisor/package.json',
	'apps/cli/package.json',
	'apps/vscode-extension/package.json',
];

const manifests = await Promise.all(manifestPaths.map(async (path) => ({
	path,
	value: JSON.parse(await readFile(new URL(path, repositoryRoot), 'utf8')),
})));
const expectedVersion = manifests[0]?.value.version;
const problems = [];

if (typeof expectedVersion !== 'string' || expectedVersion.trim() === '') {
	problems.push('package.json must declare a non-empty version');
} else {
	for (const { path, value } of manifests) {
		if (value.version !== expectedVersion) {
			problems.push(`${path}: expected version ${expectedVersion}, found ${String(value.version)}`);
		}
		for (const [dependency, range] of Object.entries(value.dependencies ?? {})) {
			const isExtensionWorkspaceLink = path === 'apps/vscode-extension/package.json' && range === 'file:../../packages/event-schema';
			if (dependency.startsWith('@agent-contract-lab/') && !isExtensionWorkspaceLink && range !== `^${expectedVersion}`) {
				problems.push(`${path}: ${dependency} must use ^${expectedVersion}, found ${String(range)}`);
			}
		}
	}

	const sourceVersions = [
		['apps/cli/src/constants.ts', 'CLI_VERSION'],
		['apps/local-supervisor/src/version.ts', 'SUPERVISOR_VERSION'],
	];
	for (const [path, symbol] of sourceVersions) {
		const source = await readFile(new URL(path, repositoryRoot), 'utf8');
		const found = new RegExp(`export const ${symbol} = '([^']+)'`).exec(source)?.[1];
		if (found !== expectedVersion) {
			problems.push(`${path}: ${symbol} must be ${expectedVersion}, found ${String(found)}`);
		}
	}
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(problem);
	}
	throw new Error('release versions are not aligned');
}

console.log(`Release versions verified: ${expectedVersion}`);
