# Agent Guidance

This repository is the canonical harness-as-code platform for AI coding agents. It is not an `agent-coding` skill pack and should not drift back into skills-first documentation or implementation.

## Source of truth

- `harness.yaml` plus versioned schemas are the canonical substrate.
- The deterministic `harness` CLI is the implementation surface.
- Planning status lives in `plans/harness-engineering-platform/`.
- Public docs must describe current capabilities directly and keep planned paths clearly labeled.

## Documentation layout

- `README.md` is the user-facing product entrypoint.
- `docs/guides/` is for users adopting and operating the harness.
- `docs/dev/` is for contributors maintaining this repository.
- `plans/harness-engineering-platform/` is the only place for roadmap phase numbering and execution history.
- Do not add roadmap-phase wording to public docs, code, schemas, examples, fixtures, or tests.

## Architecture rules

- Plugins, portable skills, CI recipes, and recurring profiles are adapters over CLI/schema artifacts.
- Do not create plugin-only, skill-only, CI-only, or profile-only source-of-truth state.
- Keep responsibilities separate:
  - `doctor` is deterministic structural inspection.
  - `health` is declared local project checks with explicit trust boundaries.
  - `verify` consumes explicit self-verification evidence.
  - `eval` runs task/verifier suites.
  - `run` records deterministic or imported candidate execution evidence.
  - `gc` audits evidence and proposes reviewable cleanup slices without applying them.
  - `profile` consumes evidence and emits deterministic handoff artifacts.
- Do not add subjective "AI slop" scoring as a doctor, GC, or profile category.

## Toolchain decisions

- Use TypeScript 6 for implementation.
- Use Bun for repository package management and tests.
- Keep the published CLI Node-compatible; end users and adapters must not need Bun.
- Use explicit `tsc --noEmit` type checks.
- Use the configured Biome and Lefthook setup rather than inventing unrelated rules.
- Keep Bun's text lockfile committed with package metadata.

## Safety and compatibility

- Do not introduce inline secrets, hidden credential assumptions, or unbounded model spend.
- Live runner work must require explicit credential references plus cost/token/request budgets.
- Local checks, eval verifiers, repair actions, and profile inputs must declare trust and sandbox requirements.
- Schema and harness upgrades must go through previewable, reproducible `harness migrate` flows with evidence.

## External workflow skill relationship

Treat external workflow skills, including `LaChimere/agent-coding`, as learning material for harness-native capabilities. Do not copy, vendor, rewrite, merge, deprecate, install, or namespace those skills during capability mining.

Capability-mining output belongs in `plans/harness-engineering-platform/capability-ledger.yaml`. Future native capability adoption requires a separately approved substrate contract with evidence, fixtures or evals, trust/sandbox requirements, and false-positive policy where relevant.

## Recurring failure modes to avoid

- Do not fabricate provider-backed or live-model evidence. If a result came from deterministic stub execution or `--external-candidate`, label it that way.
- Do not treat `.harness/**` runtime artifacts as canonical source unless a task explicitly asks to inspect or preserve generated evidence.
- Do not add roadmap phase or numbering wording outside `plans/harness-engineering-platform/`.
- Do not let `doctor`, `gc`, `profile`, CI recipes, plugins, or skills enforce rules that are not reconstructable from schemas, `harness.yaml`, and CLI evidence.
- Do not silently upgrade schema versions; use previewable `harness migrate` evidence.
- Do not promise installability via host plugins, marketplaces, or registry until that path has shipped evidence in this repository.
