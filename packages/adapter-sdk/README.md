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

Use `session.followEvents(listener)` to feed the already-redacted committed
timeline to an authenticated dashboard, orchestrator, or application backend.
Never send the local supervisor credential or private reasoning to browser
code.

See the [integration guide](https://github.com/ManoharEldhandi/agent-contract-lab/blob/main/docs/integration.md).
Licensed under MIT.
