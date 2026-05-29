---
name: harness-gc-review
description: Review deterministic GC audit findings without applying cleanup. Use when reviewing deterministic GC audit findings without applying cleanup.
---
---
id: harness-gc-review
purpose: Review deterministic GC audit findings without applying cleanup
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to run or read GC audit evidence and summarize reviewable cleanup slices.

## Invocation

Invoke when the user asks what can be cleaned up, whether evidence is stale, or how to group GC findings for review.

## Steps

1. Run `harness gc audit --format json` unless the user provides an existing GC evidence artifact.
2. Parse top-level `status` and `findings`.
3. If `status` is `passed`, report that no GC findings were emitted.
4. If `status` is `findings`, group findings by `category`, `severity`, and target files.
5. Cite finding evidence paths and explain that findings are reviewable proposals, not applied changes.
6. If the user provides GC evidence, use `harness gc validate <gc-evidence> --format json` to validate it before summarizing.

## Safety

- Do not delete or edit files as part of GC review.
- Do not convert GC `findings` into command failures.
- Do not hand-edit generated evidence.
- Do not add subjective quality scoring or "AI slop" categories.
