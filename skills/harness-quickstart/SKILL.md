---
id: harness-quickstart
purpose: Guide initial harness setup and first evidence-backed inspection
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to help a repository adopt Harness from a clean starting point and produce the first deterministic inspection evidence.

## Invocation

Invoke when the user asks to initialize Harness, bootstrap a harness baseline, or understand the first commands to run in a new checkout. If any command would create or modify files, get explicit user approval first.

## Steps

1. Confirm whether the repository already has `harness.yaml`.
2. If initialization is needed, ask for approval before running `harness init`.
3. Run `harness doctor --format json` after initialization or when an existing harness is present.
4. Parse the JSON `status`, `issues`, and `checks` fields.
5. Explain the smallest next repository action using the cited doctor evidence.
6. If the user wants a broader readiness view, run `harness assess --format json` and cite its `status`, scorecard entries, and recommendations.

## Safety

- Do not run `harness init` without explicit user approval because it writes files.
- Do not infer harness state from chat; inspect the repository and run the CLI.
- Use `harness doctor --format json` for agent-facing structural inspection; do not substitute the human-facing validation command unless the user explicitly asks for it.
- Do not hand-edit generated evidence.
- Do not call provider/model APIs or suggest that Harness executed a model.
