# Delivery Roadmap

## Implemented v0 workflow additions

- Claude Code hook and Codex App Server notification mapping bridges, preserving `model-declared` provenance and unknown input gaps.
- Resumable filtered supervisor event queries, CLI `watch`, and VS Code session-log following.
- Redacted supervisor-owned Git diff snapshots used by filesystem-diff contract evidence.
- Versioned standard-rate cost reports, exposed through `agent-contract cost`.
- Trusted detached Git worktree execution with `agent-contract run --isolated` and explicit lifecycle evidence.
- Portable redacted JSON evidence bundles with canonical SHA-256 manifests, CLI export/verify, and VS Code export.

See ADRs 0005 and 0006 for the isolation and bundle boundaries. These additions do not claim a full OS sandbox, process-managed vendor adapter, signed bundle provenance, or hosted CI service.

## Phase 0: Foundation

Outcome: an installable local-first path from both clients to a real trusted supervisor, followed by the smallest useful evidence and finding loop.

Deliver this phase as four independently validated slices:

### Phase 0A: Shared schema and health

- Establish monorepo tooling, docs, TypeScript extension baseline, and ADR template.
- Implement canonical types for session, event, evidence grade, capability, policy decision, and contract verdict.
- Implement a loopback-only structured supervisor health protocol.
- Add only real CLI `doctor` and `supervisor status` commands backed by that endpoint.
- Update the extension connection state to parse and display the same response.

Exit criterion: CLI and extension report one compatible supervisor version and its real zero-adapter capability set.

### Phase 0B: Local lifecycle and trust

- Add explicit supervisor start, foreground, status, and stop behavior.
- Add a per-user process lock, local state paths, authenticated sensitive endpoints, and version negotiation.
- Add user-local CLI workspace trust without allowing repository files to trust themselves.

Exit criterion: the installed CLI manages exactly one authenticated, unprivileged supervisor instance.

### Phase 0C: Live and historical boundary evidence

- Add a trusted generic process runner as `observed-boundary` evidence, without presenting it as a vendor adapter.
- Persist session lifecycle, redacted stdout/stderr chunks, process exit, interruption, and explicit truncation.
- Add resumable CLI watch and exact historical event queries.

Exit criterion: a real local fixture command produces a committed live stream that can be disconnected, resumed, and queried by sequence.

### Phase 0D: First deterministic finding

- Define the fixture repository format and one deterministic path or command rule.
- Persist the compiled ruleset hash, input evidence, decision, and user-facing finding.
- Prove a missing pre-action capability yields `unknown` rather than a prevention claim.

Exit criterion: the CLI resolves one reproducible finding to its retained evidence and one unsupported case to an explicit evidence gap.

Exit criterion: the extension connects to a local supervisor and displays a real health/capability result.

## Phase 1: Effective instruction map

Outcome: explain the repository rules that apply to an active path.

- Move repository instruction discovery and precedence into supervisor-owned logic for a narrow, documented file set.
- Render source path, precedence, content hash, target-path applicability, and evidence grade.
- Add snapshot tests with nested path-specific instructions.

Exit criterion: CLI and VS Code inspect the same reproducible effective-instruction map without invoking an agent.

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

## Phase 4: Investigation and grounded retrieval

Outcome: users can answer workflow questions from retained evidence without turning retrieval into policy.

- Add structured timeline queries over sequence, resources, correlations, decisions, and findings.
- Add FTS indexing over redacted event-aware content chunks with an explicit index watermark.
- Add deterministic evidence briefs for common questions.
- Add optional local model synthesis only after factual claims require resolvable citations.
- Report facts, deterministic findings, contradictions, scope, and evidence gaps separately.

Exit criterion: a workflow question returns an evidence-cited answer or an explicit insufficient-evidence result, and answer generation cannot mutate decisions.

## Phase 5: Second adapter and comparison

Outcome: cross-agent comparisons become meaningful rather than cosmetic.

- Implement Codex adapter and capability conformance suite.
- Pin task, repository snapshot, policy, and comparison metadata.
- Present a capability-aware compare matrix.

Exit criterion: the tool does not compare unsupported dimensions as though they were equal.

## Phase 6: CI and opt-in sharing

Outcome: repeatable repository checks outside an editor.

- Publish CLI and GitHub Action.
- Emit machine-readable summary plus evidence artifact.
- Prototype opt-in hosted report sharing only after privacy/security review.

## Decisions to make through ADRs

- Accept or revise the proposed shared CLI/supervisor runtime and local IPC approach in ADR 0003.
- Canonical schema source and compatibility policy.
- SQLite ledger and content-addressed artifact durability model.
- Policy evaluator choice: TypeScript v0 versus OPA/Rego.
- Worktree-only versus container-backed fixture isolation.
- Evidence bundle archive/signature format.
- Local retrieval model and any remote-provider consent boundary.
- Data retention and any hosted-service boundaries.
