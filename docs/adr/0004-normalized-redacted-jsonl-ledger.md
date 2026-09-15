# ADR 0004: Normalized redacted JSONL ledger for v0

- Status: accepted
- Date: 2026-09-15

## Context

The first release needs inspectable local evidence before a SQLite artifact store, migration system, and stream cursor protocol are complete. Persisting raw terminal logs first and attempting redaction later would violate the privacy boundary. Allowing two supervisors to write the same store would also make sequence-based evidence unreliable.

## Decision

Use a user-local, supervisor-owned ledger for v0:

- A session summary is stored as JSON and its canonical events as append-only JSONL.
- The supervisor validates, redacts, and assigns an increasing session sequence before every append.
- The store contains a workspace label and SHA-256 fingerprint, never its persisted absolute path.
- A user-local exclusive lock prevents concurrent supervisors from writing one evidence directory. A stale lock is not deleted automatically because safe recovery needs a stronger OS-level identity primitive.
- Completed sessions permit only additional computed `policy.decision` events. Other late events are rejected.
- Token totals are stored only when an integration reports them. Otherwise the session retains a reason-coded `unknown` usage event.

This is not the rejected raw-JSONL alternative in ADR 0003: raw process output never reaches the ledger, and the supervisor remains the only writer and redaction boundary.

## Consequences

- Evidence is readable with standard local tooling and works without a database dependency.
- Current clients retrieve retained history with exact sequence ordering. Resumable live streams, SQLite transactions, content-addressed artifacts, export manifests, and migration tooling remain separate milestones.
- Operators must explicitly resolve a stale lock after confirming no supervisor owns the directory.
- Moving to SQLite requires an import path that preserves existing event IDs, sequences, grades, and redaction metadata.