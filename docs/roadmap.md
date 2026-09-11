# Delivery Roadmap

## Phase 0: Foundation

Outcome: a trustworthy skeleton with clear contracts, not a fake dashboard.

- Establish monorepo tooling, docs, TypeScript extension baseline, and ADR template.
- Implement canonical types for session, event, evidence grade, capability, policy decision, and contract verdict.
- Implement supervisor health protocol and extension connection state.
- Define fixture repository format and deterministic path policy prototype.

Exit criterion: the extension connects to a local supervisor and displays a real health/capability result.

## Phase 1: Effective instruction map

Outcome: explain the repository rules that apply to an active path.

- Build repository instruction discovery for a narrow, documented file set.
- Render source path, precedence, content hash, target-path applicability, and evidence grade.
- Add snapshot tests with nested path-specific instructions.

Exit criterion: a user can inspect a reproducible effective-instruction map without invoking an agent.

## Phase 2: First deep adapter and trace

Outcome: evidence-backed local monitored run for one agent.

- Implement Claude Code adapter prototype with native hook/OTel integration where available.
- Normalize session, tool, command, file, instruction, and completion events.
- Persist event stream and show it in VS Code.
- Add a fixture proving event-order and evidence-grade handling.

Exit criterion: one local run produces a trace whose displayed claims map to retained evidence.

## Phase 3: Contract runner

Outcome: one realistic task can pass, fail, or return unknown in isolation.

- Create isolated worktree runner.
- Evaluate allowed/denied-path and required-test assertions.
- Produce a local report and portable evidence bundle.
- Implement a command to run contracts from VS Code.

Exit criterion: intentionally compliant and non-compliant fixtures yield deterministic results.

## Phase 4: Second adapter and comparison

Outcome: cross-agent comparisons become meaningful rather than cosmetic.

- Implement Codex adapter and capability conformance suite.
- Pin task, repository snapshot, policy, and comparison metadata.
- Present a capability-aware compare matrix.

Exit criterion: the tool does not compare unsupported dimensions as though they were equal.

## Phase 5: CI and opt-in sharing

Outcome: repeatable repository checks outside an editor.

- Publish CLI and GitHub Action.
- Emit machine-readable summary plus evidence artifact.
- Prototype opt-in hosted report sharing only after privacy/security review.

## Decisions to make through ADRs

- Supervisor runtime and packaging strategy.
- Local IPC transport and authentication approach.
- Policy evaluator choice: TypeScript v0 versus OPA/Rego.
- Worktree-only versus container-backed fixture isolation.
- Evidence bundle archive/signature format.
- Data retention and any hosted-service boundaries.
