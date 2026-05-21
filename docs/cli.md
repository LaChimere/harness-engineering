# Harness CLI

Stage 6 includes the initial deterministic `harness` CLI, Harness doctor MVP, verifier-only eval validation, deterministic stub agent runs, behavioral eval runs, and trace validation/import. It consumes the Stage 2 schemas and examples, but it still does not implement plugin, CI, skill, live model execution behavior, or formal GC behavior.

## Commands

```bash
harness init
harness validate
harness migrate
harness doctor --file examples/harness.yaml
harness run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
harness eval validate --file examples/harness.yaml
harness eval run --file examples/harness.yaml
harness trace validate --file examples/harness.yaml
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

`harness migrate` currently remains dry-run/no-op as of Stage 5. It emits provisional migration evidence with `schema_version`, `kind: migration-evidence`, `stability: provisional`, source/target schema versions, `dry_run: true`, and `would_change: false`.

`harness doctor` runs deterministic structural harness checks and emits Markdown by default or schema-valid JSON with `--format json`. Stage 4 doctor checks cover:

- `schema-validity`: validates the harness document against the local harness schema;
- `engine-compatibility`: records CLI/schema engine range compatibility as doctor evidence;
- `reference-exists`: reuses the shared harness reference validation helper;
- `builtin-check-supported`: verifies declared builtin doctor checks are supported by this CLI;
- local check registrations: records declared local checks as `skipped` with their trust requirements, but does not execute them yet.

Doctor JSON conforms to `schemas/doctor-result.schema.json`. `--output <path>` writes Markdown or JSON inside the selected root and rejects symlinked write targets. Doctor does not execute local checks, shell commands, eval verifiers, agents, repairs, GC, or subjective quality scoring.

`harness eval validate` runs deterministic verifier-only eval validation. With no explicit task, it reads `harness.yaml`, discovers configured eval task files, validates them against `schemas/eval-task.schema.json`, recomputes the declared dataset hash from the task's environment, oracle, baseline, and artifact references, then runs the task verifier against the oracle and broken twin candidates. The Stage 5 verifier runner only executes `command` verifiers whose trust declaration is `sandboxed`, requires `process`, and refuses tasks that declare network, secret, or host-file access. Stage 5 validates and gates declarations before execution; it does not provide a runtime sandbox, network namespace, filesystem jail, or secret isolation.

Eval validation emits Markdown by default or JSON with `--format json`. `--output <path>` appends a per-invocation run-result JSONL ledger inside the selected root using unique run IDs by default and writes verifier-result JSON under `.harness/verifier-results/`, rejecting symlinked write targets; omit `--output` for stable content-derived stdout run IDs, or pass a safe `--run-id` explicitly. Run results use `execution.mode: verifier-only` with separate `harness_status` and `verifier_status` fields so reviewers can distinguish harness/verifier failures from agent/model failures. `harness eval validate` does not run agents, call models, produce agent traces, or compute scoreboards; use `harness eval run` for the Stage 6 deterministic stub runner path.

`harness run <task>` executes a configured eval task through the Stage 6 deterministic stub runner. It validates the harness, runner, task, and model profile; enforces `credential_reference.source: stub`; requires explicit cost/token/request budgets; checks the runner's task and verifier binding; writes the recorded oracle or broken-twin output to `.harness/agent-outputs/`; runs the task verifier; and emits trace, verifier-result, and run-result artifacts. If the harness refuses the run before stub output emission, the trace records a system refusal with zero stub requests and no agent-output artifact. `--session-id` associates multiple runs with one continuity session; if omitted, the CLI reads `continuity.session_id_env` from the harness or generates a session id. `--case oracle|broken-twin` selects the recorded case, and `--run-id` must be a safe artifact id.

`harness eval run` discovers configured eval task files and runs the Stage 6 runner-bound task's deterministic stub cases end-to-end. Stage 6 supports exactly one configured eval task for the selected runner; multi-task runner mapping is a later-stage feature. The harness self-test runs both oracle and broken-twin cases without live credentials, records agent-run results in `.harness/run-results.jsonl`, writes traces under the runner's `trace_output`, writes verifier results under `.harness/verifier-results/`, writes agent outputs under `.harness/agent-outputs/`, and writes a scoreboard under `.harness/scoreboards/`. Re-running the same `--run-id` replaces prior ledger entries for that run id. Scoreboards summarize optimization/holdout splits and separate agent/model, harness, verifier, budget, credential, and verification failure buckets. The broken-twin case is intentionally counted as an `agent-failure` run-result while the overall eval run passes when that expected failure is observed.

`harness trace validate` validates a configured set of trace examples or one explicit trace artifact against `schemas/trace.schema.json`. `harness trace import --input <trace> --output <path>` copies an already-normalized trace only after schema validation and refuses output paths that escape the selected root or traverse symlinks.

`harness verify` consumes explicit self-verification evidence shaped by `schemas/self-verification.schema.json`. It validates the evidence document and reports the statuses already recorded in `acceptance_checks`. It does not inspect harness structure, execute checks, run verifiers, run agents, or infer behavioral quality; structural inspection belongs to current `doctor`, while behavioral execution remains later `eval` and `run` work.

`harness report` summarizes the harness and optional artifact inputs while citing every artifact path it summarized. It can include doctor results, individual run-result JSON artifacts, traces, and Stage 6 scoreboard summaries. `--run-result` expects one JSON object artifact; it does not parse multi-line `.jsonl` ledgers.

## Root path semantics

`harness init` can create or overwrite starter-managed files, so its `--root` value must stay inside the current working directory. Run `init` from the target repository root, or pass a child directory with `--root`.

The read/report commands (`validate`, `doctor`, `trace validate`, `verify`, `report`) and the no-op `migrate` command may point `--root` at another checkout for inspection. Unlike those read/report commands, `harness eval validate`, `harness run`, and `harness eval run` may execute declaration-gated verifier commands in the selected root, including when `--root` points at another checkout. User-provided file, task, spec, artifact, doctor-output, eval-output, trace-output, scoreboard-output, and migration-output paths are still constrained to the selected root. Doctor output, eval output, verifier-result output, trace output, scoreboard output, migration output, and init writes also reject symlinked write targets.

## Exit semantics

These exit codes are stable command contracts for future plugin and CI adapters:

| Code | Name | Meaning |
|---:|---|---|
| 0 | `ok` | The command completed successfully. |
| 1 | `validation-error` | Input was found, but schema validation, doctor status, eval validation status, or explicit verification status failed. |
| 2 | `usage-error` | The command line arguments are invalid or required arguments are missing. |
| 3 | `not-found` | A required input file or directory does not exist. |
| 4 | `incompatible-engines` | The harness declares CLI or schema engine ranges that this CLI cannot satisfy. |
| 70 | `internal-error` | The CLI hit an unexpected internal failure. |

For `harness doctor`, process exit status is computed from the top-level doctor status: `passed` exits `0`; `failed` and future `warning` statuses exit `1`. Engine incompatibility inside doctor is reported as a failed `engine-compatibility` check and uses exit code `1`; `harness validate` still uses exit code `4` for direct engine compatibility failures.

For `harness eval validate`, process exit status is computed from the top-level eval validation status: `passed` exits `0`; `failed` and `error` exit `1`. A broken twin that fails as expected contributes a failed run-result with `failure_code: verification-failure`, but the overall eval validation still passes when the expected oracle and broken-twin outcomes both hold.

For `harness run` and `harness eval run`, process exit status is computed from the top-level agent-run status: `passed` exits `0`; `failed` and `error` exit `1`. The deterministic broken-twin case contributes an `agent-failure` run result, but the overall `eval run` passes when the broken twin fails as expected and the oracle passes.

## Verification spec format

A verification spec is self-verification evidence, not a doctor result, eval task, or run-result. It must include:

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
