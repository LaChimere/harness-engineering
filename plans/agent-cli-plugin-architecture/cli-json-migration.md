# CLI JSON migration plan

## Scope

PR 3 records the migration plan for agent-facing JSON outputs. It does not change command output behavior. The implementation PRs that follow this plan must update schemas, command code, fixtures, tests, and docs in the same clean pre-release slice without dual-field compatibility shims.

Agent-facing commands in scope:

- `harness doctor --format json`
- `harness health --format json`
- `harness assess --format json`
- `harness gc audit --format json`
- `harness trace validate --format json`
- `harness profile run --format json`

Out of scope:

- `harness validate` JSON output; agents should use `doctor --format json`.
- Universal `success` flags.
- `next_actions`.
- Collapsing command-specific details such as doctor `checks`, health check details, assessment `missing_primitives` / `recommendations`, GC `findings`, trace validation entries, or profile `handoff`.

## Inventory evidence

The current-state inventory was refreshed after PR 2 from a temporary initialized project under `.harness/tmp-pr3-inventory` and the checked-in examples. The temporary project was ignored local state and is not part of the repository.

Summary of observed output shapes:

| Command | Current top-level keys | Current status source | Current issue shape |
|---|---|---|---|
| `doctor --format json` | `schema_version`, `run_id`, `harness_version`, `status`, `checks` | Top-level `status`: `passed`, `failed`, `warning`. | No top-level `issues`; per-check `outcome`, `severity`, `evidence`, `remediation`, and trust metadata. |
| `health --format json` | `schema_version`, `run_id`, `harness_version`, `status`, `sandbox_enforcement`, `runtime_enforced`, `source`, `checks` | Top-level `status`: `passed`, `failed`, `error`. | No top-level `issues`; per-check `failure_code`, `summary`, stdout/stderr, artifacts, and trust metadata. |
| `assess --format json` | `schema_version`, `x-stability`, `assessment_id`, `adapter_path`, `source`, `status`, `maturity`, `scorecard_version`, `scorecard`, `missing_primitives`, `rollout_plan`, `recommendations`, `implementation_routing`, `artifacts_read` | Top-level `status`: `ready`, `needs-work`, `missing-harness`. | No top-level `issues`; product gaps are `missing_primitives` and `recommendations`. |
| `gc audit --format json` | `schema_version`, `audit_id`, `generated_at`, `findings` | No top-level status. Command semantics distinguish clean vs findings by `findings.length`. | No top-level `issues`; `findings[]` are cleanup findings, not command failures. |
| `trace validate --format json` | `schema_version`, `status`, `traces` | Top-level `status`: `passed`, `failed`; per-trace `status`: `passed`, `failed`. | Per-trace `issues: string[]`; no top-level structured `issues`. |
| `profile run --format json` | `schema_version`, `run_id`, `harness_version`, `generated_at`, `profile_ref`, `profile_id`, `profile_version`, `declared_capability_id`, `evidence_inputs`, `trigger_evaluation`, `stop_condition_evaluation`, `actions_taken`, `handoff`, `errors` | `handoff.status`: `met`, `not_met`, `inconclusive`; no top-level `status`. | Required `errors: string[]`; no structured `issues`. |

## Shared contract base

The shared TypeScript contract scaffold lives in `src/lib/cli-json-contract.ts`:

- `ICliJsonContract`
- `ICliJsonIssue`
- `ICliJsonArtifact`

The base contract intentionally treats `status` as an opaque string. Closed status vocabularies remain schema-specific. The interfaces are scaffolding only in PR 3; command handlers should adopt them in the command-hardening PRs that change output behavior.

## Status semantics for skills

| Command | Ready / acceptable statuses | Actionable statuses | Notes |
|---|---|---|---|
| `doctor` | `passed` | `warning`, `failed` | Skills should inspect non-passing `checks[]`; `warning` is not a hard command failure but needs attention. |
| `health` | `passed` | `failed`, `error` | Skills should inspect check-level status, `failure_code`, and summaries. |
| `assess` | `ready` | `needs-work`, `missing-harness` | `recommendations` and `missing_primitives` are product guidance, not command failures. |
| `gc audit` | `passed` after adding status | `findings` after adding status | `findings[]` remain GC domain findings and must not be converted wholesale into `issues[]`. |
| `trace validate` | `passed` | `failed` | Per-trace validation strings migrate to structured issues in a dedicated command-result schema. |
| `profile run` | `met` after mirroring `handoff.status` to top-level `status` | `not_met`, `inconclusive` | `handoff` remains canonical for profile-specific decisions. |

## Per-schema migration plan

### `doctor-result.schema.json`

Target version: `0.2.0`.

Changes:

- Add required top-level `generated_at`.
- Add optional top-level `issues: ICliJsonIssue[]` derived from non-passing checks.
- Keep `checks[]` as the canonical doctor detail.

Issue mapping:

- For each check whose `outcome` is `failed`, create an issue:
  - `code`: check `id`
  - `severity`: check `severity`
  - `message`: check `remediation` or a deterministic summary from the outcome
  - `evidence`: check `evidence`

Implementation notes:

