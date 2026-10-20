# Policy and Contract Specification

## Separation of concerns

Policies are deterministic, human-owned guardrails. Contracts are executable behavioral expectations evaluated against an isolated agent task. Retrieval and language models can explain both, but never decide enforcement.

## Implemented V1 Contract

Contracts may be selected from repository YAML files. They contain only the
supported fields below; unknown fields, oversized patterns, and malformed input
are rejected. Task fixtures are driver inputs, not policy fields.

The optional `runtime` section adds phase-aware tools, duration/token/retry
budgets, quotas, file/output limits, model allowlists, and completion gates.
See [Stateful Policies](runtime-policies.md) and the
[complete staged example](../examples/contracts/staged-agent.yaml). These fields
require supervisor-owned contract sessions; launch-only guards reject them.

```yaml
version: 1
name: no-production-config-edits
assertions:
  paths:
    allow:
      - "packages/client/**"
      - "tests/client/**"
    deny:
      - "infra/production/**"
  commands:
    allow:
      - "node --test tests/client/**"
    requireSuccess:
      - "node --test tests/client/**"
    deny:
      - "rm *"
    requirePreAction: true
  evidence:
    require:
      - "filesystem-diff"
      - "command-result"
```

## Implemented Rules

- `paths.allow` and `paths.deny`: gate supervisor-owned file reads/writes and
  evaluate observed changes, including complete supervisor Git snapshots.
- `commands.allow` and `commands.deny`: gate structured executable/argument
  vectors and evaluate observed launches. Deny takes precedence. An omitted allow
  list imposes no allow-list restriction; an empty allow list refuses all commands.
- `commands.requireSuccess`: require a correlated successful observed completion.
  An explicit retained failure is `fail`; missing results remain `unknown`.
- `commands.requirePreAction`: require a supervisor-attached contract hash and
  prior correlated computed decisions for every observed supervisor command.
  Generic launch guards and vendor observation alone cannot satisfy it.
- `evidence.require`: supports `command-result` and `filesystem-diff` only.

Patterns use minimatch. File paths are normalized relative paths; absolute paths,
traversal, symlinked file access, and hardlinked targets are refused. Command
patterns match the executable and arguments joined with spaces, with wildcards
able to span path separators. Deny patterns also check executable basenames;
allow patterns check the complete executable text. Prefer exact trusted executable
paths and narrow arguments. These globs do not parse shell syntax or constrain
arbitrary effects of an approved program.

Contracts are immutable snapshots. Pre-action decisions bind the canonical
contract SHA-256 and the proposed action correlation ID before the executor runs.
Failure to retain that decision prevents execution. Post-action rule decisions
retain evidence IDs and preserve unknowns for missing or ambiguous observations.
Git-ignored files, transient writes, and effects outside the worktree are not
covered by a final Git snapshot.

## Planned Rule Sources

The current implementation attaches one user-selected contract. Organization
policy loading and multi-source precedence are not implemented. The target
precedence remains:

```text
Built-in safety invariants
  > organization policy
  > user-local policy
  > repository contract
  > task-specific fixture input
```

Future lower layers must not disable a higher-layer requirement. Required-touch
assertions, approval workflows, MCP destination rules, vendor instruction-load
rules, and export policies also remain unsupported and must not be inferred from
natural-language instruction files.

## Deterministic evaluation

- Paths are normalized relative to the pinned workspace root and matched with a documented glob library.
- Commands are normalized as structured executable plus argument vectors when available; raw string matching is a fallback with lower fidelity.
- Each decision records input evidence IDs, rule ID/hash, evaluation timestamp, and result.
- An unsupported capability yields `unknown`; it does not silently evaluate as allow.

## Why not OPA/Rego yet

OPA/Rego is a credible backend candidate for organization-level rules, but v0 needs an approachable YAML authoring layer and a tight mapping from assertions to evidence. Create an ADR after the first path/command policy prototype compares a small TypeScript evaluator against OPA embedding and operational cost.
