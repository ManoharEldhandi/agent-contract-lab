# Evidence Model

## Principle

The platform reports observable evidence, deterministic derivations, and explicit uncertainty. It does not report hidden chain-of-thought, unsupported intent, or causal claims that an adapter cannot prove.

## Evidence grades

| Grade | Meaning | Example |
| --- | --- | --- |
| `observed-native` | Vendor emitted the fact directly through a documented/native surface. | Claude reports an instruction file load. |
| `observed-boundary` | Supervisor observed the behavior at a process, hook, filesystem, or tool boundary. | A command hook reports `npm test`. |
| `computed` | Deterministically derived from retained evidence. | A changed path violates an allowed-glob rule. |
| `model-declared` | Adapter/client declared the fact, but the supervisor cannot independently prove it. | A client-reported model identifier. |
| `unknown` | The platform lacks sufficient evidence. | Whether Copilot loaded a specific instruction file where no native signal exists. |

## Verdict semantics

- **pass:** All required assertions have sufficient supporting evidence and none fail.
- **fail:** At least one assertion has sufficient contradictory evidence.
- **unknown:** Required evidence was absent, ambiguous, redacted, or unsupported by the adapter.

`unknown` is a useful result. It distinguishes a policy failure from an integration capability gap.

Every unknown result includes at least one reason: unsupported capability, qualifying evidence not observed, redacted evidence, truncation, retention, adapter error, integrity failure, timeout, or ambiguity. An evaluator that does not implement a rule rejects that rule before execution rather than returning unknown.

## Claim rules

- “Followed instruction X” requires a direct vendor signal or an explicitly scoped behavioral assertion, never only a successful output.
- “Ran required test Y” requires a retained process/tool event or command result.
- “Changed only allowed files” requires snapshot/diff evidence.
- “Agent intended Z” is out of scope unless an adapter carries an explicit, separately graded declaration.
- `observed-boundary` proves that an action or effect occurred at the monitored boundary. It does not prove the agent noticed the result, understood it, or acted because of an instruction.
- Repeated commands and tests remain separate evidence. Assertions must state whether any, latest, or all matching results determine the outcome.
- Rules declare acceptable evidence grades explicitly. `model-declared` cannot satisfy a high-risk built-in rule and is never silently promoted to native or boundary observation.

## Evidence bundle

A portable bundle contains a manifest, redaction policy version, capability declaration, normalized event stream, instruction-resolution snapshot, policy decisions, contract verdicts, diff/test artifacts, and hashes for every retained object. Default format details are deferred to an ADR, but the bundle must be inspectable without a hosted service.

## Caching and retrieval

Context cache keys include repository commit/content hash, target paths, policy hash, adapter and client versions, and retrieval corpus revision. Cached content is always labeled as cached and cannot override live authoritative evidence.
