---
id: harness-evidence-loop
purpose: Sequence explicit Harness evidence commands safely
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to orchestrate a safe evidence-gathering loop over existing Harness commands without creating a new aggregate command or bypassing user approval.

## Invocation

Invoke when the user asks for a full Harness evidence pass, pre-merge evidence, or a readiness loop across structural, health, assessment, GC, trace, verify, or eval evidence.

## Steps

1. Start with `harness doctor --format json` and stop if structural status is `failed`.
2. Run `harness assess --format json` to identify which evidence is missing or stale.
3. Run `harness gc audit --format json` when cleanup findings are requested; summarize `findings` without applying cleanup.
4. Run `harness trace validate --format json` when traces are present or requested; cite failed trace issues.
5. Run `harness verify --spec <self-verification>` only when the user provides self-verification evidence to validate.
6. Before `harness eval validate --format json`, get explicit user approval because eval validation can execute verifier commands; run it only when verifier-only eval validation is needed and the verifier trust declaration is acceptable.
7. Before `harness health --accept-unsandboxed-execution --format json`, get explicit user approval because health executes declared local commands.
8. If continuity evidence is in scope, use `harness loop validate --phase start --continuity <continuity-state>` for startup validation or `harness loop validate --continuity <continuity-state> --verification <self-verification>` for completion validation; do not invent an aggregate execution command.

## Safety

- Stop before local command execution, mutation, or provider/model spend unless the user explicitly approves.
- Do not hand-edit generated evidence.
- Do not apply GC cleanup; summarize reviewable slices only.
- Do not infer missing evidence from chat when CLI JSON can be produced or inspected.
