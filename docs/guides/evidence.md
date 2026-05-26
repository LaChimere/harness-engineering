# Evidence and artifacts

Harness Engineering turns repository and agent activity into schema-backed evidence. Most commands either validate existing artifacts or produce new artifacts under `.harness/`.

## First evidence loop

A typical adoption loop is:

| Step | Command | Why run it? | Main output |
|---|---|---|---|
| 1 | `harness validate` | Confirm `harness.yaml`, schema versions, and local references are coherent before executing anything. | validation result / exit code |
| 2 | `harness doctor` | Inspect deterministic harness structure without running repository commands. | `doctor-result` |
| 3 | `harness health` | Run reviewed local project checks and record trust/sandbox evidence. | `health-result` |
| 4 | `harness run` / `harness eval run` | Produce deterministic candidate, verifier, trace, and scoreboard evidence. | `run-result`, `trace`, `scoreboard` |
| 5 | `harness gc audit` | Find entropy and propose reviewable cleanup slices without applying them. | `gc-evidence` |
| 6 | `harness profile run` | Consume existing evidence for a recurring profile handoff. | `profile-run` |
| 7 | `harness assess` / `harness report` | Summarize maturity and cite evidence for review or CI. | `assessment`, report |

## Core artifacts

| Artifact | Produced by | Purpose |
|---|---|---|
| `doctor-result` | `harness doctor` | Structural harness checks. |
| `health-result` | `harness health` | Declared local project health checks. |
| `verifier-result` | `harness eval validate`, `harness run`, `harness eval run` | Deterministic verifier outcome. |
| `run-result` | `harness run`, `harness eval run`, `harness eval validate` | Execution or verifier-only result ledger entry. |
| `trace` | `harness run`, `harness eval run` | Normalized action and artifact trace. |
| `scoreboard` | `harness eval run` | Behavioral eval summary. |
| `gc-evidence` | `harness gc audit` | Entropy findings and reviewable cleanup slices. |
| `profile-run` | `harness profile run` | Recurring profile trigger/stop/handoff evidence. |
| `assessment` | `harness assess` | Read-only maturity and routing summary. |

Concrete example artifacts shipped with this repository:

- `examples/doctor/results/pass.json`
- `examples/health/results/pass.json`
- `examples/gc/evidence.json`
- `examples/traces/native-cli-trace.json`
- `examples/scoreboards/self-test.json`
- `examples/profile-runs/gc-stability-clean.json`
- `examples/assessments/repair-action-routing.json`

## Evidence directories

`harness init` creates the following directories and the run-result ledger in your target repository:

- `.harness/doctor/`
- `.harness/health/`
- `.harness/gc/`
- `.harness/verifier-results/`
- `.harness/traces/`
- `.harness/agent-outputs/`
- `.harness/scoreboards/`
- `.harness/profiles/`
- `.harness/continuity/`
- `.harness/handoffs/`
- `.harness/approvals/`
- `.harness/run-results.jsonl` (empty append-only ledger)

CI recipes typically create `.harness/reports/` themselves before writing summary artifacts; see [CI recipes](ci.md).

Commands that write artifacts constrain output paths to the selected repository root and reject symlinked write targets.

## Current evidence boundaries

- `doctor` is structural and does not execute local checks.
- `health` executes declared local commands only after explicit acknowledgement.
- `eval validate` verifies oracle and broken-twin examples without running agents.
- `run` and `eval run` use deterministic stub execution unless you explicitly import an external candidate.
- `external-import` evidence records candidate provenance and zero provider usage; it is not live-model evidence.
- `gc audit` is read-only and does not apply cleanup.
- `profile run` consumes evidence and emits a handoff; it does not schedule itself or mutate repository files beyond a requested output artifact.

## Assessing evidence

Use `harness assess` to read existing artifacts:

```bash
harness assess --format json \
  --doctor-result .harness/doctor/doctor.json \
  --health-result .harness/health/health.json \
  --run-results .harness/run-results.jsonl
```

Assessment output is read-only. It reports missing or partial primitives and can route to native execution-loop guidance or trusted repair-action artifacts, but it never executes repairs or shell commands.
