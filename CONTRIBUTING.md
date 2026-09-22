# Contributing

Use Node.js 22 or later. Before opening a pull request, run:

```sh
npm ci
npm run release:check
```

For a VS Code extension change, also run `npm run extension:test`. Keep
retained evidence user-visible, preserve evidence grades, and never add hidden
reasoning, local credentials, or secrets to event payloads.

Use small, focused changes with tests for behavior changes. Do not commit
generated `dist/`, `out/`, `.vsix`, or local `.agent-contract-lab/` state.
Review [SECURITY.md](SECURITY.md) before reporting a vulnerability.

This repository is open source under the [MIT License](LICENSE). By
contributing, you agree that your contribution may be distributed under that
license.
