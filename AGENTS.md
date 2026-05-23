# Agent Guidance

This repository is the canonical harness-as-code platform for AI coding agents. It is not an `agent-coding` skill pack and should not drift back into skills-first documentation or implementation.

## Source of truth

- Approved product direction lives in `plans/harness-engineering-platform/design.md`.
- Approved execution order and acceptance criteria live in `plans/harness-engineering-platform/plan.md`.
- Execution status lives in `plans/harness-engineering-platform/todo.md`.
- Keep public docs honest about what exists now versus what is planned.

## Architecture rules

- `harness.yaml` plus versioned schemas are the canonical substrate.
- The `harness` CLI is the deterministic implementation surface.
- Plugins, portable skills, CI adapters, and recurring profiles must be adapters over CLI/schema artifacts.
- Do not create plugin-only, skill-only, or CI-only source-of-truth state.
- Keep `doctor`, `verify`, and `eval` separate:
  - `doctor` is for deterministic structural harness checks.
  - `verify` records self-verification evidence against explicit acceptance checks.
  - `eval` runs behavioral task/verifier suites.
- Do not add subjective "AI slop" scoring as a doctor or GC category.

## Roadmap boundaries

- Schemas are defined before commands consume them.
- The deterministic CLI is the implementation surface for substrate operations.
- Agent/CLI marketplace or install-surface feasibility must be verified before any plugin/adapter install path or specific host target is promised as available. IDE-only extension hosts are future evidence, not the corrected adapter target.
- External workflow skills are source material for harness-native capability decisions; do not create an `agent-coding` product namespace, compatibility package, or default quickstart.

## Toolchain decisions

When implementation begins:

- Use TypeScript 6 for implementation.
- Use Bun for repository package management.
- Keep the published CLI Node-compatible; end users and plugins must not need Bun.
- Use explicit `tsc --noEmit` type checks.
- Add Biome and Lefthook with user-provided configuration rather than inventing unrelated rules.
- Commit Bun's text lockfile once package metadata exists.

## Safety and compatibility

- Do not introduce inline secrets, hidden credential assumptions, or unbounded model spend.
- Agent runs must require explicit credential references and cost/token/request budgets once runner support exists.
- Local checks, eval verifiers, and repair actions must declare trust and sandbox requirements.
- Schema and harness upgrades must go through previewable, reproducible `harness migrate` flows with evidence.

## External workflow skill relationship

Treat external workflow skills, including `LaChimere/agent-coding`, as learning material for harness-native capabilities. Do not copy, vendor, rewrite, merge, deprecate, install, or namespace those skills during capability mining.

Capability-mining output belongs in `plans/harness-engineering-platform/capability-ledger.yaml`. Future native capability adoption requires a separately approved substrate contract with evidence, fixtures or evals, trust/sandbox requirements, and false-positive policy where relevant.
