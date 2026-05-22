# Harness Engineering

`LaChimere/harness-engineering` is the canonical harness-as-code platform for AI coding agents.

The product goal is a versioned harness substrate that makes agent work reproducible, observable, evaluable, policy-aware, and maintainable. The source of truth is `harness.yaml` plus machine-checkable schemas and a deterministic `harness` CLI. Plugins, skills, CI adapters, and recurring profiles are adapters over that substrate, not separate contracts.

## Current status

This repository has completed the Stage 12 native agent-facing assessment slice. It has not shipped an installable adapter package, CI adapter, native skill package, or live agent runtime.

The roadmap is approved in `plans/harness-engineering-platform/`. The initial schemas and examples are available under `schemas/` and `examples/`, and the initial `harness` CLI is implemented in `src/`. Stage 8 selected GitHub Copilot CLI as the first **limited adapter** target, not a full-plugin target. Stage 9 adds an adapter-scope manifest and `harness adapter validate`; Stage 10 adds `harness loop validate` over continuity and self-verification evidence; Stage 12 adds `harness assess` as the read-only native agent-facing assessment adapter. No installable host package, CI adapter, native skill adapter, or live model runner is available from this repository today.

## Entrypoint matrix

| Entrypoint | Status now | Intended role | First stage that makes it concrete |
|---|---|---|---|
| CLI plus `harness.yaml` | Initial Stage 12 CLI exists locally with `init`, `adapter validate`, `assess`, `loop validate`, `validate`, `migrate`, `doctor`, deterministic stub `run`, `eval validate`, deterministic `eval run`, `trace validate/import`, `verify`, `report`, and offline judge policy/result validation. It is not yet a published npm package and does not call live models. | Host-agnostic substrate for init, validation, migration, runs, doctor checks, evals, traces, verification, execution-loop evidence gates, future GC, adapter-scope checks, native assessment, and reports. | Stage 3 implements the initial CLI; Stage 4 implements doctor MVP; Stage 5 implements verifier-only eval validation; Stage 6 implements CI-safe stub agent runs and trace normalization; Stage 7 implements inferential judge policy validation; Stage 9 validates limited-adapter scope; Stage 10 validates execution-loop evidence gates; Stage 12 adds the native agent-facing assessment command. |
| Agent/CLI marketplace adapter or plugin | Stage 9 ships a GitHub Copilot CLI limited-adapter scope manifest and validator. No installable host package is shipped yet, so users cannot enable an adapter runtime from this repository today. | Guided setup, dashboards, repairs, annotations, trace/eval navigation, and CLI management inside supported coding-agent or CLI hosts. Limited adapters may expose only commands, hooks, MCP tools, or skills over the CLI. | Stage 8 verified feasibility; Stage 9 may ship only the proven limited adapter scope. |
| `agent-coding` skills compatibility | External migration-source evidence. Compatibility is not audited yet. | Portable fallback or compatibility path after the substrate exists and each skill is classified. | Stage 13. |
| CI adapters | Planned optional enforcement only. No CI contract exists yet. | Blocking or advisory checks for teams that want objective harness gates. | Stage 11. |

Until a real agent/CLI full-plugin tier is verified and shipped, the public path stays CLI-first. Stage 8 proved only limited-adapter scope, so any Stage 9 adapter must label unsupported rich UX as unavailable. The current local command shape is:

```bash
bun run build
node dist/index.js validate examples/harness.yaml
node dist/index.js adapter validate
node dist/index.js assess --file examples/harness.yaml --format json
node dist/index.js loop validate --file examples/harness.yaml --continuity examples/continuity/stage10-loop-state.yaml --verification examples/verification/stage10-completion.yaml
node dist/index.js doctor --file examples/harness.yaml
node dist/index.js run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
node dist/index.js eval validate --file examples/harness.yaml
node dist/index.js eval run --file examples/harness.yaml
node dist/index.js trace validate --file examples/harness.yaml
node dist/index.js verify --spec examples/verification/stage3-self-verification.yaml
node dist/index.js report --file examples/harness.yaml --doctor-result examples/doctor/results/pass.json
node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/advisory-only.json
```

Use `node dist/index.js init` from a downstream target repository to create a starter `harness.yaml`; the source checkout keeps its canonical starter under `examples/harness.yaml`.

The npm package metadata and `harness` binary mapping exist, but the package has not been published.

## Product layers

| Tier | Surface | Responsibility |
|---|---|---|
| 0 | Harness-as-code substrate | `harness.yaml`, schemas, examples, artifact conventions, and versioning. |
| 1 | Deterministic CLI | Current `init`, `adapter validate`, `assess`, `loop validate`, `validate`, `migrate`, `run`, `doctor`, `eval`, `trace`, `verify`, and `report`; future `gc` remains planned for Stage 14. |
| 2 | Agent/CLI marketplace adapters | Rich guided UX only where a supported full-plugin host and runtime APIs exist; otherwise limited commands/hooks/MCP/skills over the CLI when proven feasible. |
| 3 | Portable skills | Agent-facing adapters that consume substrate artifacts. |
| 4 | Optional CI adapters | Objective enforcement or advisory checks for teams that opt in. |
| 5 | Recurring profiles | Entropy, docs, eval, trace, and maintenance loops over evidence artifacts. |

## Distribution decisions

- Public npm package: `@lachimere/harness-engineering`.
- Public binary: `harness`.
- Implementation language: TypeScript 6.
- Repository package manager: Bun.
- Public runtime target: Node-compatible CLI output. Users and host adapters must not need Bun to run the published CLI.
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

Stages 1 through 10 and Stage 12 are implemented in the current roadmap. Stage 11 CI adapters are intentionally deferred for now. Stage 9 has a schema-backed GitHub Copilot CLI limited-adapter scope manifest and validator; Stage 10 adds native execution-loop startup/completion gate validation over continuity and self-verification evidence; Stage 12 adds schema-backed `harness assess` output for maturity, missing primitives, rollout guidance, and implementation routing. Installable host packaging, runtime enablement, CI enforcement, and live model execution remain constrained by later stages and future host evidence.
