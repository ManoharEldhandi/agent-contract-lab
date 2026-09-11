# Agent Contract Lab

Agent Contract Lab is a local-first platform for observing and contract-testing AI coding-agent behavior against repository instructions and deterministic policies.

The VS Code extension is the daily developer interface. A local supervisor will own evidence collection, policy decisions, redaction, storage, agent adapters, and isolated runs, so the same system can also support a CLI and GitHub Action.

## Status

This repository contains the product foundation and a compiling VS Code extension shell. The first implementation milestone is effective-instruction discovery, followed by a local supervisor health protocol, a Claude Code adapter, and deterministic path/test contracts.

## Read First

- [Product vision](docs/product-vision.md)
- [System architecture](docs/architecture.md)
- [VS Code extension architecture](docs/vscode-extension-architecture.md)
- [Evidence model](docs/evidence-model.md)
- [Adapter capability matrix](docs/adapter-capability-matrix.md)
- [Policy and contract specification](docs/policy-and-contract-spec.md)
- [Threat model](docs/threat-model.md)
- [Delivery roadmap](docs/roadmap.md)

## Repository layout

```text
apps/
	vscode-extension/       VS Code client and current executable scaffold
docs/                     Product, architecture, security, and delivery decisions
	adr/                    Accepted architecture decisions
packages/                 Reserved for shared schemas, adapter SDK, and policy SDK
fixtures/                 Reserved for isolated agent contract tasks
```

## Run the extension

```sh
cd apps/vscode-extension
npm install
npm run compile
```

Open `apps/vscode-extension` in VS Code and run the `Run Extension` launch configuration. The initial Activity Bar view is **Agent Contracts**.

## Principles

- Evidence grades make the limits of each vendor integration visible.
- Deterministic policies decide enforcement; retrieval can explain but cannot decide.
- Repository-controlled instructions are test inputs, not a way to weaken higher-level policy.
- Local storage and upload opt-in are the default privacy posture.
