# ADR 0007: Supervisor-Owned Contract Actions

## Status

Accepted.

## Context

Observation callbacks and Model Logger spans show reported activity but cannot
prevent an action. A wrapper around an agent process also cannot honestly claim
that every nested tool or child process was intercepted. Contracts need a narrow
execution boundary with retained evidence of both refusals and allowed effects.

## Decision

Expose authenticated contract sessions and explicit command, file-read, and
file-write actions. Default contract sessions to supervisor-managed detached Git
worktrees. Snapshot and freeze the validated contract, then bind pre-action
decisions to its SHA-256 and an action correlation ID.

Keep the deterministic policy in the domain package. An application interceptor
depends on policy, evidence, and executor interfaces. Commit the decision before
calling infrastructure; evidence failure refuses execution. Serialize actions per
session and bound queued work. File I/O rejects traversal, symlink access, and
hardlinks; command I/O uses argument vectors, bounded output, deadlines, and a
filtered child environment. These safeguards are not an OS sandbox.

On completion, stop accepting actions, drain accepted work, capture the final Git
diff, evaluate the attached contract, remove the worktree, and record the terminal
session. Incomplete observations remain unknown. Managed `run --contract` applies
only to the outer launch and must not satisfy full pre-action assertions.

Model Logger is optional infrastructure outside the enforcement boundary. Its
SDK strategy observes one guarded request, never retries effects, uses metadata
and fixed outcome events, and preserves the original result even when telemetry
or diagnostics fail. Logger spans remain model-declared.

## Consequences

Any agent ecosystem can expose only tools backed by this API without placing
policy decisions in the model or editor. A credential-free scripted fixture can
prove real refusals, failing/passing tests, source isolation, evidence integrity,
and actual Model Logger delivery.

Approved commands still have ordinary process privileges, including network and
external filesystem access. Child actions are not individually intercepted.
Native vendor tools do not gain enforcement merely because their events are
logged. Organization-policy precedence, OS sandboxing, and vendor-specific
effective-instruction resolution remain separate future capabilities.
