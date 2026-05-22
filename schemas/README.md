# Harness schema conventions

Stage 2 defines the machine-checkable substrate before any CLI, plugin, CI adapter, or skill consumes it. Stage 7 consumes the runner, trace, run-result, scoreboard, judge-policy, and judge-result schemas through deterministic CLI commands and offline report validation. Stage 8 revalidates the provisional plugin-capability and repair-action posture through an agent/CLI capability matrix before any Stage 9 adapter consumes it.

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

The root harness schema is closed with `unevaluatedProperties: false`. Adapter-specific keys such as plugin or CI configuration are not valid in the Stage 2 harness root; those adapters must be added only after their stages define them.

## Trust and sandbox declarations

Local doctor checks, eval verifiers, and repair actions all reuse the same `trustRequirements` shape from `common.schema.json`. Each declaration states the trust level, required sandbox tier, network access, secret access, host-file access, and allowed inputs/outputs.

## Credentials and budgets

Agent runners reference credentials with `credential_reference`; they must not embed secret values. Model execution also requires `budgets` with cost, request, and token limits so `harness run` can refuse unbounded runs deterministically. The Stage 6 runner accepts only non-secret `source: stub` credential references and recorded fixture outputs; live model credentials remain out of scope.

Trace and run-result artifacts record aggregate usage evidence with token, request, model, and cost fields so budgets can be audited after execution. Stage 6 traces also require the credential reference and budget contract that governed the run.

## Eval and run-result execution semantics

Eval tasks declare suite/task identity, task version, dataset hash, optimization or holdout split, verifier command, timeout, oracle/baseline artifacts, and verifier trust requirements. Stage 5 `harness eval validate` recomputes the dataset hash before execution and refuses to run verifier commands whose trust declaration asks for network, secret, host-file, or any sandbox tier other than `process`. Stage 5 enforces the declaration contract before execution; runtime sandbox enforcement belongs to a later runner stage.

Run results include an `execution` block. `verifier-only` records separate `harness_status` and `verifier_status` fields. `agent-run` records `harness_status`, `verifier_status`, `agent_status`, and `model_status`, and must link to a real trace artifact rather than the verifier-only sentinel trace.

Scoreboards summarize agent-run ledgers by optimization/holdout split and total counts. Their failure buckets explicitly separate `agent-failure`, `model-failure`, `harness-error`, `verifier-error`, `verification-failure`, `budget-exceeded`, and `credential-missing` so behavioral regressions do not collapse into one opaque failure class. Stage 6's broken-twin fixture intentionally contributes an `agent-failure` bucket while the overall eval run can still pass because that negative control failed as expected.

## Judge policy and inferential review

`judge-policy.schema.json` defines the calibration contract for LLM-mediated review. A policy must include a rubric, labeled sample minimum, agreement metric, numeric blocking threshold, uncertainty notes, stale-calibration window, and below-threshold consequence. The starter policy uses `percent_agreement`; `4 / 5 = 0.8` meets its blocking threshold, while `3 / 5 = 0.6` is below threshold and therefore advisory-only.

`judge-result.schema.json` stores inferential judge output separately from deterministic verifier results. The schema prevents uncalibrated, below-threshold, or stale results from being marked blocking. `harness report` then recomputes the policy relationship from the referenced policy artifact: matching policy/judge ids, policy digest, agreement metric, labeled sample count, threshold, and artifact-timestamp freshness. A result producer marks stale calibration explicitly with `calibration.status: stale`; report validation does not use wall-clock time.

`run-result.schema.json` can link judge results through `judge_results`, but Stage 7 does not fold judge findings into `status`, `execution.verifier_status`, `verifier_result`, or scoreboard failure buckets. Later optional CI/plugin adapters must use the same policy/result artifacts if they choose to display or enforce calibrated judge output.

## Agent/CLI adapter feasibility

Stage 8 adds `plugin-capability-matrix.schema.json` as the durable feasibility artifact for agent/CLI marketplace or install surfaces. Matrix rows reuse `plugin-capability.schema.json` so per-host capability evidence has one schema-backed shape. The matrix records stable `evidence_id` values, capability statuses (`yes`, `partial`, `no`, `unknown`), fallback behavior, CLI management modes, capability tier, and Stage 9 consequence for each evaluated host.

`examples/plugin-capabilities/stage8-agent-cli-capability-matrix.json` records the Stage 8 decision: Codex CLI, Claude Code, and GitHub Copilot CLI reach limited-adapter tier; Gemini CLI remains CLI-first fallback because bootstrap and background-agent support are not proven enough for limited-adapter scope. GitHub Copilot CLI is selected as the first limited-adapter target. No full-plugin target is claimed; under current evidence, full-plugin remains aspirational until every rich UX capability is proven.

`repair-action.schema.json` remains provisional. Stage 8 keeps preview-backed repair actions separate from limited-adapter advisory repair behavior; Stage 9 must extend repair or adapter-scope metadata before any host surface executes write-class repairs.

## Taxonomies

`failure-taxonomy.schema.json` validates taxonomy structure. The starter taxonomy data lives in `examples/failure-taxonomy.yaml` and is checked by the fixture validator so future taxonomy content can evolve through data and CLI checks rather than by rewriting the structural schema.

`gc-evidence.schema.json` intentionally starts with a closed deterministic category set: `broken-reference`, `duplicate-id`, and `stale-schema-version`. New GC categories should be added through a schema-versioned change with fixtures, algorithms, and false-positive policy.

Stage 15 GC expansion depends on this Stage 7 judge calibration policy before any inferential judge evidence can promote or retire durable rules.

## Fixture validation

Schema stages ship canonical valid examples, focused invalid fixtures, and custom semantic checks for invariants that JSON Schema cannot express. Stage 8 matrix custom checks are mandatory for consumers because they validate selected-host consistency, evidence-id references, tier thresholds, and out-of-scope surface boundaries that plain JSON Schema cannot fully express. Install validator dependencies outside the repository and run:

```bash
python3 -m pip install --target /tmp/harness-schema-validation -r examples/fixtures/requirements.txt
PYTHONPATH=/tmp/harness-schema-validation python3 examples/fixtures/validate.py
```

The validator uses `jsonschema` draft 2020-12 with format assertions enabled and an offline registry populated from local schema files.
