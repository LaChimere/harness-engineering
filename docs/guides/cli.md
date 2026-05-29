# CLI guide

The deterministic `harness` CLI validates harness configuration, runs local evidence-producing checks, and summarizes existing artifacts. It consumes local schemas and examples; it does not install host plugins, run CI services, schedule profiles, or execute models.

## Invocation

For brevity, commands in this guide are written as `harness <command>`. Until the package is published, substitute the equivalent invocation for your context:

| Context | Substitution |
|---|---|
| In this repository after `bun run build` | `node dist/index.js <command>` |
| In a downstream repo with `export HARNESS_BIN="$(pwd)/dist/index.js"` set from this checkout | `node "$HARNESS_BIN" <command>` |
| After registry publication (future) | `harness <command>` |

Behavior is identical across the three forms.

## Glossary

- **Substrate**: root `harness.yaml`, versioned `schemas/`, and user-editable support files under `.harness/**`.
- **Evidence**: schema-validated JSON or Markdown the CLI writes to `.harness/outputs/**`.
- **GC** (garbage collection): `harness gc audit` looks for entropy in evidence and proposes reviewable cleanup slices; it never deletes.
- **Profile**: a recurring maintenance contract (see `.harness/profiles/gc-stability.yaml` after `harness init`) that consumes existing evidence and emits a handoff artifact. Profiles do not schedule themselves.
- **Scoreboard**: behavioral eval summary evidence produced outside the Harness CLI or provided as calibration data.
- **External evidence**: candidate output, traces, scoreboards, or reports produced outside the Harness CLI and then supplied to evidence-consuming commands.
- **Broken-twin**: an eval fixture that is expected to fail verification (the inverse of an oracle), used to prove the verifier discriminates.

## Command overview

```bash
harness init
harness validate
harness doctor --format json --output .harness/outputs/doctor/doctor.json
harness health --accept-unsandboxed-execution --format json --output .harness/outputs/health/health.json
harness verify --spec path/to/self-verification.yaml
harness eval validate --output .harness/outputs/run-results.jsonl
harness trace validate
harness gc audit --format json --output .harness/outputs/gc/gc.json
harness profile validate .harness/profiles/gc-stability.yaml
harness profile run .harness/profiles/gc-stability.yaml --gc-evidence .harness/outputs/gc/gc.json --health-result .harness/outputs/health/health.json --output .harness/outputs/profile-runs/gc-stability.json
harness assess --format json --health-result .harness/outputs/health/health.json
harness report --doctor-result .harness/outputs/doctor/doctor.json
```

These examples assume you are in a repository after `harness init`. The packaged `examples/**` tree is only for this repository's fixtures and docs; initialized user projects keep editable harness support files under `.harness/**` and generated evidence under `.harness/outputs/**`.

## Bootstrap and validation

`harness init` writes a starter baseline and refuses to overwrite starter-managed files unless `--force` is passed.

`harness validate` checks `harness.yaml`, CLI/schema engine ranges, and composed local references. It does not execute doctor checks, eval verifiers, agents, or migrations.

`harness migrate` currently emits dry-run/no-op migration evidence only; passing `--apply` is rejected.

## Structural and local project checks

`harness doctor` runs deterministic structural checks and can write JSON or Markdown output.

`harness health` executes declared local project health checks. Because this path executes repository-declared commands, it requires `--accept-unsandboxed-execution`. The result records trust requirements, declarative sandbox evidence, command status, and linked artifacts.

`harness verify` consumes an explicit self-verification spec (see this repository's `examples/verification/self-verification.yaml`) and records the spec's declared statuses. It does not execute checks itself; failed or blocked acceptance checks cause a `validation-error` exit.

## Evaluation evidence

`harness eval validate` runs verifier-only eval validation against oracle and broken-twin candidates. It records verifier evidence and a run-result ledger but does not run agents or produce scoreboards. With `--output <path>`, it appends run-results to `<path>` (typically `.harness/outputs/run-results.jsonl`) and writes verifier artifacts under `.harness/outputs/verifier-results/`.

Run-result, trace, and scoreboard artifacts can also be produced by external agent workflows and supplied to `harness assess` or `harness report`. Harness validates these artifacts as evidence; it does not execute the agent or model that produced them.

## Trace, report, and assessment

`harness trace validate` validates configured trace examples or one explicit trace artifact. `harness trace import` copies already-normalized trace evidence after schema validation.

`harness report` summarizes selected artifacts and cites source paths.

`harness assess` is read-only. It summarizes existing harness, doctor, health, run-result, trace, scoreboard, report, and repair-action artifacts. It does not execute repairs, shell commands, evals, agents, migrations, or implementation loops.

## GC and profiles

`harness gc audit` emits reviewable findings and proposed cleanup slices. It is read-only and exits successfully even when findings are present, so use the JSON evidence for review or a separate explicit policy gate.

`harness profile validate` validates a recurring-profile contract. `harness profile run` executes one deterministic profile run against supplied evidence and emits profile-run handoff evidence. Profiles do not schedule themselves, run cleanup, call models, or mutate the capability ledger.

## Exit semantics

| Code | Name | Meaning |
|---:|---|---|
| 0 | `ok` | The command completed successfully. |
| 1 | `validation-error` | Input was found, but schema validation, doctor status, eval validation status, or explicit verification status failed. |
| 2 | `usage-error` | The command line arguments are invalid or required arguments are missing. |
| 3 | `not-found` | A required input file or directory does not exist. |
| 4 | `incompatible-engines` | The harness declares CLI or schema engine ranges that this CLI cannot satisfy. |
| 5 | `health-failure` | Local project health checks executed, but one or more checks failed. |
| 70 | `internal-error` | The CLI hit an unexpected internal failure. |
