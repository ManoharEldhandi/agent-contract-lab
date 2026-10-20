# @agent-contract-lab/adapter-sdk

Local integration SDK for recording visible AI activity in Agent Contract Lab.
It communicates only with a loopback HTTP supervisor using its local
credential.

```sh
npm install @agent-contract-lab/adapter-sdk
```

Create a `LocalSupervisorClient`, start a session with a concise title, and
report user-visible messages, plans, safe summaries, tools, commands, files,
tests, and provider usage. `runTool()` records a correlated start/completion
pair around a promise. SDK-originated facts remain `model-declared`; only a
supervisor-owned vendor relay can record `observed-native` events.

For controlled execution, use `client.startContractSession({ workspacePath,
actor, contractYaml })` and `session.executeAction(...)`. These methods request
supervisor-owned commands, reads, and writes rather than running local callbacks.
Contract sessions default to detached Git worktrees. Actions return a correlated
`completed`, `failed`, or `blocked` result. Never bypass a refusal or automatically
retry an action whose transport outcome is unknown.

`ModelLoggerTelemetry` accepts a compatible Model Logger instance as an optional
strategy. It records metadata-only tool spans and fixed outcome events without
capturing arguments or file content. Telemetry failures never replay the action
or replace its authoritative result. The SDK itself has no Model Logger runtime
dependency; the source demo tests published Model Logger 2.1.0.

Use `session.followEvents(listener)` to feed the already-redacted committed
timeline to an authenticated dashboard, orchestrator, or application backend.
Never send the local supervisor credential or private reasoning to browser
code.

See the [integration guide](https://github.com/ManoharEldhandi/agent-contract-lab/blob/main/docs/integration.md).
Licensed under MIT.
