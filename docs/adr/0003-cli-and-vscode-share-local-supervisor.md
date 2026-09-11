# ADR 0003: CLI and VS Code share one local supervisor

- Status: proposed
- Date: 2026-09-11

## Context

Agent Contract Lab needs an installable local CLI for live monitoring, historical investigation, deterministic findings, contract runs, and evidence retrieval. It also retains VS Code as the primary daily developer interface.

Putting collection or decision logic in either client would duplicate behavior, weaken the trust boundary, and make CLI, extension, and CI results diverge. Live terminal interaction also has different flow-control and durability needs from canonical evidence streaming.

The first implementation must remain small enough to deliver the Phase 0 structured health slice while preserving a path to durable evidence and multiple clients.

## Decision

Use one unprivileged local supervisor per operating-system user and execution environment. The CLI, VS Code extension, and future CI client use the same versioned supervisor API.

The initial supervisor runtime is TypeScript/Node.js and ships version-matched with the CLI. This shares schemas with the existing extension and minimizes packaging work while the adapter, policy, and isolation boundaries are still being validated. A future execution runner may use another language without moving policy or evidence ownership into a client.

The local protocol is HTTP/1.1 behind a transport abstraction:

- Phase 0 may use the existing explicit loopback address for `GET /health`.
- The target desktop transport is a user-only Unix-domain socket on macOS/Linux and a user-restricted named pipe on Windows.
- Loopback TCP remains an explicit fallback and must bind only to `127.0.0.1` or `::1`.
- Sensitive reads and all mutations require a random per-installation credential stored outside repositories.
- Bootstrap health may be unauthenticated only when it returns non-sensitive compatibility and availability fields over a verified local transport.

The credential is 256 random bits generated atomically on first explicit start. A shared protocol-client credential provider reads it from the OS credential store or a user-only fallback file without printing it. Rotation invalidates authenticated streams and requires reconnection. Each workstation, remote host, container, or Codespace has an independent credential.

Committed canonical events use a resumable one-way stream keyed by supervisor-assigned session sequence. Resume uses an exclusive cursor and at-least-once delivery; clients deduplicate by session and sequence, and retention gaps return an explicit cursor-expired error. Interactive terminal input, output, and resize use a separate transient duplex channel. Raw terminal bytes are not canonical durable evidence; retained output passes through validation, normalization, and redaction first.

The supervisor exclusively owns:

- Session, adapter, agent, and isolated-worktree lifecycle.
- Event validation, redaction, ordering, and durable persistence.
- Deterministic policy decisions and contract verdicts.
- Findings, evidence queries, retrieval indexes, and exports.

The CLI is the first backend-complete reference client. VS Code remains the primary daily UI and renders the same supervisor-owned state. Retrieval and answer generation remain read-only advisory consumers and are excluded from enforcement paths.

## Consequences

- CLI and VS Code behavior can be tested against one API and one evidence model.
- Client disconnects do not terminate or corrupt a session; clients resume from durable sequence cursors.
- The supervisor can enforce redaction and deterministic policy once for every client.
- A separate supervisor process adds lifecycle, authentication, migration, and compatibility work.
- The Node.js distribution is an initial delivery choice, not a permanent sandbox claim.
- Local socket and named-pipe clients need a transport adapter rather than relying only on browser-style `fetch`.
- Terminal streaming and canonical event streaming require separate protocol tests and user-facing labels.
- Remote VS Code environments need the supervisor installed where the repository executes.

## Alternatives considered

### Put the runtime in the CLI process

Rejected because evidence collection would stop on client disconnect, VS Code would require a second implementation, and concurrent clients could create competing writers.

### Put the runtime in the VS Code extension host

Rejected by ADR 0001. It would make editor lifecycle and workspace extension code part of the trust boundary and would not serve headless or CI workflows.

### Persist raw JSONL files and add a daemon later

Rejected because redaction, ordering, transactional decision references, reconnect cursors, concurrent reads, and schema migration are core requirements rather than optional optimizations.

### Use a language model to classify live events before policy

Rejected by ADR 0002. Model latency, nondeterminism, and prompt injection make it unsuitable for hard allow, deny, or verdict decisions.

### Start with gRPC or a message broker

Deferred because HTTP over local IPC supports health, commands, resumable streams, and multiple clients with less installation complexity. Revisit only if measured adapter throughput or cross-language requirements exceed the protocol.

## Validation required before acceptance

1. CLI and extension parse the same structured health response.
2. A supervisor binds only to an approved local endpoint.
3. A second supervisor cannot become a concurrent writer for the same user store.
4. Sensitive endpoints reject a missing or incorrect installation credential.
5. A stream reconnect resumes after an exclusive committed sequence with no silent gap; any duplicate frame is identifiable by session and sequence.
6. Disconnecting the CLI does not lose a committed session event.
7. Terminal bytes cannot enter durable storage without redaction.