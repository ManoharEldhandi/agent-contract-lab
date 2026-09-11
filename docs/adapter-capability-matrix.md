# Adapter Capability Matrix

This matrix reflects the research completed before repository creation. It is a product-planning baseline, not a promise that every capability has been implemented or independently revalidated at runtime.

| Adapter | Observable events | Instruction provenance | Action interception | Isolation support | First milestone |
| --- | --- | --- | --- | --- | --- |
| Claude Code | Strong: hooks, tool lifecycle, permissions, subagents, worktree/config events, OTel correlation. | Strong: documented `InstructionsLoaded` signal. | Strong hooks; exact enforcement semantics require prototype validation. | Worktree and process orchestration can be supervisor-managed. | First deep adapter. |
| Codex | Strong: JSONL/App Server thread, turn, and item streams. | Strong: `instructionSources` from thread create/resume/fork and documented `AGENTS.md` hierarchy. | Sandbox/approval controls exist; adapter contract needs validation. | Supervisor-managed worktree/container plus Codex sandbox. | Second deep adapter. |
| Cursor | Strong: documented hooks, headless stream, tool/file/MCP/subagent signals. | Needs runtime validation per interface. | Hooks available. | Supervisor-managed. | Third adapter. |
| GitHub Copilot | Tool hooks and instruction support documented. | No confirmed direct instruction-loaded evidence in current research. | Pre/post tool hooks documented. | Supervisor-managed. | Observe-first adapter. |

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
