# Harness schema conventions

The machine-checkable substrate is defined before any CLI, plugin, CI adapter, or skill consumes it. Deterministic CLI commands and offline report validation consume the runner, trace, run-result, scoreboard, judge-policy, and judge-result schemas. The agent/CLI capability matrix revalidates the provisional plugin-capability and repair-action posture before any adapter consumes it. The adapter-scope manifest and subset validator cover the selected limited-adapter target without making the adapter a separate source of truth. Native execution-loop validation consumes the existing continuity-state and self-verification schemas as the evidence contract rather than adding a skill-only artifact shape.

All schemas use JSON Schema draft 2020-12 and local relative `$ref` links. Validation tools should load every file in `schemas/` into an offline registry keyed by each schema's versioned `$id`; validation must not require network access.

## Versioning

Every machine-readable harness artifact includes `schema_version`. Compatibility across artifacts is declared in `harness.yaml` with `engines.schemas`, a per-schema map such as:

```yaml
engines:
  schemas:
    harness: ">=0.1 <0.2"
    agent-runner: ">=0.1 <0.2"
```

The schema validates artifact shape; the CLI enforces compatibility ranges and migration rules. Canonical schema IDs include the schema family version, for example `https://lachimere.github.io/harness-engineering/schemas/0.1/harness.schema.json`; future releases may add aliases, but validation must resolve the versioned IDs offline.

Schemas marked `x-stability: provisional` are still allowed to evolve within the unreleased `0.1` family while this platform is being built. Consumers that depend on a provisional schema shape should pin a repository commit as well as a schema range until a stable schema family is published.

## Composition

`harness.yaml` composes repo-local artifact references rather than embedding all details. This keeps policies, evals, traces, runners, continuity state, and GC evidence independently versioned and reviewable.

The root harness schema is closed with `unevaluatedProperties: false`. Adapter-specific keys such as plugin or CI configuration are not valid in the harness root; those adapters must be added only after their contracts are defined.

## Trust and sandbox declarations

Local doctor checks, eval verifiers, and repair actions all reuse the same `trustRequirements` shape from `common.schema.json`. Each declaration states the trust level, required sandbox tier, network access, secret access, host-file access, and allowed inputs/outputs.

## Credentials and budgets

Agent runners reference credentials with `credential_reference`; they must not embed secret values. Model execution also requires `budgets` with cost, request, and token limits so `harness run` can refuse unbounded runs deterministically. The deterministic runner accepts only non-secret `source: stub` credential references and recorded fixture outputs; live model credentials remain out of scope. External candidate imports use `source: external` to show that the model output was produced outside harness and imported for verification.

Trace and run-result artifacts record aggregate usage evidence with token, request, model, and cost fields so budgets can be audited after execution. Agent-run traces also require the credential reference and budget contract that governed the run.

## Eval and run-result execution semantics

Eval tasks declare suite/task identity, task version, dataset hash, optimization or holdout split, verifier command, timeout, oracle/baseline artifacts, and verifier trust requirements. `harness eval validate` recomputes the dataset hash before execution and refuses to run verifier commands whose trust declaration asks for network, secret, host-file, or any sandbox tier other than `process`. It enforces the declaration contract before execution; runtime sandbox enforcement belongs to future runner hardening.

Run results include an `execution` block. `verifier-only` records separate `harness_status` and `verifier_status` fields. `agent-run` records `harness_status`, `verifier_status`, `agent_status`, and `model_status`, and must link to a real trace artifact rather than the verifier-only sentinel trace. `external-import` records a candidate generated outside harness, keeps `model_status` absent, requires external zero-usage accounting, and cannot be labeled as an `eval` agent run. Assessment treats external imports as separately labelled import evidence rather than counted agent-run evidence. Linked deterministic verifier evidence is shaped by `verifier-result.schema.json`.

Scoreboards summarize agent-run ledgers by optimization/holdout split and total counts. Their failure buckets explicitly separate `agent-failure`, `model-failure`, `harness-error`, `verifier-error`, `verification-failure`, `budget-exceeded`, and `credential-missing` so behavioral regressions do not collapse into one opaque failure class. The broken-twin fixture intentionally contributes an `agent-failure` bucket while the overall eval run can still pass because that negative control failed as expected.

## Project health evidence

`health-result.schema.json` records local project health checks executed by `harness health`. Health checks are declared in the optional `health` block of `harness.yaml` and reuse the shared `trustRequirements` shape plus the harness's approval and sandbox policy artifacts. The current health runner is declaration-gated and records `sandbox_enforcement: declarative` plus `runtime_enforced: false`; it refuses network, secret, host-file, missing artifact, and unsafe declarations rather than pretending to enforce a stronger runtime sandbox. `harness assess` consumes health-result evidence through scorecard version `0.2.0` as a distinct `project-health` dimension, separate from structural doctor evidence.

`runner-readiness.schema.json` records non-executing readiness checks for agent runners. `harness runner readiness` preserves the deterministic stub path while validating that a future live runner has an explicit environment credential reference, hard cost/token/request budgets, approval and sandbox policy artifacts, a live model profile, repo-local trace output, exact env-only credential scoping, and a schema-defined trace-redaction allowlist that refuses credential environment variable references.

`recurring-profile.schema.json` defines deterministic maintenance profile contracts with structured evidence inputs, trigger thresholds, stop conditions, allowed actions, handoff metadata, and trust requirements. Recurring profiles are single-run CLI consumers of substrate artifacts; scheduling and persistence are external. `profile-run.schema.json` records one profile execution with hashed evidence inputs, trigger and stop-condition observations, deterministic summary actions, optional previous-run continuity, and a handoff decision. The GC stability MVP consumes GC and health evidence; it does not run cleanup, mutate the capability ledger, call models, or create prompt-only profile state.

