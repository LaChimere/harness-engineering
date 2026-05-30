---
name: harness-profile
description: Use when producing deterministic handoff profile artifacts from existing harness evidence.
---
---
id: harness-profile
purpose: Run or interpret recurring profile handoff evidence
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose

Use this skill to consume GC, health, and previous profile evidence through a recurring profile and interpret the deterministic handoff.

## Invocation

Invoke when the user asks whether a recurring maintenance profile has met its stop condition, whether to continue a profile loop, or how to interpret profile-run evidence.

## Steps

1. Run `harness profile validate <profile>` when checking a profile definition.
2. Before running a profile that depends on fresh health evidence, get explicit user approval for the health command.
3. Run `harness profile run <profile> --format json` with explicit evidence paths supplied by the user or produced by prior approved commands. The command emits deterministic profile-run evidence and writes only when the user supplies an output path.
4. Parse top-level `status`, `issues`, `stop_condition_evaluation`, `actions_taken`, and `handoff`.
5. Treat `handoff` as the canonical profile decision detail.
6. For `not_met` or `inconclusive`, cite warning issues and observations that explain the continuation path.

## Safety

- Do not mutate profile inputs or generated evidence by hand.
- Do not run cleanup actions; recurring profiles in this repository emit deterministic summaries.
- Do not call provider/model APIs.
- Do not treat profile output as capability adoption approval.
