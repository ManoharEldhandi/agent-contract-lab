# Releasing Agent Contract Lab

Agent Contract Lab publishes five npm packages and one VS Code extension. All
manifests, the CLI runtime constant, and the supervisor runtime constant use
one release version; `npm run release:versions` enforces that invariant.

## Preconditions

1. Confirm the GitHub repository is public and the README, security policy, and
   release notes accurately describe the release.
2. Confirm the npm organization owns the `@agent-contract-lab` scope and
   enable npm two-factor authentication. Prefer npm Trusted Publishing from CI
   with provenance; use only a short-lived granular token for a manual publish.
3. Create or confirm the VS Code Marketplace publisher `manohareldhandi`.
   Store its publishing token only in secret storage.
4. Never print npm, Marketplace, GitHub, supervisor, or workspace credentials
   in a terminal recording or CI log.

## Release checklist

Set the new semantic version in the root manifest, every publishable workspace
manifest, and the VS Code extension manifest. Then run:

```sh
npm ci
npm run release:check
npm run extension:test
npm audit --omit=dev
npm --prefix apps/vscode-extension audit --omit=dev
```

Review the generated package file lists, VSIX, and release notes. Commit the
reviewed source and push it before publishing:

```sh
git add -A
git commit -m "chore: release v<version>"
git push origin main
```

Publish from that clean commit in dependency order. A trusted CI publisher can
add `--provenance`; omit it for a manual publish.

```sh
npm publish --workspace @agent-contract-lab/event-schema --access public
npm publish --workspace @agent-contract-lab/policy-engine --access public
npm publish --workspace @agent-contract-lab/adapter-sdk --access public
npm publish --workspace @agent-contract-lab/local-supervisor --access public
npm publish --workspace @agent-contract-lab/cli --access public
```

Then publish the already-validated VSIX:

```sh
cd apps/vscode-extension
npx vsce publish -p "$VSCE_PAT"
```

Create and push a `v<version>` tag, then attach the generated
`apps/vscode-extension/agent-contract-lab-<version>.vsix` to the GitHub
release for offline installation. Finally, install the exact CLI version in a
fresh temporary project and install the VSIX into a clean VS Code profile.

## Rollback

Do not unpublish an npm version after users may have resolved it. Publish a
patched version instead. Replace a Marketplace extension only when needed to
address a security issue, and document affected versions in the release notes.
