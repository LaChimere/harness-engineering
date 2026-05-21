# Harness CLI

Stage 4 includes the initial deterministic `harness` CLI and Harness doctor MVP. It consumes the Stage 2 schemas and examples, but it still does not implement `eval`, `run`, plugin, CI, skill, live model execution behavior, or formal GC behavior.

## Commands

```bash
harness init
harness validate
harness migrate
harness doctor --file examples/harness.yaml
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

`harness migrate` currently remains dry-run/no-op as of Stage 4. It emits provisional migration evidence with `schema_version`, `kind: migration-evidence`, `stability: provisional`, source/target schema versions, `dry_run: true`, and `would_change: false`.

`harness doctor` runs deterministic structural harness checks and emits Markdown by default or schema-valid JSON with `--format json`. Stage 4 doctor checks cover:

- `schema-validity`: validates the harness document against the local harness schema;
- `engine-compatibility`: records CLI/schema engine range compatibility as doctor evidence;
- `reference-exists`: reuses the shared harness reference validation helper;
- `builtin-check-supported`: verifies declared builtin doctor checks are supported by this CLI;
- local check registrations: records declared local checks as `skipped` with their trust requirements, but does not execute them yet.

Doctor JSON conforms to `schemas/doctor-result.schema.json`. `--output <path>` writes Markdown or JSON inside the selected root and rejects symlinked write targets. Doctor does not execute local checks, shell commands, eval verifiers, agents, repairs, GC, or subjective quality scoring.

`harness verify` consumes explicit self-verification evidence shaped by `schemas/self-verification.schema.json`. It validates the evidence document and reports the statuses already recorded in `acceptance_checks`. It does not inspect harness structure, execute checks, run verifiers, run agents, or infer behavioral quality; structural inspection belongs to current `doctor`, while behavioral execution remains later `eval` and `run` work.

`harness report` summarizes the harness and optional artifact inputs while citing every artifact path it summarized.

## Root path semantics

`harness init` can create or overwrite starter-managed files, so its `--root` value must stay inside the current working directory. Run `init` from the target repository root, or pass a child directory with `--root`.

The read/report commands (`validate`, `doctor`, `verify`, `report`) and the Stage 3 no-op `migrate` command may point `--root` at another checkout for inspection. User-provided file, spec, artifact, doctor-output, and migration-output paths are still constrained to the selected root. Doctor output, migration output, and init writes also reject symlinked write targets.

## Exit semantics

These exit codes are stable command contracts for future plugin and CI adapters:

| Code | Name | Meaning |
|---:|---|---|
| 0 | `ok` | The command completed successfully. |
| 1 | `validation-error` | Input was found, but schema validation, doctor status, or explicit verification status failed. |
| 2 | `usage-error` | The command line arguments are invalid or required arguments are missing. |
| 3 | `not-found` | A required input file or directory does not exist. |
| 4 | `incompatible-engines` | The harness declares CLI or schema engine ranges that this CLI cannot satisfy. |
| 70 | `internal-error` | The CLI hit an unexpected internal failure. |

For `harness doctor`, process exit status is computed from the top-level doctor status: `passed` exits `0`; `failed` and future `warning` statuses exit `1`. Engine incompatibility inside doctor is reported as a failed `engine-compatibility` check and uses exit code `1`; `harness validate` still uses exit code `4` for direct engine compatibility failures.

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
