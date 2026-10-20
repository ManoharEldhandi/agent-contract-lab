# Integration

Start the packaged local supervisor and trust a workspace once before attaching an AI integration:

```sh
agent-contract supervisor start
agent-contract workspace trust .
```

Install `@agent-contract-lab/adapter-sdk` alongside the code that invokes the model. The SDK reads `AGENT_CONTRACT_SUPERVISOR_URL`, `AGENT_CONTRACT_HOME`, and `AGENT_CONTRACT_TOKEN` from the local environment. It accepts only loopback HTTP supervisor URLs, so the local token never belongs in source code.

## Execute Under A Contract

An observation callback cannot prevent an action. For enforcement, expose tools
to the agent that call `executeAction()` instead of performing local I/O:

```ts
import { readFile } from 'node:fs/promises';
import { LocalSupervisorClient } from '@agent-contract-lab/adapter-sdk';

const client = await LocalSupervisorClient.fromLocalEnvironment();
const session = await client.startContractSession({
  workspacePath: process.cwd(),
  actor: 'my-agent',
  contractYaml: await readFile('examples/contracts/source-only.yaml', 'utf8'),
});

const refusal = await session.executeAction({
  kind: 'file.write', path: 'README.md', content: 'Not permitted by this contract.',
});
console.log(refusal.status, refusal.decision.ruleIds);

const result = await session.executeAction({
  kind: 'command', executable: 'node', args: ['--test', 'src/app.test.cjs'],
});
await session.complete(result.success ? 'completed' : 'failed');
```

The default detached worktree contains committed `HEAD`, not uncommitted source
changes or installed dependencies. `isolated: false` explicitly opts into the
trusted source checkout. Actions are serialized within a session; callers receive
`completed`, `failed`, or `blocked` with a correlation ID and policy decision.
Never bypass a refusal by falling back to direct I/O. Do not automatically retry
an action after a transport timeout: its outcome may be unknown to the client.

Supported actions are `command`, `file.read`, and `file.write`. A committed
decision precedes each permitted effect, and missing evidence storage fails
closed. Completion drains queued actions, captures the final Git diff, evaluates
the attached contract, and removes its worktree. File reads/writes are limited to
256 KiB; combined command output is limited to 64 KiB; deadlines are 100 ms to
30 seconds; at most 32 actions may be pending in one session.

Stateful policies additionally support `knowledge.search` and `model.call`.
`session.transitionPhase(name)` requests an allowed workflow transition;
`session.getRuntime()` returns the immutable active policy and live counters.
Runtime policies may tighten the default output/deadline limits. Deadline expiry
actively interrupts sessions. Verification-gated completion remains recoverable
until the session completes or expires. The
[runtime guide](runtime-policies.md) lists all controls and gateway setup.

A committed
policy is never replaced by retrieved guidance, a client usage declaration, or
an editor change. Supply bounded `knowledgeDocuments` when creating the session
to make local runbook context available. Model calls with `knowledgeQuery` consume
both model and knowledge permissions/quotas; usage is retained from the actual
server-owned provider response, not a model's estimate.

Path rules gate explicit file reads and writes. Allowed commands are not
OS-sandboxed and can have effects beyond those tools; their observable Git file
changes are checked afterward. Unobserved, ignored, transient, external, or
ambiguously changed files cannot be claimed as prevented. Native Codex logging
and external event bridges do not automatically route their tools through this
API.

## Optional Model Logger Traces

