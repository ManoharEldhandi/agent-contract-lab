# Agent Contract Lab

Local, evidence-first observability, supervised execution, and contract testing for AI coding agents. It records visible agent activity, commands, tool calls, reviewed files, edits, tests, and provider usage without retaining private chain-of-thought. The same redacted timeline is the input to deterministic policy and contract evaluation.

## End-to-End Demo

For the usable policy console:

```sh
npm ci
npm run demo:web
```

Open the printed loopback URL, normally `http://127.0.0.1:43280`. The console
includes stage-specific tools, time/token/retry budgets, ten additional runtime
restrictions, live evidence, policy editing, and cited local knowledge search.
Use the fixture agent without credentials or configure an OpenAI-compatible
provider for a real model-generated repair. See [Stateful Policies](docs/runtime-policies.md).

Requires Node.js 22.13 or later and Git. No model account, API key, global CLI installation, or existing collector is required:

```sh
npm ci
npm run demo
```

The demo creates an isolated inventory fixture, refuses an out-of-scope write and a forbidden command, observes a real failing test, applies a scripted repair through supervisor-owned tools, and observes passing tests. It verifies eight contract assertions, the unchanged source checkout, bundle integrity, and tamper detection. The actual Model Logger SDK and collector 2.1.0 record seven correlated metadata-only spans, including blocked and failed action outcomes.

Redacted JSON reports, evidence, and traces are written beneath `.agent-contract-demo/`. Temporary worktrees, collectors, and scoped credentials are removed. The repair is explicitly scripted, not presented as a model response. Use `npm run demo -- --output <directory>` to select another artifact directory.

## Quick Start

Source development requires Node.js 22.13 or later.

From a published release:

```sh
npm install -g @agent-contract-lab/cli
agent-contract supervisor start
agent-contract workspace trust .
```

For source development:

```sh
# In this repository
npm ci
npm run build
npm link

# From the repository you want to monitor
agent-contract supervisor start
agent-contract workspace trust .
agent-contract run -- npm test
agent-contract agent codex "Fix the failing parser test" --max-tokens 50000
agent-contract sessions list
agent-contract logs <session-id>
agent-contract watch <session-id> --kind process.completed,workspace.diff
agent-contract cost <session-id>
agent-contract export <session-id> --output ./agent-contract.bundle.json
agent-contract verify ./agent-contract.bundle.json
agent-contract contract evaluate <session-id> /path/to/agent-contract-lab/examples/contracts/no-destructive-command.yaml
```

The supervisor listens only on loopback. Its local token, trust registry, and redacted JSONL evidence live under `~/.agent-contract-lab` by default; set `AGENT_CONTRACT_HOME` to use another local directory.

## Contract Enforcement

There are two explicit enforcement scopes:

- `agent-contract run --contract ./contract.yaml --wait -- <command>` checks the managed command before launch, waits for completion, and evaluates retained evidence for CI. Exit codes are `0` for pass, `2` for failure, and `3` for unknown evidence. A launch check does not intercept an agent's internal tools or child processes.
- `client.startContractSession(...)` attaches an immutable contract and defaults to an isolated Git worktree. `session.executeAction(...)` submits commands, reads, and writes to supervisor-owned tools. A refusal never invokes the executor; a failed evidence commit also prevents execution. Decisions precede effects and reference the exact contract hash.

Command allow/deny rules and path allow/deny rules are deterministic. Command output, file sizes, deadlines, and action queues are bounded. Final path checks also inspect supervisor-owned Git snapshots, so an allowed command's observed file changes are not ignored. Ambiguous dirty baselines and incomplete snapshots remain unknown.

The [integration guide](docs/integration.md) includes provider-neutral tool integration and the optional Model Logger strategy. The [contract specification](docs/policy-and-contract-spec.md) describes supported fields and limitations.

Stateful policies belong on supervisor-owned contract sessions, not the generic
launch guard. `runtime.phases` controls tool access by stage; `runtime.limits`
controls duration, token admission, retries, actions, rate, failures, file breadth,
write volume, and output. Read-before-write, model allowlists, per-tool quotas,
and current-revision verification are also enforced. The policy console exposes
all fourteen control groups and preserves active-policy immutability.

Local SQLite retrieval supplies cited policy/runbook context for optional model
calls and operator explanations. Retrieved text never makes the allow/deny
decision, and operator searches do not consume agent quotas.

## Logs

`logs` has three formats:

```sh
agent-contract logs <session-id> --format pretty
agent-contract logs <session-id> --format json
agent-contract logs <session-id> --format jsonl
```

Every event has a supervisor sequence, timestamp, actor, canonical kind, evidence grade, redaction metadata, and JSON payload. JSONL emits exactly one event per line. Pretty logs label token totals as provider-reported, deterministically computed from documented provider fields, adapter-reported, or mixed. OpenAI Responses and compatible Chat Completions, Anthropic Messages, and Gemini GenerateContent responses can be submitted directly through the SDK; other providers use an explicit field mapping. A generic managed command has no access to a model response or billing counters, so its token usage correctly remains reason-coded `unknown`.

Managed commands and supervisor-owned contract actions are captured as `observed-boundary` evidence. A direct `agent-contract agent codex <task>` run uses the documented Codex App Server stream and records visible agent activity as `observed-native`; raw reasoning is intentionally represented as redacted rather than retained. Other AI systems can use the local SDK to report messages, safe summaries, tools, commands, files, tests, and token usage as `model-declared` evidence. See [Integration](docs/integration.md). YAML contracts evaluate retained command, file, and Git snapshot evidence. Pre-action assertions pass only with hash-bound, correlated supervisor proofs for the supported scope; unsupported interception remains reason-coded `unknown`.

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

Build the extension with `cd apps/vscode-extension && npm ci && npm run compile`. Run the `Run Extension` launch configuration. **Connect Local Supervisor** starts the bundled loopback-only supervisor if one is not already running. In the **Agent Contracts** view, trust the workspace, start a monitored command or **Log a Codex Task**, then select a session to inspect its redacted event log. **Guard Command Launch** selects a contract and runs a checked command in an isolated worktree; the Policies and Contracts views show the real final decisions. **Export Evidence Bundle** saves the supervisor-generated JSON through VS Code's native Save dialog. Instruction Sources lists discovered candidates, not proof that a particular vendor loaded them.

## Publish

`npm run release:check` verifies aligned versions, all workspace tests, npm
artifact contents, and the VSIX. The package dependency order is
`event-schema` → `policy-engine` → `adapter-sdk` → `local-supervisor`
→ `cli`; the extension packages separately as a VSIX. Follow the
[release guide](docs/releasing.md) for the credential-safe publish procedure.

## Boundaries

- Redaction happens before evidence is written or returned. Common credentials and sensitive structured fields are replaced; deployment should add organization-specific rules for its secret formats.
- No client can submit `observed-native`, `observed-boundary`, or `computed` facts through the external API.
- Repository instructions, contracts, and model output are untrusted input. Unknown contract fields are rejected rather than silently ignored. An integration must route actual tools through supervisor actions to gain pre-action enforcement; observation callbacks and Model Logger spans do not grant it.
- Worktrees and path checks are not an OS sandbox. Allowed commands can create child processes, use the network, or access files outside the worktree. Native vendor interception, organization-policy precedence, vendor-specific effective-instruction resolution, and broader assertions remain explicit roadmap items.

Architecture and security decisions are in [docs](docs/).
