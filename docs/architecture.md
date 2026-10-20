# Architecture

## Decision

Ship a VS Code extension as the primary developer experience, not as the entire product. The extension must remain a client of a local supervisor so collection, enforcement, redaction, storage, CLI usage, and CI execution do not depend on an editor process.

```text
+--------------------+       local IPC        +-------------------------+
| VS Code extension  | <--------------------> | Local supervisor        |
| UI, commands,      |                        | sessions, adapters,     |
| workspace context  |                        | policy, redaction, DB   |
+--------------------+                        +-------------------------+
          |                                               |
          |                                               +-- agent adapters
          |                                               +-- worktree runner
          |                                               +-- evidence store
          |
          +-- CLI and GitHub Action use the same local contracts
```

## Components

### CLI

The CLI is the first backend-complete reference client and the primary headless interface. It starts or connects to the local supervisor, renders live committed events, queries historical evidence, runs contracts, and requests exports. It does not collect evidence, evaluate policy, or maintain a second local database.

The CLI and supervisor initially ship together for version compatibility, but remain separate processes and package boundaries. See [Local-first CLI and supervisor architecture](local-first-cli-architecture.md) for the target process model, command surface, evidence pipeline, storage design, retrieval boundary, and incremental delivery slices.

### VS Code extension

The extension owns user interaction only:

- Start/attach monitored runs.
- Render live trace tree, policy decisions, instruction map, reports, and compare results.
- Surface workspace-trust and connection state.
- Use `SecretStorage` only for credentials that the extension itself requires.
- Communicate with the supervisor over an authenticated local endpoint.

It is not a security boundary. It must never be the only evaluator of a policy or the sole holder of durable run evidence.

### Local supervisor

The supervisor is a long-running, local-first process. It owns:

- Repository snapshotting and worktree management.
- Adapter process lifecycle and capability negotiation.
- Event canonicalization, sequence ordering, and persistence.
- Deterministic policy evaluation before/after observable actions where supported.
- Redaction before persistence or optional export.
- Contract verification and evidence bundle construction.
- Local IPC authentication, versioning, and migration.

Recommended initial runtime: TypeScript/Node.js to share types and reduce startup friction. Re-evaluate after the first adapter and sandbox prototype; a Rust execution runner may become justified for stronger process isolation and a distributable binary.

The current release persists redacted session JSON and append-only event JSONL under a user-local directory. It provides authenticated loopback event queries, diff capture, versioned cost reports, detached Git-worktree execution, and portable evidence bundles. SQLite, content-addressed artifact storage, native local sockets, and OS sandboxing remain target architecture rather than current implementation.

### Supervised Execution Layers

- Domain: the policy engine parses immutable contracts and computes deterministic
    action decisions and retained-evidence verdicts without performing tool I/O.
- Application: `ContractExecution` serializes proposals, commits the correlated
    policy decision, and invokes an injected executor only after authorization.
    Policy, executor, and evidence ports are separate interfaces.
- Infrastructure: `WorkspaceActionExecutor` owns bounded file/process I/O; the
    ledger owns redacted immutable retained records; the service owns authenticated
    transport, trust, worktrees, and lifecycle composition.
- Integration: the SDK requests supervisor-owned actions. Its optional Model
    Logger strategy wraps that request at most once and cannot change the policy
    result, replay an effect, or promote telemetry to an observed evidence grade.

The local supervisor has no Model Logger runtime dependency. The pinned external
SDK and collector are development/demo dependencies only. See
[ADR 0007](adr/0007-supervisor-owned-contract-actions.md) for execution boundaries.

Stateful runtime transitions are pure immutable reducers in the policy package.
The application interceptor serializes authorization, admission charges, effects,
usage settlement, phase changes, and completion gates. A composite executor
delegates to bounded workspace I/O, a pluggable local full-text knowledge index, or a
server-configured model provider. The provider is an injected interface; no
endpoint or credential is accepted from an agent/browser action.

Retrieval uses native SQLite FTS5 where supported and MiniSearch otherwise.
SQLite is loaded lazily so an editor/runtime without that optional native
capability does not break the existing supervisor or policy path.

The private policy-console application is a loopback HTTP client of that same
supervisor. Its operator retrieval is read-only and separate from agent quotas.
Retrieved context is never an input that can weaken deterministic authorization.

### Adapters

Each adapter translates vendor behavior into a canonical event schema and declares precise capabilities. Adapters cannot invent evidence. Unsupported data is `unknown`, not inferred.

Initial adapter order:

1. Claude Code: strong hooks and documented instruction-load telemetry.
2. Codex: App Server / JSONL events and instruction-source data.
3. Cursor: documented hooks and headless streams.
4. GitHub Copilot: instruction and tool-hook integrations, with no unproven instruction-load signal.

### Policy engine

A deterministic evaluator processes declarative policy rules. High-level human-owned policies have explicit precedence over repository inputs. Retrieval or LLM interpretation may explain a result later, but cannot make the runtime allow/deny decision.

### Contract verifier

Contracts execute fixture tasks against a pinned repository snapshot and adapter configuration. It evaluates assertions over instruction-resolution data, normalized events, filesystem diff, command results, and test artifacts. A verdict is `pass`, `fail`, or `unknown`.

### Evidence and retrieval

A local evidence index can retrieve versioned instructions, vendor documentation snapshots, trace events, diffs, and reports with source citations. This RAG/CAG layer explains and audits; it does not enforce.

## Canonical event model

Every event includes at minimum:

- `schemaVersion`, `eventId`, `sessionId`, `turnId`, `sequence`, and timestamp.
- Repository identity: root, commit or content snapshot, selected target paths.
- Adapter identity: vendor, adapter version, client/agent version, capability set.
- `kind`, payload, parent/correlation IDs, and evidence grade.
- Redaction metadata and source reference.

Event ordering must be supervisor-assigned after arrival. Vendor timestamps are preserved but cannot be trusted as the sole order across processes.

## Storage and privacy

Current v0 storage is redacted JSON/JSONL under a user-local application directory; SQLite plus content-addressed artifacts is the target storage evolution. Workspace data remains local. Upload, report sharing, and any telemetry are explicit opt-in actions. Redaction runs before durable storage and before export; raw unredacted event data is not a required retained layer.

## Trust boundaries

```text
Untrusted: agent text, repository instruction files, tool output, PR changes
Trusted: signed/local supervisor binary, organization policy configuration
Conditionally trusted: adapter protocol payloads, sandbox telemetry
```

Repository-controlled instructions are test inputs. They cannot weaken organization policy, change evidence grades, or redefine retention/redaction guarantees.

## Interface contracts

- Extension <-> supervisor: versioned JSON-RPC or HTTP-over-Unix-socket, authenticated with a per-installation secret and origin checks.
- Supervisor <-> adapters: adapter SDK with capability declarations and canonical event emission.
- CLI <-> supervisor: the same public API used by the extension.
- CI: CLI emits JUnit/SARIF-like machine output plus an evidence artifact; exact formats are an ADR decision.

ADR 0003 proposes HTTP over an operating-system local endpoint, a structured bootstrap health response, resumable committed-event streams, and a separate transient terminal channel. It remains proposed until its validation criteria pass.
