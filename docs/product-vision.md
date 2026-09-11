# Product Vision

## Working name

**Agent Contract Lab** is a local-first developer platform that makes AI coding-agent behavior observable, testable, and comparable against the rules a repository actually intends to enforce.

## The problem

Teams increasingly use coding agents in repositories that contain `AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, path-specific rules, contribution guides, scripts, and security requirements. Today, a team cannot reliably answer:

- Which instructions were effective for this task and path?
- Which tools, files, commands, subagents, and tests did the agent use?
- Did the agent stay in scope and follow non-negotiable repository rules?
- Does the same instruction set work across agent vendors and versions?
- Can a changed instruction be proven to work before it reaches the default branch?

Static instruction linting can catch malformed or contradictory text. It cannot prove how an agent behaved in a real, isolated task.

## Product promise

For a monitored agent run, Agent Contract Lab produces an evidence bundle that connects:

```text
Repository snapshot -> effective instructions -> agent events -> proposed actions
-> deterministic policy decisions -> observable effects -> contract verdict
```

The product never claims access to hidden model reasoning. Every assertion is marked with its evidence grade.

## Primary users

- Platform engineers maintaining repository standards for AI-assisted development.
- Tech leads who need lightweight, reviewable agent controls without buying an enterprise surveillance product.
- Open-source maintainers who need reproducible agent contributions.
- Developers who want to debug why a coding agent ignored, misunderstood, or over-applied instructions.

## Initial wedge

Start with **instruction contract testing for local coding-agent runs**:

1. Select a repository and agent adapter.
2. Resolve the instruction set effective for a target task/path.
3. Run a fixture task in an isolated worktree.
4. Collect normalized events and filesystem/test evidence.
5. Evaluate deterministic policies and contract assertions.
6. Render an evidence-backed report in VS Code and export it for CI.

The first deeply supported adapters should be Claude Code and Codex because they expose stronger documented event and instruction-source surfaces. Cursor and Copilot begin as capability-limited adapters with transparent evidence grades.

## What this is not

- Not a generic chat log viewer.
- Not a static markdown linter.
- Not a cloud-first employee-monitoring tool.
- Not an AI model safety classifier used for hard allow/deny decisions.
- Not a claim of universal vendor visibility or instruction causality.

## Product surfaces

- **VS Code extension:** primary daily interface for local developers.
- **Local supervisor:** trusted local runtime for collection, policy, redaction, storage, and process orchestration.
- **CLI:** headless runs, exports, fixtures, and automation.
- **GitHub Action:** pull-request contract checks and artifact publication.
- **Optional hosted service:** opt-in collaboration, organization policies, report sharing, and aggregate comparison data.

## Success criteria for v1

- A developer can see the effective instruction map for the current workspace and target path.
- A developer can launch or attach to one supported agent run from VS Code.
- The tool records a normalized timeline with evidence grades and stable correlation IDs.
- A repository can define deterministic assertions such as allowed paths, mandatory test commands, and forbidden commands.
- A fixture run produces a pass/fail/unknown report and an exportable evidence bundle.
- The result remains usable locally with no required account or data upload.
