# Security policy

Do not disclose security vulnerabilities in public issues. Report them through
the repository's [private security-advisory form](https://github.com/ManoharEldhandi/agent-contract-lab/security/advisories/new)
with reproduction steps, impact, and a safe contact method.

Agent Contract Lab is local-first. Reports involving evidence redaction,
loopback binding, workspace trust, credential handling, path scrubbing, vendor
relays, or evidence-bundle integrity are especially important.

## Execution Boundaries

Contract actions are an explicit supervisor-owned tool boundary, not an OS
sandbox. Allowed commands retain ordinary process privileges and may access the
network, external files, and child processes. Worktrees protect the source
checkout; final Git evidence does not cover ignored or transient changes or
effects outside the worktree. Do not run untrusted programs on a sensitive host
solely because a launch contract permits them.

File actions reject traversal, symlink access, and hardlinks, but do not promise
protection from a hostile same-user process racing directory replacements.
Contract-session child environments omit supervisor and provider credentials;
this does not prevent a privileged program from reading user-local files.
Observation callbacks and Model Logger traces must never be presented as
pre-action prevention. Optional tracing failures do not replay guarded effects.
Authenticated clients refuse HTTP redirects instead of forwarding local token
headers to another endpoint.

Stateful controls are enforced only on supervisor-routed actions. Token admission
uses conservative reservations, with provider-reported usage retained separately;
it is not a universal billing cap. Missing model usage prevents more model calls
when a token budget is active. Retrieved documents are untrusted reference data
and cannot authorize an action or alter an active policy.

The policy console uses a temporary fixture workspace and validates browser
Origin and exact Host values. Provider URL/key configuration remains server-side;
the browser cannot select a provider endpoint or arbitrary workspace path.
