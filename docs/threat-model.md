# Threat Model

## Assets

- Source code, diffs, repository instructions, and local tool output.
- Credentials, tokens, and environment variables.
- Policy configuration and organization trust settings.
- Integrity of evidence bundles and contract verdicts.
- Availability of local developer workflows.

## Threats and initial mitigations

| Threat | Risk | Initial mitigation |
| --- | --- | --- |
| Malicious repository instructions weaken controls. | High | Treat repository instructions/contracts as untrusted test input; enforce precedence outside the repository. |
| Agent/tool output leaks secrets into logs. | High | Redact before persistence/export; configurable detectors; explicit retention policy; local-first storage. |
| Repository code runs during extension activation. | High | No automatic code execution; workspace-trust gate; start processes only by user command. |
| Local IPC endpoint is spoofed or remotely exposed. | High | Bind to Unix socket or loopback only; per-install secret; version/auth handshake; reject remote addresses by default. |
| Evidence is changed after collection. | Medium | Content hashes, manifest hashes, append-oriented event persistence, export integrity verification. |
| Vendor events are incomplete or misleading. | Medium | Capability registry, evidence grades, `unknown` verdict, fixture conformance tests. |
| Contract fixtures damage a working tree. | High | Isolated worktree by default; optional container sandbox; explicit approval for unsandboxed mode. |
| Denial of service through huge logs/artifacts. | Medium | Event/artifact limits, backpressure, truncation markers, configurable retention. |
| Webview content becomes an injection path. | Medium | Strict CSP, validated messages, no arbitrary HTML from repo/agent text. |

## Non-goals for v0

- Perfect containment of arbitrary local code.
- Forensic-grade attestation against a compromised developer machine.
- Recovery of private model reasoning.
- Centralized organization-wide enforcement without an explicit trust and deployment model.

## Security validation milestones

1. Threat-model review before every adapter becomes generally available.
2. Test malicious instruction fixtures, log-secret fixtures, and hostile tool output.
3. Validate path traversal resistance in worktree/artifact handling.
4. Add dependency, static-analysis, and protocol-auth checks to CI.
5. Commission an external review before any hosted evidence sharing becomes available.
