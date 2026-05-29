---
id: harness-doctor
purpose: Run and interpret harness doctor structural inspection
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to inspect Harness structure, schema compatibility, composed references, builtin registrations, and local-check declarations with deterministic CLI evidence.

## Invocation

Invoke when the user asks whether the harness configuration is valid for agent consumption, when a command reports schema or reference problems, or before a larger Harness workflow needs structural confidence.

## Steps

1. Run `harness doctor --format json`.
2. Parse the JSON `status`.
3. If `status` is `passed`, report that structural inspection passed and cite relevant `checks`.
4. If `status` is `warning` or `failed`, cite `issues` and the failing entries from `checks`.
5. Recommend fixes only from the doctor `remediation` and evidence paths; do not invent new product rules.

## Safety

- Use `harness doctor --format json` for agent-facing structural inspection.
- Do not infer structure from chat or filenames alone.
- Do not hand-edit generated evidence.
- Do not treat skipped local doctor checks as executed local commands.
