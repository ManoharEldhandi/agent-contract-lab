# @agent-contract-lab/event-schema

Versioned TypeScript types and runtime validators for Agent Contract Lab
sessions, events, evidence grades, policy results, and supervisor health
responses.

```sh
npm install @agent-contract-lab/event-schema
```

Use it when building an adapter, client, dashboard, or reader that must
validate retained evidence before trusting it. The schema deliberately models
missing or unsupported facts as reason-coded evidence gaps rather than
inventing a result.

See the [project README](https://github.com/ManoharEldhandi/agent-contract-lab).
Licensed under MIT.
