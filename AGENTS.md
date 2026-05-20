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

## Stage boundaries

- Stage 2 defines schemas before commands consume them.
- Stage 3 implements the initial CLI.
- Stage 8 must verify host marketplace/API feasibility before any plugin install path or specific host target is promised as available.
- Stage 13 must audit `agent-coding` compatibility before importing, rewriting, or deprecating external skills.

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

## `agent-coding` relationship

Treat `LaChimere/agent-coding` as external migration-source evidence. It may remain separate, become a compatibility package, be selectively folded in, be extracted into extension points, or be deprecated only after replacement paths exist.

Do not make `npx skills add https://github.com/LaChimere/agent-coding` the default quickstart for this repository; Stage 13 may document it only as a compatibility or migration fallback.
