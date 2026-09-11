# ADR 0001: The extension is not the trust boundary

- Status: accepted
- Date: 2026-09-11

## Context

The product needs a convenient VS Code experience and also needs local CLI, CI, and multiple-agent integrations. Extension-host code has editor lifecycle limits, runs in a developer environment, and cannot be the only place that makes or records governance decisions.

## Decision

Use the VS Code extension as a UI/control-plane client of a local supervisor. The supervisor owns normalized evidence, policy decisions, redaction, local persistence, adapter lifecycle, and isolated run orchestration.

## Consequences

- The initial repository has a little more structure than an extension-only product.
- CLI and CI can use the same supervisor APIs.
- A future hosted service remains optional and does not receive repository data by default.
- Extension screens must clearly distinguish supervisor-reported evidence from local UI state.