The latest verified Model Logger source is
[`afb120c8`](https://github.com/ManoharEldhandi/model-worklog/commit/afb120c8cc9fb862c8e76a71ded9c1c04524cd57)
(2026-10-20); the demo pins SDK, schema, and collector `2.1.0`.
Contract Lab adds deterministic control to observable activity rather than
treating a logger as an enforcement boundary.

```ts
import { ModelLoggerTelemetry } from '@agent-contract-lab/adapter-sdk';
import { createLocalModelLogger } from 'model-worklog-sdk';

const logger = await createLocalModelLogger({ projectId: 'contracts', serviceName: 'my-agent' });
const telemetry = new ModelLoggerTelemetry(logger, {
  onTelemetryError: () => console.warn('Optional tracing unavailable.'),
});
const session = await client.startContractSession({
  workspacePath: process.cwd(), actor: 'my-agent', contractYaml, telemetry,
});
```

Use a configured, project-scoped Model Logger writer credential. Collector setup
is application-owned; omit telemetry if optional setup is unavailable. The
strategy never retries or duplicates the guarded operation, and tracer failures
or diagnostic callback failures do not change the supervisor result. It captures
tool metadata and fixed outcome event names, not file contents or tool arguments.
Model Logger spans remain `model-declared`; they never promote evidence grades.

Finish the session, then call `logger.shutdown()` and check its returned delivery
result. An incomplete telemetry delivery must not cause the action to execute
again. Enforcement and its redacted ledger do not depend on Model Logger or a
running collector. `npm run demo` provisions isolated scoped credentials and
verifies the actual collector path without changing personal logger settings.

## Record An AI Run

Create one session for the agent run and report observable activity as it occurs. Plans and reasoning summaries must be provider-visible, high-level text; never submit hidden reasoning or chain-of-thought.

```ts
import { readFile } from 'node:fs/promises';
import { LocalSupervisorClient } from '@agent-contract-lab/adapter-sdk';

const client = await LocalSupervisorClient.fromLocalEnvironment();
const session = await client.startSession({
  workspacePath: process.cwd(),
  actor: 'my-ai-adapter',
  title: 'Fix the failing parser test',
});

await session.userMessage('Fix the test failure.');
await session.plan('Read the failing test and make the smallest repair.', ['Read src/app.ts', 'Run the focused test']);
await session.reasoningSummary('The assertion likely expects an outdated value.');
await session.runTool({ tool: 'read_file', arguments: { path: 'src/app.ts' } }, () => readFile('src/app.ts', 'utf8'));
await session.fileRead({ path: 'src/app.ts', tool: 'read_file' });
await session.commandStarted({ executable: 'npm', args: ['test'] });
await session.commandCompleted({ executable: 'npm', args: ['test'], exitCode: 0 });
await session.fileChanged({ path: 'src/app.ts', operation: 'modified' });
await session.testCompleted({ name: 'npm test', success: true, durationMs: 842 });
await session.complete();
```

`followEvents()` provides the same already-redacted committed timeline to an orchestrator, terminal dashboard, desktop client, or authenticated application backend. Do not expose the local supervisor token to browser code.

```ts
void session.followEvents((event) => {
  appClients.broadcast({ type: 'agent-contract-event', event });
});
```

## Direct Codex Runs

For a supervisor-owned Codex App Server session, use the CLI or VS Code **Log a Codex Task** action:

```sh
agent-contract agent codex "Fix the failing parser test" --model gpt-5.6-terra --max-duration-ms 1800000 --max-tokens 50000
```

This is the direct integration path: documented visible messages, plans, reasoning summaries, commands, output, file changes, and usage updates are retained as `observed-native`. Private raw reasoning is never stored. A contract can be evaluated against the completed session exactly as it can against a managed command or SDK session.

## Token Usage

Pass the completed provider response to `reportProviderUsage()`. It extracts provider-reported usage, source metadata, model, response ID, cache usage, and reasoning-token counts without storing hidden reasoning content.

```ts
const response = await openai.responses.create({ model: 'gpt-5', input: 'Fix the test.' });
const report = await session.reportProviderUsage('openai', response);

if (!report.normalized.ok) {
  console.warn(`Token usage unavailable: ${report.normalized.reason}`);
}
```

Supported built-in formats are OpenAI Responses, OpenAI-compatible Chat Completions, Anthropic Messages, and Gemini GenerateContent:

```ts
await session.reportProviderUsage('anthropic', anthropicMessage);
await session.reportProviderUsage('gemini', geminiResponse);
await session.reportProviderUsage('openai-compatible', gatewayChatCompletion);
```

For a different SDK, gateway, or self-hosted model, declare exactly where that response places its counters. Dot paths are resolved against the response object. Set `cacheTokensAreAdditional: true` only when the provider documents cache fields as additional usage rather than a breakdown included in `inputTokens`.

```ts
await session.reportProviderUsage('auto', gatewayResponse, {
  provider: 'my-local-gateway',
  providerResponseId: 'request.id',
  model: 'metadata.model',
  inputTokens: 'metrics.prompt',
  outputTokens: 'metrics.completion',
  totalTokens: 'metrics.total',
});
```

For streaming APIs, submit the provider's final completed response or terminal cumulative usage event exactly once. If a provider does not expose usage, the SDK records `usage.unavailable` with a reason code. That is intentional: a subprocess runner can observe commands and output but cannot truthfully recover a provider's private billing counters.

All SDK activity is `model-declared`; use `unknown()` with a reason such as `unsupported-capability` or `not-observed` whenever the integration lacks a fact.

## Vendor Event Bridges

The SDK includes mapping bridges for documented Claude Code hook inputs and Codex App Server JSON-RPC notifications. They translate incoming vendor-shaped objects into canonical session events, preserve unknown cases, and can report documented OpenAI token usage from Codex notifications.

```ts
import { ClaudeCodeAdapter, CodexAppServerAdapter } from '@agent-contract-lab/adapter-sdk';

const claude = new ClaudeCodeAdapter(session, { workspacePath: process.cwd() });
await claude.ingestHook(claudeHookPayload);

const codex = new CodexAppServerAdapter(session, { workspacePath: process.cwd() });
await codex.ingestNotification(codexNotification);
```

These are mapping bridges, not supervisor-managed Claude/Codex process adapters. Because the hook or notification arrives through an external SDK client, every emitted vendor fact remains `model-declared`; it is never promoted to `observed-native` merely because the vendor originally documented that signal. Malformed or unmapped input becomes reason-coded `unknown` evidence.

Inspect the result with:

```sh
agent-contract logs <session-id> --format pretty
agent-contract logs <session-id> --format json
agent-contract logs <session-id> --format jsonl
```

Use `agent-contract watch <session-id>` to follow committed events and `agent-contract cost <session-id>` to view a versioned standard-rate calculation for fully mapped provider usage. Exported evidence bundles are additionally path-scrubbed and retain these evidence grades rather than treating an integration declaration as supervisor observation.
