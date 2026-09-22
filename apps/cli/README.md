# @agent-contract-lab/cli

Command-line interface for Agent Contract Lab's local evidence and contract
workflow.

```sh
npm install -g @agent-contract-lab/cli
agent-contract supervisor start
agent-contract workspace trust .
agent-contract sessions list
```

Use `agent-contract agent codex "Fix the failing test"` to record a
supervisor-managed Codex run, `agent-contract logs <session-id>` to review
its redacted evidence, and `agent-contract export <session-id>` to create a
portable evidence bundle. The supervisor only accepts loopback HTTP
connections and requires an explicit workspace-trust record before it starts a
managed command.

See the [project README](https://github.com/ManoharEldhandi/agent-contract-lab)
for installation, policy, and integration guidance. Licensed under MIT.
