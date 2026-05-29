---
id: harness-assess
purpose: Summarize harness maturity and implementation routing from existing evidence
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to summarize current Harness maturity, missing primitives, recommendations, and implementation routing from existing schema-backed evidence.

## Invocation

Invoke when the user asks what is missing, whether the repository is ready for agent workflows, or which Harness primitive should be implemented next.

## Steps

1. Run `harness assess --format json` with any user-provided evidence paths.
2. Parse `status`, `maturity`, `scorecard`, `missing_primitives`, `recommendations`, and `implementation_routing`.
3. Cite the `artifacts_read` list and the scorecard entries that support the conclusion.
4. Keep product gaps in `missing_primitives` and `recommendations`; do not reclassify them as command failures.
5. If assessment needs health, eval, trace, or GC evidence that does not exist yet, ask before running consequential commands.

## Safety

- Do not infer readiness from chat; use assessment JSON evidence.
- Do not mutate files while assessing.
- Do not hand-edit generated evidence.
- Do not treat recommendations as automatic approval to perform changes.