## Judge policy and inferential review

`judge-policy.schema.json` defines the calibration contract for LLM-mediated review. A policy must include a rubric, labeled sample minimum, agreement metric, numeric blocking threshold, uncertainty notes, stale-calibration window, and below-threshold consequence. The starter policy uses `percent_agreement`; `4 / 5 = 0.8` meets its blocking threshold, while `3 / 5 = 0.6` is below threshold and therefore advisory-only.

`judge-result.schema.json` stores inferential judge output separately from deterministic verifier results. The schema prevents uncalibrated, below-threshold, or stale results from being marked blocking. `harness report` then recomputes the policy relationship from the referenced policy artifact: matching policy/judge ids, policy digest, agreement metric, labeled sample count, threshold, and artifact-timestamp freshness. A result producer marks stale calibration explicitly with `calibration.status: stale`; report validation does not use wall-clock time.

`run-result.schema.json` can link judge results through `judge_results`, but judge findings do not fold into `status`, `execution.verifier_status`, `verifier_result`, or scoreboard failure buckets. Later optional CI/plugin adapters must use the same policy/result artifacts if they choose to display or enforce calibrated judge output.

## Agent/CLI adapter feasibility

`plugin-capability-matrix.schema.json` is the durable feasibility artifact for agent/CLI marketplace or install surfaces. Matrix rows reuse `plugin-capability.schema.json` so per-host capability evidence has one schema-backed shape. The matrix records stable `evidence_id` values, capability statuses (`yes`, `partial`, `no`, `unknown`), fallback behavior, CLI management modes, capability tier, and adapter consequence for each evaluated host.

`examples/plugin-capabilities/agent-cli-capability-matrix.json` records the agent/CLI capability decision: Codex CLI, Claude Code, and GitHub Copilot CLI reach limited-adapter tier; Gemini CLI remains CLI-first fallback because bootstrap and background-agent support are not proven enough for limited-adapter scope. GitHub Copilot CLI is selected as the first limited-adapter target. No full-plugin target is claimed; under current evidence, full-plugin remains aspirational until every rich UX capability is proven.

`adapter-scope.schema.json` and the canonical `examples/adapters/github-copilot-cli/adapter-scope.json` declare implemented capabilities, unavailable capabilities, fallback behavior, selected-host evidence ids, CLI/schema compatibility, write-class modes, non-authoritative local state, and trust boundaries. `harness adapter validate` and fixture custom checks prove that scope is a subset of the selected host row in the capability matrix.

`repair-action.schema.json` remains provisional, but distinguishes `repair_mode: preview-backed` from `repair_mode: advisory-only`. Preview-backed repair actions still require `preview_diff`; advisory-only repairs omit preview diffs, include an advisory block, and redirect write execution to equivalent CLI commands.

## Execution-loop evidence

Native execution-loop validation does not add a new execution-loop schema. Instead, `harness loop validate` composes existing substrate artifacts: `harness.yaml` references approval and sandbox policy artifacts; continuity state records startup verification, progress, git checkpoint, and handoff links; self-verification evidence records spec rereads, acceptance checks, command evidence, artifacts, and unresolved risks.

The native loop gate requires recorded evidence rather than inferred agent behavior. Startup validation requires a passed startup verification command matching `harness.continuity.startup_smoke_test`, linked self-verification evidence, and a progress log recording startup before later work. Completion validation additionally requires passed self-verification evidence with required acceptance-check IDs for original spec reread, acceptance-criteria comparison, approval policy handling, sandbox policy handling, startup continuity update, and handoff readiness; evidence links to the approval and sandbox policy artifacts; and recorded passed `harness validate` and `harness doctor` checks whose command strings start with recognized harness invocations. Any external producer of these artifacts must conform to the schemas and CLI validation gates; this repository does not endorse external workflow skills as adapters.

## Taxonomies

`failure-taxonomy.schema.json` validates taxonomy structure. The starter taxonomy data lives in `examples/failure-taxonomy.yaml` and is checked by the fixture validator so future taxonomy content can evolve through data and CLI checks rather than by rewriting the structural schema.

`gc-evidence.schema.json` uses a closed category set. Current categories cover mechanical harness structure (`broken-reference`, `duplicate-id`, `stale-schema-version`) and evidence-backed validation gaps (`verification-evidence`, `execution-evidence`, `eval-evidence`, `trace-evidence`, `judge-calibration`). New GC categories should be added through a schema-versioned change with fixtures, algorithms, and false-positive policy.

GC expansion depends on this judge calibration policy before any inferential judge evidence can promote or retire durable rules.

## Fixture validation

Schema work ships canonical valid examples, focused invalid fixtures, and custom semantic checks for invariants that JSON Schema cannot express. Capability-matrix custom checks are mandatory for consumers because they validate selected-host consistency, evidence-id references, tier thresholds, and out-of-scope surface boundaries that plain JSON Schema cannot fully express. Adapter-scope custom checks are mandatory because they validate selected-host alignment, capability subset claims, CLI-management-mode subsets, evidence-id references, write-class limits, and non-authoritative adapter state. Execution-loop semantic negatives under `examples/fixtures/execution-loop/` are registered as schema-valid artifacts in the manifest, then rejected by `harness loop validate` CLI tests. Completion `spec_reread.status` remains recorded self-verification evidence; execution-loop validation does not infer the original spec path from `harness.yaml`. Install validator dependencies outside the repository and run:

```bash
python3 -m pip install --target "${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" -r examples/fixtures/requirements.txt
PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py
```

The validator uses `jsonschema` draft 2020-12 with format assertions enabled and an offline registry populated from local schema files.
