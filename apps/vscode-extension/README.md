# Agent Contract Lab for VS Code

Inspect local AI-agent evidence without sending workspace data to a hosted service.

Start `agent-contract-supervisor` locally, open a trusted workspace, then use the **Agent Contracts** Activity Bar view to connect. The Session view can trust the workspace, launch a monitored command from an explicit JSON argument array, list retained sessions, open a redacted event timeline, and evaluate a YAML contract against retained evidence.

The extension connects only to the loopback supervisor URL configured by `agent-contract-lab.supervisorUrl`. It does not start repository code during activation. The supervisor independently requires an explicit workspace-trust record before it launches a command.

The timeline shows evidence grades and structured payloads. It can show a model-provided safe summary, but never claims access to private model reasoning. Token totals are shown only when an integration reports them.
