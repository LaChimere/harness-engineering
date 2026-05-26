# Evidence and artifacts

Harness Engineering turns repository and agent activity into schema-backed evidence. Most commands either validate existing artifacts or produce new artifacts under `.harness/outputs/`.

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

`harness init` creates editable support files directly under `.harness/**` and generated evidence/output directories under `.harness/outputs/**`. The default output directories and run-result ledger are:

- `.harness/outputs/doctor/`
- `.harness/outputs/health/`
- `.harness/outputs/gc/`
- `.harness/outputs/verifier-results/`
- `.harness/outputs/traces/`
- `.harness/outputs/agent-outputs/`
- `.harness/outputs/scoreboards/`
- `.harness/outputs/profile-runs/`
- `.harness/outputs/continuity/`
- `.harness/outputs/handoffs/`
- `.harness/outputs/approvals/`
- `.harness/outputs/reports/`
- `.harness/outputs/run-results.jsonl` (empty append-only ledger)

User-editable support files such as policies, checks, eval tasks, profiles, and trace examples stay outside `outputs`, for example `.harness/policies/sandbox-policy.yaml`, `.harness/checks/doc-links.yaml`, and `.harness/profiles/gc-stability.yaml`.

`harness init` writes `.harness/.gitignore` so generated `outputs/` are ignored while the editable support files stay commit-ready. If your root `.gitignore` already ignores `.harness/` wholesale, adjust it to ignore `.harness/outputs/` instead.

If you initialized a project with an older preview layout, update output references from flat `.harness/<kind>/` paths to `.harness/outputs/<kind>/`, move or regenerate old evidence as needed, and replace any root `.gitignore` rule that ignores all of `.harness/` with a narrower `.harness/outputs/` rule.

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
  --doctor-result .harness/outputs/doctor/doctor.json \
  --health-result .harness/outputs/health/health.json \
  --run-results .harness/outputs/run-results.jsonl
```

Assessment output is read-only. It reports missing or partial primitives and can route to native execution-loop guidance or trusted repair-action artifacts, but it never executes repairs or shell commands.
