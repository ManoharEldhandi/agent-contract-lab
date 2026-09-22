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

See the [project README](https://github.com/ManoharEldhandi/agent-contract-lab)
for the evidence model and security boundaries. Licensed under MIT.
