# Harness CLI

The deterministic `harness` CLI includes schema validation, Harness doctor checks, verifier-only eval validation, deterministic stub agent runs, behavioral eval runs, trace validation/import, offline LLM-judge policy/result validation, limited-adapter scope validation, native execution-loop evidence validation, and a read-only native agent-facing assessment command. It consumes the local schemas and examples, but it still does not ship an installable host plugin package, CI adapter, skill adapter, live model execution behavior, or formal GC behavior.

## Commands

```bash
harness init
harness adapter validate
harness assess --file examples/harness.yaml --format json
harness loop validate --file examples/harness.yaml --continuity examples/continuity/stage10-loop-state.yaml --verification examples/verification/stage10-completion.yaml
harness validate
harness migrate
harness doctor --file examples/harness.yaml
harness run examples/evals/harness-self-test/v1.0.0/task.yaml --file examples/harness.yaml
harness eval validate --file examples/harness.yaml
harness eval run --file examples/harness.yaml
harness trace validate --file examples/harness.yaml
harness verify --spec examples/verification/stage3-self-verification.yaml
harness report --file examples/harness.yaml --judge-result examples/judges/results/advisory-only.json
```

`harness init` writes a schema-valid starter baseline: `harness.yaml`, curated `examples/` artifacts, and local `.harness/` directories used by the starter references. It refuses to overwrite starter-managed files unless `--force` is passed and does not emit plugin or CI adapter keys.

`harness validate` checks:

- `harness.yaml` against `schemas/harness.schema.json`;
- local schema compilation through an offline JSON Schema registry;
- `engines.cli` compatibility with the CLI package version;
- `engines.schemas` compatibility with the locally bundled schema family;
- currently composed input references, including policy, environment, model profile, runner, trace example, eval task, context map, and local doctor-check paths.

It does not run doctor checks, eval verifiers, agents, or migrations.

`harness adapter validate` validates the adapter-scope manifest against `schemas/adapter-scope.schema.json`, validates the capability matrix against `schemas/plugin-capability-matrix.schema.json`, then runs semantic subset checks. By default it validates `examples/adapters/github-copilot-cli/adapter-scope.json` against `examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json`; pass `--scope`, `--matrix`, or `--root` to inspect different artifacts inside a selected root. The command proves schema validity and capability-matrix subset conformance only: the selected limited-adapter scope does not overclaim matrix evidence, unsupported CLI management modes, authoritative local state, or preview-backed writes without proven repair UI support. It does not prove that the selected host can install, bootstrap, distribute, or execute this adapter. It does not install a host plugin, run a host marketplace package, reimplement doctor/eval logic, or execute write actions.

`harness assess` is the native agent-facing adapter path. It emits a provisional schema-backed assessment as Markdown by default or JSON with `--format json`, using `schemas/assessment.schema.json`. The JSON form is the machine-readable surface for agents, plugins, skills, and CI adapters; `skills/harness-engineering/` remains intentionally deferred so the repository does not introduce a skill-only source of truth. The approved plan records external workflow skills only as source material for harness-native capability candidates.

Assessment is read-only. It reads `harness.yaml` when present, optional doctor output, run-result JSON objects or arrays, JSONL ledgers, trace artifacts, scoreboards, `harness report` text, and repair-action candidates. Run-result evidence is treated as present only when every supplied record passed; mixed pass/fail/error/skipped ledgers remain partial evidence. It emits an adapter-path rationale, maturity scorecard, missing primitives, rollout plan, policy/eval/trace/continuity recommendations, implementation routing, and the artifacts it read. By default it discovers repair actions from `examples/repair-actions/` for the repository examples; downstream projects should pass a harness-owned repair-action directory explicitly until a production default is standardized. Routing selects repair actions only when their `target_files` overlap current missing or partial assessment evidence, their artifact declares `approval_state: approved`, the action id is unique across discovered repair actions, and the caller provides external approval with `--trusted-repair-action <action-id>`. Repo-controlled repair-action approval fields are not treated as trusted authorization by themselves. Proposed, untrusted, duplicate-id, and non-applicable repair actions are reported as `needs-approval`, `unavailable`, or invalid evidence; selectable repair-action routes include applicability/approval-trust/approval/risk/sandbox metadata. Repair-action routes cite the artifact for review but do not copy its `equivalent_cli_command` into assessment output as an executable route command. External workflow skills are reported only as unavailable source material for capability-mining decisions; `harness assess` never selects an external skill route. `harness assess` never executes repair actions, implementation loops, shell commands, evals, agents, or migrations.

`harness loop validate` validates native execution-loop evidence over existing substrate artifacts. It reads `harness.yaml`, the referenced approval and sandbox policies, an explicit continuity-state artifact, the startup self-verification artifact referenced by continuity state, and completion self-verification evidence when `--phase complete` is used. The command validates artifact schemas first, then enforces semantic gates:

