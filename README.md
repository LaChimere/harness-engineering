# Harness Engineering

`LaChimere/harness-engineering` is the canonical harness-as-code platform for AI coding agents.

The product goal is a versioned harness substrate that makes agent work reproducible, observable, evaluable, policy-aware, and maintainable. The source of truth is `harness.yaml` plus machine-checkable schemas and a deterministic `harness` CLI. Plugins, skills, CI adapters, and recurring profiles are adapters over that substrate, not separate contracts.

## Current status

This repository has completed the agent-practice mining slice. It has not shipped an installable adapter package, CI adapter, native skill package, or live agent runtime.

The roadmap is approved in `plans/harness-engineering-platform/`. The initial schemas and examples are available under `schemas/` and `examples/`, and the initial `harness` CLI is implemented in `src/`. GitHub Copilot CLI is the first **limited adapter** target, not a full-plugin target. The repo includes an adapter-scope manifest and `harness adapter validate`, execution-loop validation over continuity and self-verification evidence, `harness assess` as the read-only native agent-facing assessment adapter, and `plans/harness-engineering-platform/capability-ledger.yaml` for harness-native capability candidates mined from external workflow skill source material. No installable host package, CI adapter, native skill adapter, or live model runner is available from this repository today.

## Entrypoint matrix

| Entrypoint | Status now | Intended role | First stage that makes it concrete |
|---|---|---|---|
| CLI plus `harness.yaml` | The local CLI includes `init`, `adapter validate`, `assess`, `loop validate`, `validate`, `migrate`, `doctor`, deterministic stub `run`, `eval validate`, deterministic `eval run`, `trace validate/import`, `verify`, `report`, and offline judge policy/result validation. It is not yet a published npm package and does not call live models. | Host-agnostic substrate for init, validation, migration, runs, doctor checks, evals, traces, verification, execution-loop evidence gates, future GC, adapter-scope checks, native assessment, and reports. | Available locally in this checkout. |
| Agent/CLI marketplace adapter or plugin | A GitHub Copilot CLI limited-adapter scope manifest and validator exist. No installable host package is shipped yet, so users cannot enable an adapter runtime from this repository today. | Guided setup, dashboards, repairs, annotations, trace/eval navigation, and CLI management inside supported coding-agent or CLI hosts. Limited adapters may expose only commands, hooks, MCP tools, or skills over the CLI. | Feasibility is recorded; runtime packaging is not shipped. |
| External workflow skill source material | External skills are learning material only; they are not a product surface, dependency, or default quickstart. | Mine useful practices into harness-native capability decisions without creating an `agent-coding` namespace or compatibility package. | Captured in the capability ledger. |
| CI adapters | Planned optional enforcement only. No CI contract exists yet. | Blocking or advisory checks for teams that want objective harness gates. | Planned. |

Until a real agent/CLI full-plugin tier is verified and shipped, the public path stays CLI-first. Current adapter evidence proves only limited-adapter scope, so any adapter must label unsupported rich UX as unavailable. The current local command shape is:

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
| 1 | Deterministic CLI | Current `init`, `adapter validate`, `assess`, `loop validate`, `validate`, `migrate`, `run`, `doctor`, `eval`, `trace`, `verify`, and `report`; GC remains planned. |
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

The schema substrate lives under `schemas/` with versioned `$id` values. External tools can validate artifacts from a local checkout today; package metadata includes the same schemas so installed package consumers can resolve them from `node_modules/@lachimere/harness-engineering/schemas/` after the package is published.

Every machine-readable artifact must include `schema_version`. Each schema uses semantic versioning, and `harness.yaml` pins compatible ranges with `engines.schemas`. The CLI validates artifacts only against schema versions inside its supported range and reports version mismatch as an explicit compatibility error.

## Migration posture

`harness migrate` is the only supported path for schema or harness configuration upgrades.

Migrations must be previewable, reproducible without a plugin, and backed by machine-readable evidence. A plugin may surface a migration, but it must not silently rewrite `harness.yaml`, upgrade schema versions, or create plugin-only source-of-truth state.

## Learning from external workflow skills

External workflow skills, including those in `LaChimere/agent-coding`, are source material for harness-native capability design. This repository does not expose `agent-coding` as a product namespace, dependency, compatibility package, or default quickstart.

The approved plan mined workflow-oriented external skills into `plans/harness-engineering-platform/capability-ledger.yaml`. Each ledger record describes a harness capability candidate, the observed practice and failure mode, the possible substrate surface, required evidence, and what remains outside harness core. Domain-specific utility skills such as vulnerability scanning are ignored for this capability-mining work.

This repository does **not** copy, vendor, rewrite, merge, deprecate, or install external skills. Future native capability adoption must go through approved schema/CLI/profile/eval/GC contracts with fixtures, trust/sandbox requirements, and false-positive policy where relevant.


## Roadmap

The approved roadmap lives in:

- `plans/harness-engineering-platform/research.md`
- `plans/harness-engineering-platform/design.md`
- `plans/harness-engineering-platform/plan.md`
- `plans/harness-engineering-platform/todo.md`

The current roadmap has implemented the CLI-first substrate, doctor/eval/run/trace/report flows, limited-adapter scope validation, execution-loop evidence gates, native assessment, and capability mining. CI adapters remain intentionally deferred for now. Installable host packaging, runtime enablement, CI enforcement, and live model execution remain constrained by future host evidence.
