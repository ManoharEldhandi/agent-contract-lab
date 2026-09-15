# Integration

Run the local supervisor and trust a workspace once before attaching an AI integration:

```sh
agent-contract-supervisor
agent-contract workspace trust .
```

Install `@agent-contract-lab/adapter-sdk` alongside the code that invokes the model. The SDK reads `AGENT_CONTRACT_SUPERVISOR_URL`, `AGENT_CONTRACT_HOME`, and `AGENT_CONTRACT_TOKEN` from the local environment. It accepts only loopback HTTP(S) supervisor URLs, so the local token never belongs in source code.

## Record An AI Run

Create one session for the agent run and report observable activity as it occurs. `summary()` is only for a user-visible summary, never hidden reasoning or chain-of-thought.

```ts
import { LocalSupervisorClient } from '@agent-contract-lab/adapter-sdk';

const client = await LocalSupervisorClient.fromLocalEnvironment();
const session = await client.startSession({
  workspacePath: process.cwd(),
  actor: 'my-ai-adapter',
});

await session.message('I will inspect the test failure.');
await session.summary('Read the failing test and selected a targeted repair.');
await session.toolCalled({ tool: 'read_file', arguments: { path: 'src/app.ts' } });
await session.toolCompleted({ tool: 'read_file', success: true });
await session.commandStarted({ executable: 'npm', args: ['test'] });
await session.commandCompleted({ executable: 'npm', args: ['test'], exitCode: 0 });
await session.fileChanged({ path: 'src/app.ts', operation: 'modified' });
await session.testCompleted({ name: 'npm test', success: true, durationMs: 842 });
await session.complete();
```

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