- `--phase start` requires `startup_verification.status: passed`, a startup command matching `harness.continuity.startup_smoke_test`, non-empty startup evidence, a passing startup self-verification record, and a `progress_log` entry recording startup verification as the first recorded progress event.
- `--phase complete` also requires explicit `--verification` evidence with `spec_reread.status: matched`, all acceptance checks passed, required acceptance IDs for spec reread, criteria comparison, approval policy handling, sandbox policy handling, startup continuity update, and handoff readiness, evidence links to the approval and sandbox policy artifacts read from `harness.yaml`, recorded passed `harness validate` and `harness doctor` checks whose command strings start with recognized harness invocations, non-empty evidence/artifact links, at least one continuity handoff artifact, and a `progress_log` link to the completion evidence.

This is an evidence validator, not an agent runner. It does not execute the startup smoke test, run an implementation loop, modify continuity state, call models, or vendor external skills; it validates recorded evidence and policy artifact links rather than proving that the recorded commands were executed by the CLI. Any external producer of continuity and self-verification artifacts must conform to the same schema and CLI validation gates. The CLI/schema artifacts remain the source of truth.

`harness migrate` currently remains dry-run/no-op. It emits provisional migration evidence with `schema_version`, `kind: migration-evidence`, `stability: provisional`, source/target schema versions, `dry_run: true`, and `would_change: false`.

`harness doctor` runs deterministic structural harness checks and emits Markdown by default or schema-valid JSON with `--format json`. Current doctor checks cover:

- `schema-validity`: validates the harness document against the local harness schema;
- `engine-compatibility`: records CLI/schema engine range compatibility as doctor evidence;
- `reference-exists`: reuses the shared harness reference validation helper;
- `builtin-check-supported`: verifies declared builtin doctor checks are supported by this CLI;
- local check registrations: records declared local checks as `skipped` with their trust requirements, but does not execute them yet.

Doctor JSON conforms to `schemas/doctor-result.schema.json`. `--output <path>` writes Markdown or JSON inside the selected root and rejects symlinked write targets. Doctor does not execute local checks, shell commands, eval verifiers, agents, repairs, GC, or subjective quality scoring.

`harness eval validate` runs deterministic verifier-only eval validation. With no explicit task, it reads `harness.yaml`, discovers configured eval task files, validates them against `schemas/eval-task.schema.json`, recomputes the declared dataset hash from the task's environment, oracle, baseline, and artifact references, then runs the task verifier against the oracle and broken twin candidates. The verifier-only runner executes only `command` verifiers whose trust declaration is `sandboxed`, requires `process`, and refuses tasks that declare network, secret, or host-file access. It validates and gates declarations before execution; it does not provide a runtime sandbox, network namespace, filesystem jail, or secret isolation.

Eval validation emits Markdown by default or JSON with `--format json`. `--output <path>` appends a per-invocation run-result JSONL ledger inside the selected root using unique run IDs by default and writes verifier-result JSON shaped by `schemas/verifier-result.schema.json` under `.harness/verifier-results/`, rejecting symlinked write targets; omit `--output` for stable content-derived stdout run IDs, or pass a safe `--run-id` explicitly. Run results use `execution.mode: verifier-only` with separate `harness_status` and `verifier_status` fields so reviewers can distinguish harness/verifier failures from agent/model failures. `harness eval validate` does not run agents, call models, produce agent traces, or compute scoreboards; use `harness eval run` for the deterministic stub runner path.

`harness run <task>` executes a configured eval task through the deterministic stub runner. It validates the harness, runner, task, and model profile; enforces `credential_reference.source: stub`; requires explicit cost/token/request budgets; checks the runner's task and verifier binding; writes the recorded oracle or broken-twin output to `.harness/agent-outputs/`; runs the task verifier; and emits trace, verifier-result, and run-result artifacts. Verifier-result artifacts conform to `schemas/verifier-result.schema.json`. If the harness refuses the run before stub output emission, the trace records a system refusal with zero stub requests and no agent-output artifact. `--session-id` associates multiple runs with one continuity session; if omitted, the CLI reads `continuity.session_id_env` from the harness or generates a session id. `--case oracle|broken-twin` selects the recorded case, and `--run-id` must be a safe artifact id.

`harness eval run` discovers configured eval task files and runs the runner-bound task's deterministic stub cases end-to-end. The current runner supports exactly one configured eval task for the selected runner; multi-task runner mapping is a future capability. The harness self-test runs both oracle and broken-twin cases without live credentials, records agent-run results in `.harness/run-results.jsonl`, writes traces under the runner's `trace_output`, writes verifier results under `.harness/verifier-results/`, writes agent outputs under `.harness/agent-outputs/`, and writes a scoreboard under `.harness/scoreboards/`. Re-running the same `--run-id` replaces prior ledger entries for that run id. Scoreboards summarize optimization/holdout splits and separate agent/model, harness, verifier, budget, credential, and verification failure buckets. The broken-twin case is intentionally counted as an `agent-failure` run-result while the overall eval run passes when that expected failure is observed.

