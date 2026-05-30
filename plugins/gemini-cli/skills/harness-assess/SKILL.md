---
name: harness-assess
description: Use when assessing harness evidence and routing repair actions through deterministic CLI outputs.
---
---
id: harness-assess
purpose: Summarize harness maturity and implementation routing from existing evidence
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to summarize current Harness maturity, missing primitives, recommendations, and implementation routing from existing schema-backed evidence.

## Invocation

Invoke when the user asks what is missing, whether the repository is ready for agent workflows, or which Harness primitive should be implemented next. If structural validity is unknown, run or request `harness doctor --format json` first and use assessment only after doctor evidence is available or the user explicitly asks for maturity scoring.

## Steps

1. If no doctor JSON has been produced or provided in this turn and structural readiness is part of the question, run `harness doctor --format json` first.
2. Run `harness assess --format json` with any user-provided evidence paths.
3. Use the doctor result alongside the assessment output when explaining structural readiness; do not imply `harness assess` consumed the in-turn doctor JSON unless it was explicitly supplied as an artifact.
4. Parse `status`, `maturity`, `scorecard`, `missing_primitives`, `recommendations`, and `implementation_routing`.
5. Cite the `artifacts_read` list and the scorecard entries that support the conclusion.
6. Keep product gaps in `missing_primitives` and `recommendations`; do not reclassify them as command failures.
7. If assessment needs health, eval, trace, or GC evidence that does not exist yet, ask before running consequential commands.

## Safety

- Do not infer readiness from chat; use assessment JSON evidence.
- Do not use assessment as the first diagnostic for schema or reference failures when doctor evidence can be produced.
- Do not mutate files while assessing.
- Do not hand-edit generated evidence.
- Do not treat recommendations as automatic approval to perform changes.
