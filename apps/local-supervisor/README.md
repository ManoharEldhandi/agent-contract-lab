# @agent-contract-lab/local-supervisor

Local, loopback-only evidence store and trusted runtime for Agent Contract Lab.

```sh
npm install -g @agent-contract-lab/local-supervisor
agent-contract-supervisor
```

The supervisor creates a local credential and stores redacted state under
`~/.agent-contract-lab` by default. Set `AGENT_CONTRACT_HOME` to choose a
different local state directory. Use the
[`@agent-contract-lab/cli`](https://www.npmjs.com/package/@agent-contract-lab/cli)
or
[`@agent-contract-lab/adapter-sdk`](https://www.npmjs.com/package/@agent-contract-lab/adapter-sdk)
for normal operation; do not expose the local credential to browser code.

Contract sessions attach an immutable YAML policy and default to detached Git
worktrees. Their authenticated action API executes bounded commands, reads, and
writes only after retaining a correlated policy decision. Completion drains work,
captures a Git snapshot, evaluates the contract, and cleans up the worktree.
Managed command launch guards are a narrower, separately labeled scope.

Worktrees are not OS sandboxes. Approved commands can access the network and
external files, and their children are not individually intercepted. Model Logger
is optional integration infrastructure, not a supervisor dependency or trust boundary.

See the [project README](https://github.com/ManoharEldhandi/agent-contract-lab)
for the evidence model and security boundaries. Licensed under MIT.
