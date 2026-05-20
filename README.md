# Harness Engineering

`LaChimere/harness-engineering` is the canonical harness-as-code platform for AI coding agents.

The product goal is a versioned harness substrate that makes agent work reproducible, observable, evaluable, policy-aware, and maintainable. The source of truth is `harness.yaml` plus machine-checkable schemas and a deterministic `harness` CLI. Plugins, skills, CI adapters, and recurring profiles are adapters over that substrate, not separate contracts.

## Current status

This repository has completed Stage 2: harness schema substrate.

The roadmap is approved in `plans/harness-engineering-platform/`. The initial schemas and examples are available under `schemas/` and `examples/`. No npm package, CLI command, marketplace plugin, CI adapter, or native skill adapter is available from this repository today.

## Entrypoint matrix

| Entrypoint | Status now | Intended role | First stage that makes it concrete |
|---|---|---|---|
| CLI plus `harness.yaml` | Current documented default path. Stage 2 schemas exist; the CLI is planned, not yet published. | Host-agnostic substrate for init, validation, migration, runs, doctor checks, evals, traces, verification, GC, and reports. | Stage 3 implements the initial CLI. |
| Host marketplace plugin | Planned north-star UX only. No plugin install path is promised yet. | Guided setup, dashboards, repairs, annotations, trace/eval navigation, and CLI management inside supported agent or IDE hosts. | Stage 8 verifies feasibility; Stage 9 ships a plugin only if feasible. |
| `agent-coding` skills compatibility | External migration-source evidence. Compatibility is not audited yet. | Portable fallback or compatibility path after the substrate exists and each skill is classified. | Stage 13. |
| CI adapters | Planned optional enforcement only. No CI contract exists yet. | Blocking or advisory checks for teams that want objective harness gates. | Stage 11. |

Until a real marketplace plugin is verified and shipped, the public path stays CLI-first. When Stage 3 lands, the intended command shape is:

```bash
npx @lachimere/harness-engineering init
npx @lachimere/harness-engineering validate
npx @lachimere/harness-engineering verify
npx @lachimere/harness-engineering report
```

These commands are target commands, not available commands yet.

## Product layers

| Tier | Surface | Responsibility |
|---|---|---|
| 0 | Harness-as-code substrate | `harness.yaml`, schemas, examples, artifact conventions, and versioning. |
| 1 | Deterministic CLI | `init`, `validate`, `migrate`, `run`, `doctor`, `eval`, `trace`, `verify`, `gc`, and `report`. |
| 2 | Host marketplace plugins | Rich guided UX where a supported host marketplace and runtime APIs exist. |
| 3 | Portable skills | Agent-facing adapters that consume substrate artifacts. |
| 4 | Optional CI adapters | Objective enforcement or advisory checks for teams that opt in. |
| 5 | Recurring profiles | Entropy, docs, eval, trace, and maintenance loops over evidence artifacts. |

## Distribution decisions

- Public npm package: `@lachimere/harness-engineering`.
- Public binary: `harness`.
- Implementation language: TypeScript 6.
- Repository package manager: Bun.
- Public runtime target: Node-compatible CLI output. Users and host plugins must not need Bun to run the published CLI.
- Type checking: explicit `tsc --noEmit`.
- Formatting/linting: Biome, using user-provided configuration when implementation begins.
- Git hooks: Lefthook, using user-provided configuration when implementation begins.
- Lockfile policy: commit Bun's text lockfile once package metadata exists.

## Schema publication and compatibility

Stage 2 added JSON schemas under `schemas/` with versioned `$id` values. External tools can validate artifacts from a local checkout today; after Stage 3 packaging exists, the same schemas should also be available from `node_modules/@lachimere/harness-engineering/schemas/` or tagged release assets.

Every machine-readable artifact must include `schema_version`. Each schema uses semantic versioning, and `harness.yaml` pins compatible ranges with `engines.schemas`. The CLI validates artifacts only against schema versions inside its supported range and reports version mismatch as an explicit compatibility error.

## Migration posture

`harness migrate` is the only supported path for schema or harness configuration upgrades.

Migrations must be previewable, reproducible without a plugin, and backed by machine-readable evidence. A plugin may surface a migration, but it must not silently rewrite `harness.yaml`, upgrade schema versions, or create plugin-only source-of-truth state.

## Relationship to `agent-coding`

`LaChimere/agent-coding` remains external migration-source evidence. Its current skills may later become compatibility helpers, native adapter inputs, extracted extension points, or deprecated paths after replacements exist.

Stage 13 will classify each relevant `agent-coding` skill before this repository copies, vendors, rewrites, merges, extracts, or deprecates it. Until then, `agent-coding` is not the default quickstart and is not assumed to be present in this repository.

Disposition options for each audited skill:

- Keep as a separate skills distribution.
- Create a compatibility package.
- Fold selected behavior into this repository.
- Extract selected behavior into separate extension points.
- Deprecate only after documented replacement paths exist.

## Roadmap

The approved roadmap lives in:

- `plans/harness-engineering-platform/research.md`
- `plans/harness-engineering-platform/design.md`
- `plans/harness-engineering-platform/plan.md`
- `plans/harness-engineering-platform/todo.md`

The next implementation target after Stage 2 is Stage 3: CLI skeleton, init, validate, migrate, verify, and report.
