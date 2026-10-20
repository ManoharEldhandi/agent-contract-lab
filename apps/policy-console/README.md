# Agent Contract Lab Policy Console

From the repository root:

```sh
npm ci
npm run demo:web
```

Open the printed loopback URL. **Run repair** uses a scripted fixture agent with
real supervised actions, refusals, failing/passing tests, and isolated Git
worktrees. The policy editor, action console, workflow controls, knowledge search,
and evidence export use the same application runtime as SDK integrations.

Connected-model mode is enabled only when `AGENT_CONTRACT_MODEL_URL` is configured
in the server environment. Set `AGENT_CONTRACT_MODEL_NAME` and, where required,
`AGENT_CONTRACT_MODEL_API_KEY` there. Keys never belong in browser code. The server
uses HTTPS for remote providers and accepts loopback HTTP for local models.

This private workspace is part of root tests and release checks. Its connected
model test uses a local HTTP provider fixture, not paid model credits. Browser
checks cover a successful run, invalid policies, budget exhaustion/recovery,
manual stage controls, citation retrieval, and 1440/390/320px layouts.

The knowledge view reports its selected local engine: native SQLite FTS5 or the
portable MiniSearch backend. Both preserve bounded source citations and never
participate in authorization.

See [stateful policies](../../docs/runtime-policies.md) for supported controls and
the distinction between deterministic authorization and retrieved guidance.
