# Stateful Agent Policies

## Run The Product

```sh
npm ci
npm run demo:web
```

Open the printed loopback URL, normally `http://127.0.0.1:43280`. The console
includes live workflow permissions, resource counters, a decision timeline,
retained evidence, an action form, policy editing, and cited knowledge search.
The default fixture agent is explicitly scripted; its files, processes, tests,
refusals, worktrees, and evidence are real. No model account is required.

The fixture attempts early writes and commands, reads the source, exhausts a
failing verification retry, returns through an approved repair transition, and
passes real tests. Review-only and tight-budget presets deliberately prevent
parts of that task. Saving a policy affects the next session, never the active
immutable policy. A reset creates a fresh isolated worktree.

## Core Controls

- **Tools by workflow stage:** `runtime.phases[].tools` restricts commands,
  file reads/writes, model calls, and knowledge search. Successful-tool
  prerequisites gate transitions. Default transitions are forward-only;
  `next` explicitly permits a repair loop or another allowed transition.
- **Time:** `maxDurationMs` actively interrupts expired sessions.
  `maxActionDurationMs` clamps process/model deadlines even when a caller
  requests more time. Approved command process groups are terminated on timeout.
- **Tokens:** `maxTokens` caps conservative admission charges for supervised
  model requests. The server computes reservations, not the caller. Actual
  provider usage is retained separately; unknown usage blocks more model calls
  under a token budget. Reservations are not exact token counts or invoices.
- **Retries:** `maxRetries` limits retries of a canonical logical request at the
  same write revision. Changing a transport timeout does not reset it. A repair
  creates a new verification opportunity, still bounded by global budgets.

## Ten Additional Restrictions

| # | Restriction | Policy Field | Enforced Behavior |
| --- | --- | --- | --- |
| 1 | Total action budget | `limits.maxActions` | Refuse new admitted actions when the session budget is exhausted. |
| 2 | Per-tool quotas | `toolQuotas` | Bound each tool independently; a grounded model call also consumes a knowledge quota. |
| 3 | Action rate | `limits.maxActionsPerWindow`, `windowMs` | Refuse bursts within a rolling time window. |
| 4 | Failure circuit breaker | `limits.maxConsecutiveFailures` | Stop tool execution after repeated consecutive failures. |
| 5 | File-change breadth | `limits.maxChangedFiles` | Limit distinct paths touched by explicit supervised writes. |
| 6 | Write volume | `limits.maxWriteBytes` | Limit aggregate UTF-8 bytes admitted for supervised writes. |
| 7 | Output volume | `limits.maxOutputBytes` | Bound retained file/process/model text and retrieved excerpts, including multibyte text. |
| 8 | Read before write | `requireReadBeforeWrite` | Require a successful supervisor-owned read before an explicit write to that path. |
| 9 | Model allowlist | `allowedModels` | Refuse unapproved requested model identifiers; provider endpoints remain server-configured. |
| 10 | Current verification | `requireVerificationBeforeComplete` | Refuse completion unless a configured successful command verified the current write revision. |

These fields live under `runtime`; see the complete
[staged contract](../examples/contracts/staged-agent.yaml). Existing path and
command allow/deny rules remain active in every stage. Unknown fields, undefined
transition targets, invalid limits, and malformed input are rejected.

Counts describe admitted attempts, not only successful effects. Failed writes may
have partial effects, so write/file allowances are charged conservatively.
Blocked proposals do not consume execution quotas. Success resets the consecutive
failure circuit; historical failures remain in the evidence.

## Connect A Model

The built-in gateway supports an OpenAI-compatible chat-completions endpoint.
Configure it only in the server environment:

```sh
export AGENT_CONTRACT_MODEL_URL='http://127.0.0.1:11434/v1/chat/completions'
export AGENT_CONTRACT_MODEL_NAME='your-installed-model'
npm run demo:web
```

For an authenticated provider, set `AGENT_CONTRACT_MODEL_API_KEY` in the server
environment. Remote endpoints require HTTPS. Credentials and endpoint overrides
are never accepted from browser action requests or stored in the client.
The connected-model mode requests a bounded JSON repair, routes it through the
same supervised write policy, and runs real tests. Invalid, unapproved, or
non-passing model output is a visible failure, not replaced with a scripted fix.

The gateway sends the requested output cap and uses a conservative prompt/output
reservation. Provider tokenization and billing remain provider-owned; this is
not an OS-wide or invoice-level hard spend guarantee. Unexpected higher reported
usage increases the charge and prevents later over-budget calls. No absent usage
is manufactured. Failed requests and unknown delivery outcomes must not be
blindly retried.

## Local Retrieval And RAG

The local index uses SQLite FTS5 when available and a maintained MiniSearch
backend on runtimes without FTS5, including Node 22.13. Results report the actual
engine. Both index bounded, redacted policy/runbook chunks locally and return
stable source IDs, indexed-chunk SHA-256 hashes, source provenance, excerpts, and
query timings. Agent knowledge searches use the normal phase/quotas pipeline.
Model calls with `knowledgeQuery` retrieve cited reference data before invoking
the configured provider and require both model and knowledge permissions.

The console's operator search is a separate read-only preview. It does not spend
agent quotas or change decisions. Retrieved documents are untrusted data and
cannot authorize tools, change budgets, or replace the pinned policy.

Retrieval makes relevant guidance cheap to find and explanations grounded. It
does not make authorization probabilistic or replace the already-small
deterministic decision path. Current retrieval is lexical, not an embedding or
semantic-search service; no-match results remain explicit. Truncated excerpts
retain their original indexed-chunk hash and an explicit truncation marker.

## Integration

```ts
const session = await client.startContractSession({
  workspacePath: process.cwd(),
  actor: 'my-agent',
  contractYaml,
  knowledgeDocuments: [{ source: 'runbook://tests', title: 'Tests', content: 'Verify the current revision.' }],
});

await session.executeAction({ kind: 'file.read', path: 'src/app.ts' });
const transition = await session.transitionPhase('edit');
const snapshot = await session.getRuntime();
```

Phase transitions, decisions, usage, snapshots, and effects are retained with
correlations. A failed completion gate leaves the session open for recovery.
Deadline expiration and cancellation interrupt the run. Evidence export includes
the pinned contract, decisions, runtime snapshots, and retained source citations.

## Boundaries

These controls apply to supervisor-routed actions. Plain process launch guards
and native Codex observation explicitly reject stateful policies rather than
silently downgrade them. Worktrees are not OS sandboxes: approved programs can
access network/external files or spawn children. Path and write-volume quotas
cannot preempt every internal effect of an approved command; final Git snapshots
provide additional observed checks, not universal prevention.

The web console exposes only its temporary sample workspace, not an arbitrary
browser-selected filesystem path. Its API checks the exact Host and browser
Origin and exposes no supervisor/provider tokens. Temporary worktrees and stores
are removed on shutdown; downloading a bundle explicitly retains a redacted copy.
