# Harness CLI

Stage 3 introduces the initial deterministic `harness` CLI. It consumes the Stage 2 schemas and examples, but it still does not implement `doctor`, `eval`, `run`, plugin, CI, skill, or live model execution behavior.

## Commands

```bash
harness init
harness validate
harness migrate
harness verify --spec examples/verification/stage3-self-verification.yaml
harness report
```

`harness init` writes a schema-valid starter baseline: `harness.yaml`, curated `examples/` artifacts, and local `.harness/` directories used by the starter references. It refuses to overwrite starter-managed files unless `--force` is passed and does not emit plugin or CI adapter keys.

`harness validate` checks:

- `harness.yaml` against `schemas/harness.schema.json`;
- local schema compilation through an offline JSON Schema registry;
- `engines.cli` compatibility with the CLI package version;
- `engines.schemas` compatibility with the locally bundled schema family;
- currently composed input references, including policy, environment, model profile, runner, trace example, eval task, context map, and local doctor-check paths.

It does not run doctor checks, eval verifiers, agents, or migrations.

`harness migrate` is intentionally dry-run/no-op in Stage 3. It emits provisional migration evidence with `schema_version`, `kind: migration-evidence`, `stability: provisional`, source/target schema versions, `dry_run: true`, and `would_change: false`.

`harness verify` consumes explicit self-verification evidence shaped by `schemas/self-verification.schema.json`. It validates the evidence document and reports the statuses already recorded in `acceptance_checks`. It does not inspect harness structure, execute checks, run verifiers, run agents, or infer behavioral quality; those responsibilities belong to later `doctor`, `eval`, and `run` stages.

`harness report` summarizes the harness and optional artifact inputs while citing every artifact path it summarized.

## Root path semantics

`harness init` can create or overwrite starter-managed files, so its `--root` value must stay inside the current working directory. Run `init` from the target repository root, or pass a child directory with `--root`.

The read/report commands (`validate`, `verify`, `report`) and the Stage 3 no-op `migrate` command may point `--root` at another checkout for inspection. User-provided file, spec, artifact, and migration-output paths are still constrained to the selected root. Migration output and init writes also reject symlinked write targets.

## Exit semantics

These exit codes are stable command contracts for future plugin and CI adapters:

| Code | Name | Meaning |
|---:|---|---|
| 0 | `ok` | The command completed successfully. |
| 1 | `validation-error` | Input was found, but schema validation or explicit verification status failed. |
| 2 | `usage-error` | The command line arguments are invalid or required arguments are missing. |
| 3 | `not-found` | A required input file or directory does not exist. |
| 4 | `incompatible-engines` | The harness declares CLI or schema engine ranges that this CLI cannot satisfy. |
| 70 | `internal-error` | The CLI hit an unexpected internal failure. |

## Verification spec format

A verification spec is self-verification evidence, not a doctor or eval task. It must include:

- `schema_version`;
- `verification_id`;
- `spec_ref`;
- `spec_reread` evidence with timestamp, digest, and status;
- `acceptance_checks` with explicit expected/actual/status fields;
- `checks_run`, `artifacts`, `unresolved_risks`, and `evidence_links`.

Example:

```yaml
schema_version: "0.1.0"
verification_id: stage3-cli-skeleton
spec_ref: plans/harness-engineering-platform/plan.md#stage-3-cli-skeleton
spec_reread:
  ref: plans/harness-engineering-platform/plan.md#stage-3-cli-skeleton
  timestamp: "2026-05-21T00:00:00Z"
  digest: sha256:d4bafe7d022d54172884fafc7e9c5696e2a3aa17b685228a900f407e245e6e53
  status: matched
acceptance_checks:
  - id: verify-boundary
    expected: verify consumes explicit self-verification evidence only.
    actual: harness verify validates this document without inspecting harness structure.
    status: passed
checks_run: []
artifacts: []
unresolved_risks: []
evidence_links: []
```

The repository copy lives at `examples/verification/stage3-self-verification.yaml`.