`harness trace validate` validates a configured set of trace examples or one explicit trace artifact against `schemas/trace.schema.json`. `harness trace import --input <trace> --output <path>` copies an already-normalized trace only after schema validation and refuses output paths that escape the selected root or traverse symlinks.

`harness verify` consumes explicit self-verification evidence shaped by `schemas/self-verification.schema.json`. It validates the evidence document and reports the statuses already recorded in `acceptance_checks`. It does not inspect harness structure, execute checks, run verifiers, run agents, or infer behavioral quality; structural inspection belongs to current `doctor`, while behavioral execution belongs to `eval` and `run`.

`harness report` summarizes the harness and optional artifact inputs while citing every artifact path it summarized. It can include doctor results, individual run-result JSON artifacts, traces, scoreboard summaries, and judge policy/result artifacts. `--run-result` expects one JSON object artifact; it does not parse multi-line `.jsonl` ledgers. If that run result links `judge_results`, report validates each linked judge result, its referenced policy, policy digest, and matching `run_id`.

With `--judge-result <path>`, report validates the result against `schemas/judge-result.schema.json`, resolves the local `policy_ref`, validates that policy against `schemas/judge-policy.schema.json`, checks the policy digest, and checks the result against the policy. `--judge-policy <path>` can be passed to summarize a policy directly or to require a result's `policy_ref` to match that explicit policy.

Judge outputs are inferential evidence, not deterministic verifier results. Run results may link them with `judge_results`, but judge findings do not rewrite `status`, `execution.verifier_status`, `verifier_result`, or scoreboard failure buckets. Future CI/plugin adapters must consume the same judge policy artifacts rather than inventing their own blocking rules.

An LLM judge result can be `blocking` only when report validation confirms all of the following:

- the result references the same `policy_id` and `judge_id` as the policy;
- the agreement metric matches the policy;
- the policy digest matches the referenced policy artifact bytes;
- the labeled sample count is at least the policy minimum;
- the result's agreement score matches its calibration examples;
- the calibration status is `passed`;
- the agreement score is at or above the numeric blocking threshold;
- the artifact timestamps show the calibration is not stale or from the future.

Uncalibrated, below-threshold, and stale judge results are advisory-only. Staleness is recorded by the result producer as `calibration.status: stale`; `harness report` also checks artifact timestamps against `stale_after_days` without using wall-clock time, so reviewing the same artifact remains reproducible.

The starter policy uses `percent_agreement` with `labeled_sample_minimum: 5` and `blocking_threshold: 0.8`. A passing calibration example is `4 matching labels / 5 labeled samples = 0.8`, which can support blocking if the result is otherwise valid. A failing example is `3 / 5 = 0.6`; it must be recorded as `below-threshold` and advisory-only. If a previously passing judge is marked `stale`, it is also advisory-only until fresh calibration evidence is produced.

## Root path semantics

`harness init` can create or overwrite starter-managed files, so its `--root` value must stay inside the current working directory. Run `init` from the target repository root, or pass a child directory with `--root`.

The read/report commands (`adapter validate`, `assess`, `loop validate`, `validate`, `doctor`, `trace validate`, `verify`, `report`) and the no-op `migrate` command may point `--root` at another checkout for inspection. Unlike those read/report commands, `harness eval validate`, `harness run`, and `harness eval run` may execute declaration-gated verifier commands in the selected root, including when `--root` points at another checkout. User-provided scope, matrix, file, continuity, verification, task, spec, artifact, doctor-output, eval-output, trace-output, scoreboard-output, assessment input, repair-action, repair-actions-dir, and migration-output paths are still constrained to the selected root; `--trusted-repair-action` accepts only a safe repair-action id. Doctor output, eval output, verifier-result output, trace output, scoreboard output, migration output, and init writes also reject symlinked write targets.

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

For `harness report`, invalid judge policy/result schemas or judge results that attempt to block without satisfying their referenced policy exit `1`.

For `harness adapter validate`, adapter-scope schema errors, capability-matrix schema errors, and subset violations exit `1`.

For `harness assess`, missing or incomplete substrate evidence is reported inside the assessment with `status: missing-harness` or `status: needs-work` while the command exits `0`. Usage errors, root escapes, symlinked inputs, and internal output-schema violations still use the standard non-zero exit codes.

For `harness loop validate`, continuity/self-verification schema errors and startup/completion gate violations exit `1`. Missing required command options such as `--continuity` or complete-phase `--verification` exit `2`.

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
