# Harness schema conventions

Stage 2 defines the machine-checkable substrate before any CLI, plugin, CI adapter, or skill consumes it. Stage 6 now consumes the runner, trace, run-result, and scoreboard schemas through deterministic stub CLI commands.

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

## Taxonomies

`failure-taxonomy.schema.json` validates taxonomy structure. The starter taxonomy data lives in `examples/failure-taxonomy.yaml` and is checked by the Stage 2 fixture validator so future taxonomy content can evolve through data and CLI checks rather than by rewriting the structural schema.

`gc-evidence.schema.json` intentionally starts with a closed deterministic category set: `broken-reference`, `duplicate-id`, and `stale-schema-version`. New GC categories should be added through a schema-versioned change with fixtures, algorithms, and false-positive policy.

## Fixture validation

Stage 2 ships canonical valid examples and focused invalid fixtures. Install validator dependencies outside the repository and run:

```bash
python3 -m pip install --target /tmp/harness-schema-validation -r examples/fixtures/requirements.txt
PYTHONPATH=/tmp/harness-schema-validation python3 examples/fixtures/validate.py
```

The validator uses `jsonschema` draft 2020-12 with format assertions enabled and an offline registry populated from local schema files.
