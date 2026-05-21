# Harness Engineering

`LaChimere/harness-engineering` is the canonical harness-as-code platform for AI coding agents.

The product goal is a versioned harness substrate that makes agent work reproducible, observable, evaluable, policy-aware, and maintainable. The source of truth is `harness.yaml` plus machine-checkable schemas and a deterministic `harness` CLI. Plugins, skills, CI adapters, and recurring profiles are adapters over that substrate, not separate contracts.

## Current status

This repository has completed Stage 6: Agent runner, first behavioral eval, and trace normalization.

The roadmap is approved in `plans/harness-engineering-platform/`. The initial schemas and examples are available under `schemas/` and `examples/`, and the initial `harness` CLI is implemented in `src/`. No marketplace plugin, CI adapter, native skill adapter, or live model runner is available from this repository today.

## Entrypoint matrix

| Entrypoint | Status now | Intended role | First stage that makes it concrete |
|---|---|---|---|
| CLI plus `harness.yaml` | Initial Stage 6 CLI exists locally with `init`, `validate`, `migrate`, `doctor`, deterministic stub `run`, `eval validate`, deterministic `eval run`, `trace validate/import`, `verify`, and `report`. It is not yet a published npm package and does not call live models. | Host-agnostic substrate for init, validation, migration, runs, doctor checks, evals, traces, verification, GC, and reports. | Stage 3 implements the initial CLI; Stage 4 implements doctor MVP; Stage 5 implements verifier-only eval validation; Stage 6 implements CI-safe stub agent runs and trace normalization. |
| Host marketplace plugin | Planned north-star UX only. No plugin install path is promised yet. | Guided setup, dashboards, repairs, annotations, trace/eval navigation, and CLI management inside supported agent or IDE hosts. | Stage 8 verifies feasibility; Stage 9 ships a plugin only if feasible. |
| `agent-coding` skills compatibility | External migration-source evidence. Compatibility is not audited yet. | Portable fallback or compatibility path after the substrate exists and each skill is classified. | Stage 13. |
| CI adapters | Planned optional enforcement only. No CI contract exists yet. | Blocking or advisory checks for teams that want objective harness gates. | Stage 11. |

Until a real marketplace plugin is verified and shipped, the public path stays CLI-first. The Stage 6 local command shape is:

```bash
bun run build
node dist/index.js validate examples/harness.yaml
node dist/index.js doctor --file examples/harness.yaml
node dist/index.js run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
node dist/index.js eval validate --file examples/harness.yaml
node dist/index.js eval run --file examples/harness.yaml
node dist/index.js trace validate --file examples/harness.yaml
node dist/index.js verify --spec examples/verification/stage3-self-verification.yaml
node dist/index.js report --file examples/harness.yaml --doctor-result examples/doctor/results/pass.json
```

Use `node dist/index.js init` from a downstream target repository to create a starter `harness.yaml`; the source checkout keeps its canonical starter under `examples/harness.yaml`.

The npm package metadata and `harness` binary mapping exist, but the package has not been published.

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

Stage 2 added JSON schemas under `schemas/` with versioned `$id` values. External tools can validate artifacts from a local checkout today; Stage 3 package metadata includes the same schemas so installed package consumers can resolve them from `node_modules/@lachimere/harness-engineering/schemas/` after the package is published.

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

The next implementation target after Stage 6 is Stage 7: LLM-judge and inferential-review policy.
