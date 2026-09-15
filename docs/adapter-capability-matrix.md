# Adapter Capability Matrix

This matrix reflects the research completed before repository creation. It is a product-planning baseline, not a promise that every capability has been implemented or independently revalidated at runtime.

The v0 SDK ships tested mapping bridges for incoming Claude Code hook and Codex App Server notification objects. The bridges do not launch, attach to, or enforce either vendor runtime. Since they receive input through an external SDK client, their mapped events are `model-declared`; malformed and unsupported inputs are explicit `unknown` events. A later supervisor-managed adapter may earn a higher grade only when its observation surface justifies it.

| Adapter | Observable events | Token usage | Instruction provenance | Action interception | Isolation support | First milestone |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Incoming hook mapping bridge delivered; deeper process adapter planned. | `unknown` in generic process mode; an adapter that owns Anthropic Messages responses can use the SDK normalizer. | `InstructionsLoaded` is mapped when supplied; bridge grade remains `model-declared`. | Strong hooks; exact enforcement semantics require prototype validation. | Supervisor-managed Git worktree delivered; process isolation remains planned. | First deep adapter. |
| Codex | Incoming App Server notification mapping bridge delivered; deeper process adapter planned. | OpenAI usage is normalized when a token usage notification is supplied; generic process mode remains `unknown`. | Documented fields can be mapped when supplied; bridge grade remains `model-declared`. | Sandbox/approval controls exist; adapter contract needs validation. | Supervisor-managed Git worktree delivered; Codex sandbox integration planned. | Second deep adapter. |
| Cursor | Strong: documented hooks, headless stream, tool/file/MCP/subagent signals. | `unknown` until a documented usage field is integrated; custom SDK mapping supports exposed counters. | Needs runtime validation per interface. | Hooks available. | Supervisor-managed. | Third adapter. |
| GitHub Copilot | Tool hooks and instruction support documented. | `unknown` until a supported integration exposes provider usage; the SDK does not infer billing data. | No confirmed direct instruction-loaded evidence in current research. | Pre/post tool hooks documented. | Supervisor-managed. | Observe-first adapter. |

## Adapter SDK contract

Every adapter implements:

- Identity and version reporting.
- A static capability declaration.
- Session start/attach/stop operations where supported.
- Canonical event emission with source metadata.
- Instruction-resolution import where supported.
- Normalized errors and unsupported-capability results.
- Fixture-based conformance tests.

Capability declarations are data, not marketing. The UI and verifier use them to decide whether a requested assertion can pass, fail, or must be unknown.

## Vendor documentation

Implementation work must pin current vendor documentation and integration versions in the adapter test fixtures. Useful official sources include:

- Claude Code hooks and OpenTelemetry documentation from Anthropic.
- Codex CLI, `AGENTS.md`, hooks, and App Server documentation from OpenAI.
- Cursor documentation paths discovered from its published `llms.txt` index.
- GitHub Copilot custom-instructions and hooks documentation from GitHub Docs.
