# Contributing

Use Node.js 22.13 or later and Git. Before opening a pull request, run:

```sh
npm ci
npm run release:check
```

For a VS Code extension change, also run `npm run extension:test`. Keep
retained evidence user-visible, preserve evidence grades, and never add hidden
reasoning, local credentials, or secrets to event payloads.

The release check includes the credential-free end-to-end contract demo and
both real local collectors. Its repair is scripted; the fixture's initial
failing test is intentional and is not part of the workspace unit suites.

Root workspace tests also exercise the policy console and its connected-model
path through a local HTTP provider fixture. `npm run console:check` validates
its syntax and formatting. `npm run demo:web` starts the usable local product;
see the runtime guide for safe server-only provider configuration.

Use small, focused changes with tests for behavior changes. Do not commit
generated `dist/`, `out/`, `.vsix`, or local `.agent-contract-lab/` state.
Review [SECURITY.md](SECURITY.md) before reporting a vulnerability.

This repository is open source under the [MIT License](LICENSE). By
contributing, you agree that your contribution may be distributed under that
license.
