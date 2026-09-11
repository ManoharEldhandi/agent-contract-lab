# VS Code Extension Architecture

## Role

The extension is the primary local user interface for Agent Contract Lab. It is designed for inspection and action during normal development, while the local supervisor remains responsible for trusted execution and durable evidence.

## v0 user experience

The Activity Bar contributes an **Agent Contracts** container with four views:

- **Session:** supervisor connection state and monitored-run controls.
- **Effective Instructions:** instruction files and precedence for the active target path.
- **Policies:** active deterministic policies and recent decisions.
- **Contracts:** available contract suites and latest run verdicts.

The first release favors native Tree Views for scanning and a WebviewPanel for a detailed run report. This keeps startup fast and avoids a dashboard-shaped extension before the evidence model exists.

## Commands

- `Agent Contract Lab: Start Monitored Run`
- `Agent Contract Lab: Connect Local Supervisor`
- `Agent Contract Lab: Open Effective Instructions`
- `Agent Contract Lab: Run Contract Suite`
- `Agent Contract Lab: Explain Selected Evidence`
- `Agent Contract Lab: Compare Agent Runs`
- `Agent Contract Lab: Export Evidence Bundle`

Commands are initially registered but only the connection and instruction-map interactions are implemented in the scaffold. The others stay visibly planned rather than pretending to perform unimplemented governance.

## Extension-host responsibilities

- Detect workspace folders and workspace-trust state.
- Start or connect to the local supervisor only after user command and trust confirmation.
- Register commands, tree data providers, and an output channel.
- Pass sanitized workspace metadata and explicit user intent to the supervisor.
- Render supervisor-provided evidence, not independently reconstructed conclusions.
- Tear down subscriptions and client connections on deactivation.

## Supervisor protocol

The extension will talk to a localhost or Unix-domain-socket endpoint, selected by the supervisor. v0 protocol needs:

```text
GET  /health                 -> supervisor version and availability
POST /sessions               -> create monitored session
GET  /workspaces/{id}/rules  -> effective instruction map
GET  /sessions/{id}/events   -> ordered canonical events
POST /contracts/run          -> launch an isolated contract suite
GET  /reports/{id}           -> report and evidence references
```

The protocol will include a version header and a per-installation authenticated token. It must reject unexpected remote endpoints by default.

## Security and workspace trust

- The extension checks `vscode.workspace.isTrusted` before starting local agent processes or a supervisor for a workspace.
- Viewing stored local reports can remain available in restricted mode if no workspace code executes.
- Secrets live in VS Code `SecretStorage` or the OS keychain, never in workspace settings or evidence bundles.
- Webviews use strict Content Security Policy, `asWebviewUri` for local assets, and message validation at both ends.
- The extension makes no claim that its own process isolates untrusted repository code.

## Remote environments

Local/remote split is a deliberate design concern. In SSH, dev containers, and Codespaces, the repository and agent may execute remotely while the UI runs locally. v0 detects `vscode.env.remoteName` and reports that remote monitoring requires an installed supervisor at the execution location. Do not silently send repository data back to the local machine.

## Packaging plan

- TypeScript extension bundled with esbuild.
- Stable VS Code APIs only; no proposed API dependency.
- Publish as a pre-release extension until two adapter integrations and the evidence format stabilize.
- Retain a minimal activation footprint through `onCommand` and view activation events.
