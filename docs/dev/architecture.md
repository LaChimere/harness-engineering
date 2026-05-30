# Architecture

Harness Engineering is organized around one source of truth: `harness.yaml` plus versioned schemas and deterministic CLI behavior.

## Source-of-truth boundary

- Schemas define artifact shapes.
- `harness.yaml` composes repository-local artifacts.
- The `harness` CLI validates and produces evidence.
- Adapters, CI recipes, profiles, and host integrations consume CLI/schema artifacts.

No adapter should maintain authoritative rules that cannot be reconstructed from harness artifacts.

Repo-local host adapter packages live under `plugins/` and package canonical
skills for specific hosts. They are validated adapter artifacts, not source of
truth and not a promise of public marketplace availability.

## Command boundaries

| Command family | Responsibility |
|---|---|
| `validate` | Shape, engine range, and reference validation. |
| `doctor` | Deterministic structural checks. |
| `health` | Declared local project checks with trust evidence. |
| `verify` | Explicit self-verification evidence validation. |
| `eval` | Verifier-only eval validation. |
| `trace` | Normalized trace validation/import. |
| `report` | Artifact summaries with citations. |
| `assess` | Read-only maturity and routing assessment. |
| `gc` | Evidence-backed entropy audit and cleanup-slice proposals. |
| `profile` | Deterministic evidence-consuming profile runs. |

Keep these responsibilities separate. For example, `doctor` should not execute local health checks, `gc` should not apply cleanup, and `profile` should not become a scheduler.

## Evidence flow

```text
harness.yaml
  -> validate / doctor / health
  -> eval / trace
  -> gc audit
  -> profile run
  -> assess / report
```

Every machine-readable output includes `schema_version`. Commands that write files constrain paths to the selected repository root and reject symlinked writes. Initialized user projects keep editable harness support files under `.harness/**` and generated evidence under `.harness/outputs/**`; this repository's `examples/**` directory remains only for packaged examples and fixtures.

## Current non-goals

- no model execution inside the Harness CLI;
- no public marketplace/global host plugin distribution;
- no CI enforcement package;
- no scheduler daemon;
- no automatic cleanup;
- no subjective quality scoring as a structural or GC category.

## Planning boundary

Roadmap phase numbering belongs only under `plans/harness-engineering-platform/`. Product docs, schemas, code, examples, fixtures, and tests should use capability names such as `execution-loop`, `gc-stability`, `adapter-selection`, or `schema-self-verification`.

## External workflow skill adapter relationship

External workflow skills such as `LaChimere/agent-coding` are learning material only. This repository does not expose them as a product namespace, dependency, compatibility package, or default quickstart. Capability mining from those skills feeds `plans/harness-engineering-platform/capability-ledger.yaml`.

Future native capability adoption must go through schema/CLI/profile/eval/GC contracts with evidence, fixtures or evals, trust/sandbox requirements, and false-positive policy. External agent output remains outside the Harness execution boundary and should be supplied only as explicit evidence artifacts.