- Update doctor JSON fixtures and tests in the same PR.
- Do not add compatibility for missing `generated_at`; this is pre-release.

### `health-result.schema.json`

Target version: `0.2.0`.

Changes:

- Add required top-level `generated_at`.
- Add optional top-level `issues: ICliJsonIssue[]` derived from failed/error/skipped checks.
- Keep `checks[]` as the canonical health detail.

Issue mapping:

- For each check whose `status` is not `passed`, create an issue:
  - `code`: check `failure_code` when present, otherwise check `id`
  - `severity`: `error` for `failed`/`error`, `warning` for `skipped`
  - `message`: check `summary`
  - `evidence`: check `evidence`

Implementation notes:

- Preserve `sandbox_enforcement` and `runtime_enforced` as health-specific trust-boundary fields.
- If `--output` is supplied, current stdout is human text; a later behavior change must decide whether `--format json --output` should still print JSON or keep the file as the JSON contract.

### `assessment.schema.json`

Target version: `0.2.0`.

Changes:

- Add top-level `harness_version`.
- Add top-level `generated_at`.
- Keep `assessment_id`; do not rename it to `run_id`.
- Keep `source` for input provenance, but rename `source.cli_version` to `source.harness_version` in the same clean migration.
- Add optional top-level `issues` only for command/contract problems that block machine consumption.

Intentional deferrals:

- `missing_primitives` and `recommendations` stay product guidance and do not become `issues`.
- `x-stability` remains as long as the assessment schema is provisional.

### `gc-evidence.schema.json`

Target version: `0.2.0`.

Changes:

- Add required top-level `status` with `passed` or `findings`.
- Add required top-level `harness_version`.
- Add optional top-level `issues` only for audit/contract problems, not for ordinary GC findings.

Status mapping:

- `passed`: `findings.length === 0`
- `findings`: `findings.length > 0`

Implementation notes:

- Keep `audit_id` rather than forcing `run_id`; GC audits already have a domain-specific identity.
- Keep `findings[]` as the canonical GC detail.

### Trace validation command result

Target schema: add `trace-validate-result.schema.json` at `0.1.0`.

Changes:

- Validate the command result itself, not just trace artifacts.
- Keep top-level `schema_version`, `status`, and `traces[]`.
- Convert per-trace `issues: string[]` to structured `issues: ICliJsonIssue[]`.
- Add optional top-level `issues` summarizing failed trace entries as aggregate command-result issues.

Per-trace issue mapping:

- `code`: stable trace validation code chosen by the implementation PR.
- `severity`: `error`.
- `message`: existing issue string.
- `path`: JSON/schema path segments when the validator provides them.
- `details`: structured validator metadata such as keyword, instance path, schema path, and validator params.
- `evidence`: the trace artifact path from the surrounding `traces[]` entry.

Intentional deferrals:

- Trace artifact-local `actions[].errors[]` remain domain detail inside trace artifacts.

### `profile-run.schema.json`

Target version: `0.2.0`.

Changes:

- Add required top-level `status` mirroring `handoff.status`.
- Replace required `errors: string[]` with optional structured `issues: ICliJsonIssue[]`.
- Keep `handoff` as the canonical profile decision detail.

Issue mapping:

- Each current `errors[]` string becomes an issue:
  - `code`: `profile-run-error` unless the implementation can choose a more specific stable code at the source.
  - `severity`: `error` for command failures, `warning` for not-met profile conditions that still produce usable handoff evidence.
  - `message`: existing error string.
- Non-`met` profile outcomes also produce one warning issue:
  - `code`: `profile-stop-condition-not-met` for `not_met`, or `profile-inconclusive` for `inconclusive`.
  - `severity`: `warning`.
  - `message`: the handoff summary.

Implementation notes:

- Do not keep both `errors` and `issues`; this is pre-release.
- Update examples, schema fixtures, report/assessment consumers, and profile tests in the same PR.

## Golden fixture plan

Each command-hardening PR must add or update golden fixtures for both passing and non-passing output where practical:

- `doctor`: passing fixture and reference-failure fixture.
- `health`: passing fixture and unsafe/missing-artifact fixture.
- `assess`: `ready`, `needs-work`, and `missing-harness` fixtures.
- `gc audit`: clean and findings fixtures.
- `trace validate`: passing and invalid-trace fixtures.
- `profile run`: `met`, `not_met`, and invalid-input/error fixtures.

Golden tests should validate:

- schema conformance,
- stable status vocabulary,
- structured issue shape,
- preservation of command-specific detail fields.

## Clean pre-release migration strategy

- No dual-field compatibility shims for old command-result shapes.
- Update first-party code, schemas, fixtures, tests, examples, and docs in the same PR that changes a command output.
- Do not silently upgrade persisted harness/schema versions. Persisted harness upgrades still require previewable `harness migrate` evidence.
- The command-result and generated evidence schema changes in this plan regenerate checked-in examples and fixtures in place; they do not migrate a persisted `harness.yaml` substrate, so fixture validation and golden parity are the migration evidence for this clean pre-release command-output break.
- Keep each hardening PR grouped by command family as defined in `plan.md`.
