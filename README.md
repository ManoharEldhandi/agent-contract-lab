# Agent Contract Lab

Local, evidence-first logging for AI coding agents. It records commands, output, tool activity, file and test events, explicit model summaries, and reported token totals without pretending to know private chain-of-thought.

## Quick Start

Requires Node.js 22 or later.

From a published release:

```sh
npm install -g @agent-contract-lab/cli @agent-contract-lab/local-supervisor
agent-contract-supervisor
```

For source development:

```sh
npm install
npm run build

# Terminal 1
npm run supervisor

# Terminal 2, from the repository you want to monitor
agent-contract workspace trust .
agent-contract run -- npm test
agent-contract sessions list
agent-contract logs <session-id>
agent-contract watch <session-id> --kind process.completed,workspace.diff
agent-contract cost <session-id>
agent-contract export <session-id> --output ./agent-contract.bundle.json
agent-contract verify ./agent-contract.bundle.json
agent-contract contract evaluate <session-id> /path/to/agent-contract-lab/examples/contracts/no-destructive-command.yaml
```

The supervisor listens only on loopback. Its local token, trust registry, and redacted JSONL evidence live under `~/.agent-contract-lab` by default; set `AGENT_CONTRACT_HOME` to use another local directory.

## Logs

`logs` has three formats:

```sh
agent-contract logs <session-id> --format pretty
agent-contract logs <session-id> --format json
agent-contract logs <session-id> --format jsonl
```

Every event has a supervisor sequence, timestamp, actor, canonical kind, evidence grade, redaction metadata, and JSON payload. JSONL emits exactly one event per line. Pretty logs label token totals as provider-reported, deterministically computed from documented provider fields, adapter-reported, or mixed. OpenAI Responses and compatible Chat Completions, Anthropic Messages, and Gemini GenerateContent responses can be submitted directly through the SDK; other providers use an explicit field mapping. A generic managed command has no access to a model response or billing counters, so its token usage correctly remains reason-coded `unknown`.

Managed commands are captured as `observed-boundary` evidence. Other AI systems can use the local SDK to report messages, safe summaries, tools, commands, files, tests, and token usage as `model-declared` evidence. See [Integration](docs/integration.md). YAML contracts can deterministically evaluate retained command and file events. Missing evidence and requested pre-action interception remain reason-coded `unknown`, never a guessed pass or prevention claim.

## Live Monitoring

`watch` follows the supervisor's committed event cursor and can resume safely after a disconnect. It supports event-kind, evidence-grade, actor, path, and command filters; `--once` returns one scriptable snapshot.

```sh
agent-contract watch <session-id> --after-sequence 42 --kind file.changed,workspace.diff
agent-contract watch <session-id> --path src/ --grade observed-boundary --once --format jsonl
```

## Git Evidence and Isolation

The supervisor records a redacted `workspace.diff` baseline/final snapshot around trusted managed runs in Git worktrees. It is `observed-boundary` evidence when Git can be queried, or reason-coded `unknown` when it cannot. Contract filesystem assertions require this supervisor-owned snapshot rather than a client-declared file event.

Use an isolated detached Git worktree when the command must not alter the source checkout:

```sh
agent-contract run --isolated -- npm test
```

This requires a trusted Git workspace with a committed `HEAD`. The supervisor creates the worktree beneath its user-local state directory, captures its redacted diff, and force-removes it after the run. The source checkout is unchanged, and its uncommitted changes are not copied into the isolated worktree. This protects the source tree; it is not an OS sandbox and does not restrict network access, inherited credentials, or filesystem access outside the worktree.

## Cost Reports

`agent-contract cost <session-id>` calculates only from retained provider usage events whose provider/model matches the versioned standard-rate catalog. It reports the price-table version and per-event audit lines in pretty, JSON, and JSONL formats.

The initial `builtin-2026-09-15` catalog covers OpenAI `gpt-5.6-terra`, Anthropic `claude-sonnet-5`, and Gemini `gemini-2.5-flash`, including documented cache-read/write semantics. Unmapped models, incomplete usage, batch/discount pricing, tool pricing, and other unsupported billing dimensions remain `unknown` or `partial`; the tool never manufactures a plausible estimate.

## Evidence Bundles

Export a portable JSON bundle for code review or CI, then verify its canonical manifest with the local supervisor:

```sh
agent-contract export <session-id> --output ./agent-contract.bundle.json
agent-contract verify ./agent-contract.bundle.json
```

The bundle includes the redacted session, canonical event stream, policy-decision and Git-diff projections, deterministic cost report, redaction metadata, and SHA-256 hashes for each section and full content envelope. Export scrubs absolute filesystem paths in addition to normal secret redaction. V1 hash verification detects a changed bundle when its manifest has not been rewritten; it does not establish signer identity. See [ADR 0006](docs/adr/0006-portable-redacted-evidence-bundles.md).

## VS Code

Build the extension with `cd apps/vscode-extension && npm install && npm run compile`. Run the `Run Extension` launch configuration. In the **Agent Contracts** view, connect to the local supervisor, trust the workspace, start a monitored command using a JSON argument vector, then select a session to inspect its redacted event log. The **Export Evidence Bundle** command selects a retained session and saves the supervisor-generated JSON through VS Code's native Save dialog.

## Publish

`npm run pack:check` builds the packages and verifies the files included in the five npm artifacts. Publish `@agent-contract-lab/event-schema`, `@agent-contract-lab/policy-engine`, `@agent-contract-lab/local-supervisor`, `@agent-contract-lab/cli`, and `@agent-contract-lab/adapter-sdk` in that order. The extension packages separately as a VSIX.

## Boundaries

- Redaction happens before evidence is written or returned. Common credentials and sensitive structured fields are replaced; deployment should add organization-specific rules for its secret formats.
- No client can submit `observed-native`, `observed-boundary`, or `computed` facts through the external API.
- Repository instructions, contracts, and model output are untrusted input. The current policy engine evaluates retained evidence only; adapter interception, OS-level sandboxing, and broader contract assertions remain later milestones.

Architecture and security decisions are in [docs](docs/).
