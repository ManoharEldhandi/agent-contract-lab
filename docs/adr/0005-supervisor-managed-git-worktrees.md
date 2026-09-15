# ADR 0005: Supervisor-managed detached Git worktrees for isolated runs

- Status: accepted
- Date: 2026-09-15

## Context

Managed agent commands may modify a trusted checkout. Users need a practical local isolation mode that preserves the source checkout while the supervisor still owns trust checks, execution evidence, diff capture, and cleanup.

Repository-controlled Git configuration and hooks are untrusted. An isolated-run implementation must not store a raw private worktree path in durable evidence or silently change the working directory requested by a user outside a trusted Git repository.

## Decision

The authenticated local supervisor accepts an explicit `isolated: true` managed-run option. After workspace trust succeeds, it:

- requires a Git worktree with a committed `HEAD`;
- creates a detached worktree under the supervisor data directory using `git worktree add --detach`;
- disables Git hooks for supervisor-managed Git commands;
- resolves the worktree and verifies it remains contained under the private worktree root;
- runs the requested command only inside that detached worktree;
- captures canonical redacted diff evidence from the detached worktree;
- records `worktree.created` and `worktree.removed` lifecycle evidence without durable absolute worktree paths; and
- removes the worktree after the run, using force removal because preserving source-checkout changes is the mode's purpose.

Worktree creation failure rejects the requested run. Cleanup failure is retained as reason-coded `unknown` evidence for investigation rather than being hidden.

This is source-tree isolation, not a general process sandbox. It does not constrain network access, credentials inherited by the child process, filesystem paths outside the worktree, or process creation. Those controls require a separately designed runtime sandbox.

## Consequences

- `agent-contract run --isolated -- <command>` provides an explicit source-preserving execution option for trusted Git workspaces.
- The supervisor, rather than the CLI or extension, owns lifecycle, containment, cleanup, and evidence decisions.
- Uncommitted source changes are not copied into an isolated run because worktrees start at committed `HEAD`; users must commit, stash, or use ordinary managed mode when uncommitted state is intentionally required.
- A repository without Git metadata or a committed `HEAD` cannot use this mode and receives an explicit error.
- A future OS sandbox may compose with worktree isolation but cannot be represented as equivalent evidence.