# ADR 0002: Deterministic policy is separate from retrieval

- Status: accepted
- Date: 2026-09-11

## Context

The product will use retrieval over instructions, traces, reports, and vendor documentation. Retrieval quality, model availability, and natural-language ambiguity make it unsuitable for a runtime allow/deny authority.

## Decision

Hard policy and contract verdicts are produced from versioned deterministic rules and retained evidence. RAG/CAG may retrieve context, explain a decision, identify potentially relevant evidence, and support human audits. It cannot override or make a hard enforcement decision.

## Consequences

- Policy outcomes are reproducible and testable.
- Explanations can improve without altering runtime control behavior.
- Any semantic audit feature must be labeled advisory and evidence-graded.
