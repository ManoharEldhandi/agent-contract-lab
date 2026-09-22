import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);
const workspaces = [
	'@agent-contract-lab/event-schema',
	'@agent-contract-lab/policy-engine',
	'@agent-contract-lab/adapter-sdk',
	'@agent-contract-lab/local-supervisor',
	'@agent-contract-lab/cli',
];

function isAllowed(path) {
	if (path.includes('.test.')) return false;
	return path === 'package.json'
		|| path === 'README.md'
		|| path === 'LICENSE'
		|| /^dist\/.+\.(?:js|d\.ts)$/.test(path);
}

for (const workspace of workspaces) {
	const { stdout } = await execFile('npm', ['pack', '--dry-run', '--json', '--workspace', workspace], {
		cwd: new URL('../', import.meta.url),
	});
	const [artifact] = JSON.parse(stdout);
	if (artifact === undefined || !Array.isArray(artifact.files)) {
		throw new Error(`${workspace}: npm did not return a package file list`);
	}
	const paths = artifact.files.map((file) => file.path);
	const missing = ['package.json', 'README.md', 'LICENSE'].filter((path) => !paths.includes(path));
	const unexpected = paths.filter((path) => !isAllowed(path));
	if (missing.length > 0 || unexpected.length > 0) {
		for (const path of missing) console.error(`${workspace}: missing required artifact file ${path}`);
		for (const path of unexpected) console.error(`${workspace}: unexpected artifact file ${path}`);
		throw new Error(`${workspace}: package contents do not meet the release allowlist`);
	}
	console.log(`${workspace}: ${paths.length} release files verified`);
}
