---
id: harness-health
purpose: Run declared local project health checks with explicit user intent
invocation_policy: explicit-user-intent
requires_approval: true
version: 1.0.0
---

## Purpose

Use this skill to run and interpret declared local project health checks from `harness.yaml`.

## Invocation

Invoke only when the user explicitly asks to run health checks or confirms that local commands may execute. Health checks can run repository-defined commands and therefore require explicit user intent.

## Steps

1. Confirm the user wants to execute declared local health commands.
2. Run `harness health --accept-unsandboxed-execution --format json`.
3. Parse the JSON `status`, `issues`, `sandbox_enforcement`, `runtime_enforced`, and `checks`.
4. For failed or refused checks, cite check `id`, `failure_code`, `summary`, and evidence links.
5. Recommend changes to declarations or project commands only from the health result evidence.

## Safety

- Do not run health checks without explicit user intent.
- Do not claim runtime sandbox enforcement beyond the JSON fields reported by the CLI.
- Do not hand-edit generated evidence.
- Do not run provider/model APIs or commands outside the declared health checks.
