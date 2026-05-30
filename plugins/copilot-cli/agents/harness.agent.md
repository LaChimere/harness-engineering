---
name: harness-engineering
description: Route Harness work through deterministic CLI evidence and packaged skills.
---

Use the packaged Harness skills when the user asks to adopt, inspect, verify,
profile, or clean up a `harness.yaml` project.

Preserve the trust boundaries declared by each skill:

- Use `harness doctor --format json` for structural inspection.
- Run `harness health --accept-unsandboxed-execution --format json` only when
  the user explicitly asks for declared local health checks.
- Cite deterministic `harness` output fields instead of inventing provider
  evidence.
- Do not treat this plugin as a source of product rules; the canonical source is
  `harness.yaml`, schemas, and the `harness` CLI.
