# Todo: Harness Engineering Platform

## Planning gate readiness

- [x] Confirm Gate 1 decisions in `design.md`.
- [x] Confirm Stage 1 is the first implementation target.
- [x] Decide whether to implement as one agent or split with `plan-parallel-work`.
  - Decision: Stage 1 is a documentation-only slice and was implemented by one agent; no parallel split needed.
- [x] Keep public docs honest about "available now" versus "planned".

### Planning gate acceptance criteria

- [x] The approved plan uses stage terminology consistently.
- [x] Every implementation stage has explicit acceptance criteria in `plan.md` and this file.
- [x] Stage 1 can start without unresolved design decisions beyond the Stage 1 decisions to document listed in `plan.md`.

## Stage 1: Product identity, entrypoints, and distribution decisions

- [x] Update README to present `LaChimere/harness-engineering` as the canonical harness-as-code platform.
- [x] Add quickstart matrix:
  - [x] CLI-first path documented as the current default; implementation planned for Stage 3.
  - [x] Marketplace plugin paths planned pending Stage 8.
  - [x] External `agent-coding` practice mining pending Stage 13.
  - [x] Optional CI after Stage 11.
- [x] Add or update AGENTS/contribution guidance for this clean-slate repo.
- [x] Pin package/bin naming: `@lachimere/harness-engineering` and `harness`, unless Stage 1 changes the decision.
- [x] Pin toolchain decision: Bun for repository package management, TypeScript 6 for implementation, Biome/Lefthook using user-provided configuration, explicit `tsc --noEmit` type checking, and Node-compatible public CLI output.
- [x] Document schema publication and compatibility policy.
- [x] Document `harness migrate` posture.
- [x] Document `agent-coding` disposition options.
- [x] Validate docs do not promise unavailable plugin, CI, or skills support.
- [x] Run `git diff --check`.

### Stage 1 acceptance criteria

- [x] README includes a host/path quickstart matrix covering the current documented CLI-first path, planned marketplace plugin paths, external agent-practice mining status, and optional CI.
- [x] Docs state which paths exist now versus which are planned.
- [x] Package, binary, Bun package-manager choice, TypeScript 6 requirement, Biome/Lefthook requirement with user-provided configuration, Node-compatible runtime target, schema distribution, compatibility policy, and `harness migrate` posture are explicit enough for Stage 2 and Stage 3 to implement.

## Stage 2: Harness schema substrate

- [x] Add `schemas/harness.schema.json`.
- [x] Add `schemas/approval-policy.schema.json`.
- [x] Add `schemas/sandbox-policy.schema.json`.
- [x] Add `schemas/environment.schema.json`.
- [x] Add `schemas/model-profile.schema.json`.
- [x] Add `schemas/failure-taxonomy.schema.json` with starter codes:
  - [x] `tool-error`
  - [x] `timeout`
  - [x] `loop-detected`
  - [x] `verification-failure`
  - [x] `context-loss`
  - [x] `routing-miss`
  - [x] `premature-completion`
  - [x] `no-progress-edit-churn`
- [x] Add `schemas/continuity-state.schema.json`.
- [x] Add `schemas/self-verification.schema.json`.
- [x] Add `schemas/doctor-result.schema.json`.
- [x] Add `schemas/eval-task.schema.json`.
- [x] Add `schemas/agent-runner.schema.json`.
- [x] Add `schemas/trace.schema.json`.
- [x] Add `schemas/run-result.schema.json`.
- [x] Add provisional `schemas/plugin-capability.schema.json`.
- [x] Add provisional `schemas/repair-action.schema.json`.
- [x] Add `schemas/gc-evidence.schema.json`.
- [x] Add `examples/harness.yaml` with no CI/plugin adapter keys.
- [x] Add valid and invalid fixtures for high-risk schemas.
- [x] Define per-schema semantic versioning and `engines.schemas` semantics.
- [x] Define trust/sandbox requirements for local checks, verifiers, and repair actions.
- [x] Define credential references and cost/token/request budgets in agent runner schema.
- [x] Ensure continuity and self-verification schemas cover startup verification, progress, evidence, and handoff state.
- [x] Run schema validation on examples and fixtures.
- [x] Run `git diff --check`.

### Stage 2 acceptance criteria

- [x] External tools can validate artifacts against published or locally vendored schemas.
- [x] Every machine-readable artifact has `schema_version` and clear compatibility semantics, using per-schema semantic versions plus the `engines.schemas` range in `harness.yaml`.
- [x] The example `harness.yaml` validates and composes references rather than embedding all details.
- [x] `continuity-state.schema.json` and `self-verification.schema.json` are complete enough for Stage 10 without inventing new artifact shapes.
- [x] `agent-runner.schema.json` is complete enough for Stage 6 to enforce model invocation, credential references, budgets, sandbox, approval policy, trace output, and verifier binding without inventing new artifact shapes.
- [x] Local doctor checks, eval verifiers, and repair actions have declared trust/sandbox requirements.

## Stage 3: CLI skeleton: init, validate, migrate, verify, report

- [x] Add package metadata for the npm CLI.
- [x] Add Bun-managed dependency setup and commit the Bun text lockfile.
- [x] Configure TypeScript 6.
- [x] Add explicit `tsc --noEmit` type-check script.
- [x] Add Biome using user-provided configuration.
- [x] Add Lefthook using user-provided configuration.
- [x] Configure build output as a Node-compatible npm binary rather than a Bun-only executable.
- [x] Implement `harness init`.
- [x] Ensure `init` does not emit CI/plugin-specific adapter keys.
- [x] Implement `harness validate`.
- [x] Scope `validate` to schema, schema publication references, version compatibility, and currently composed reference files.
- [x] Implement `harness migrate`.
- [x] Make early `migrate` support dry-run/no-op migration evidence.
- [x] Implement `harness verify`.
- [x] Ensure `verify` consumes explicit verification specs or acceptance checks and does not do structural harness inspection.
- [x] Document verification spec format.
- [x] Add example verification spec showing non-structural acceptance verification distinct from `doctor` and `eval`.
- [x] Implement `harness report`.
- [x] Document command exit semantics.
- [x] Add command-level tests and output fixtures.
- [x] Run CLI tests.
- [x] Run `git diff --check`.

### Stage 3 acceptance criteria

- [x] A user can bootstrap and validate a harness baseline from the terminal.
- [x] CLI project uses TypeScript 6, Bun-managed dependencies, Biome, and Lefthook while producing a Node-compatible npm binary.
- [x] CLI exit semantics are documented for future plugin and CI adapters.
- [x] Reports cite the artifact paths they summarized.
- [x] `verify` documentation defines the verification spec or acceptance-check input format and includes an example that distinguishes self-verification from structural `doctor` checks and behavioral `eval` runs.
- [x] `verify` does not perform structural harness inspection that belongs to `doctor`.

## Stage 4: Harness doctor MVP

- [x] Define doctor check contract:
  - [x] `id`
  - [x] `version`
  - [x] `category`
  - [x] `inputs`
  - [x] `determinism`
  - [x] `severity`
  - [x] `evidence`
  - [x] `remediation`
  - [x] `fixtures`
  - [x] `false_positive_policy`
  - [x] `exit_semantics`
- [x] Implement `harness doctor`.
- [x] Add downstream check registration through `harness.yaml`.
- [x] Add built-in `schema-validity` check.
- [x] Add built-in `engine-compatibility` check.
- [x] Add built-in `reference-exists` check.
- [x] Add passing and failing fixtures.
- [x] Emit JSON conforming to `doctor-result.schema.json`.
- [x] Emit Markdown report.
- [x] Document doctor/verify/eval command boundaries.
- [x] Confirm no subjective "AI slop" scoring.
- [x] Run Stage 4 entropy pass:
  - [x] Confirm docs distinguish current doctor MVP from planned expanded doctor behavior and do not describe planned `eval`, `run`, `gc`, plugin, or CI behavior as currently available.
  - [x] Confirm doctor fixtures and artifacts are referenced by tests, manifests, docs, or `harness.yaml`.
  - [x] Confirm doctor implementation reuses shared validation/reference helpers instead of creating a duplicate source of truth.
  - [x] Confirm `doctor` does not drift into `validate`, `verify`, `eval`, `run`, or GC responsibilities.
- [x] Run doctor tests.
- [x] Run `git diff --check`.

### Stage 4 acceptance criteria

- [x] Doctor output conforms to `doctor-result.schema.json`.
- [x] Passing and failing fixtures validate with zero schema errors.
- [x] Exit code semantics are documented for plugin and CI consumption.
- [x] Doctor checks remain deterministic structural checks and do not claim task acceptance, self-verification status, or subjective "AI slop" scores.
- [x] Entropy pass has no unresolved stale docs, orphan doctor fixtures/artifacts, duplicate source-of-truth logic, or command-boundary drift.

## Stage 5: Eval task contract and deterministic verifier runner

- [x] Define minimal eval task/run format inspired by Harbor, Terminal-Bench, SWE-bench, and OpenAI Evals.
- [x] Implement verifier-only eval execution.
- [x] Define verifier trust/sandbox requirement contract.
- [x] Add verifier trust declaration to self-test fixture.
- [x] Implement or specify `harness eval validate`.
- [x] Add task versioning.
- [x] Add dataset hash handling.
- [x] Add optimization/holdout split creation and validation.
- [x] Add resource/time limit semantics.
- [x] Add result semantics.
- [x] Add harness self-test fixture with oracle pass.
- [x] Add broken twin fixture that fails deterministically.
- [x] Record run results with suite/task version, dataset hash, and split designation.
- [x] Add tests proving oracle pass and broken twin fail.
- [x] Run eval/verifier tests.
- [x] Run `git diff --check`.

### Stage 5 acceptance criteria

- [x] The self-test proves the verifier can pass and fail deterministically.
- [x] Run results include suite/task version and dataset hash.
- [x] A reviewer can distinguish agent failure from harness/verifier failure.
- [x] Verifiers declare trust level, sandbox requirements, allowed inputs/outputs, and network/secret/host-file access before execution.
- [x] Eval task and run-result schemas support optimization/holdout split designation and record which split was used.

## Stage 6: Agent runner, first behavioral eval, and trace normalization

- [x] Implement or specify `harness run <task>`.
- [x] Bind `agent-runner.schema.json` to:
  - [x] model profile,
  - [x] credential reference,
  - [x] cost/token/request budgets,
  - [x] sandbox,
  - [x] approval policy,
  - [x] trace output,
  - [x] verifier binding.
- [x] Refuse agent runs without explicit credential references and budgets.
- [x] Add failing fixture or test for missing credential references and budgets.
- [x] Add deterministic stub runner or recorded-response runner.
- [x] Document stub/recorded runner architecture and local/CI usage.
- [x] Ensure stub/recorded runs use explicit non-secret stub credential references and budgets.
- [x] Implement `harness eval run` as an end-to-end behavioral eval.
- [x] Add at least one toy suite with baseline/oracle.
- [x] Ensure toy suite runs without live credentials.
- [x] Output trace artifacts.
- [x] Output run-result artifacts.
- [x] Output verifier result artifacts.
- [x] Output small scoreboard/trend report.
- [x] Ensure scoreboard distinguishes harness/verifier failure from agent/model failure.
- [x] Distinguish optimization and holdout splits in output.
- [x] Link run results to the trace and artifacts that produced them.
- [x] Associate multiple runs with one long-running session.
- [x] Implement or specify `harness trace validate/import`.
- [x] Add examples for imported external traces and native CLI traces.
- [x] Validate trace examples against schema.
- [x] Run end-to-end toy eval in local/CI-safe mode.
- [x] Run `git diff --check`.

### Stage 6 acceptance criteria

- [x] A user can run a toy task through a configured model/harness and receive trace, run-result, verifier result, and report artifacts.
- [x] The toy suite can run with the deterministic stub/recorded runner and does not require live credentials.
- [x] The stub/recorded runner satisfies the credential-reference and budget contract with non-secret fixture values rather than bypassing it.
- [x] Agent runs refuse to execute without explicit credential references and cost/token/request budgets, with fixtures or tests covering the refusal.
- [x] Eval output distinguishes optimization and holdout splits.
- [x] The first scoreboard distinguishes harness/verifier failure from agent/model failure.
- [x] Trace examples validate against schema.
- [x] A run result links to the trace and artifacts that produced it.
- [x] Long-running continuity can associate multiple runs with one session.
- [x] Review docs explain how to run the toy eval locally and in CI-safe mode without credentials.

## Stage 7: LLM-judge and inferential-review policy

- [x] Define LLM-judge policy.
- [x] Require rubric.
- [x] Require labeled sample minimum.
- [x] Define agreement metric and numeric blocking threshold.
- [x] Define uncertainty notes.
- [x] Define below-threshold consequence.
- [x] Document example agreement calculation with passing/failing threshold examples.
- [x] Store judge outputs distinctly from deterministic verifier results.
- [x] Add fixtures for calibrated blocking, advisory-only, and below-threshold judge cases.
- [x] Mark uncalibrated judge outputs advisory-only.
- [x] Add report validation for judge blocking/advisory semantics.
- [x] Run judge-policy fixtures.
- [x] Run `git diff --check`.

### Stage 7 acceptance criteria

- [x] No LLM-judge result can be marked blocking unless the calibration policy is satisfied.
- [x] The judge policy specifies rubric, labeled sample minimum, agreement metric, numeric blocking threshold, uncertainty notes, and below-threshold consequence.
- [x] Fixtures demonstrate calibrated blocking, advisory-only, and below-threshold judge cases.
- [x] Docs state how to treat low-agreement or stale judges.

Stage 7 validation evidence:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/calibrated-blocking.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/advisory-only.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/below-threshold.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/stale-advisory.json`
- policy-violation smoke for `examples/judges/results/policy-violations/blocking-low-agreement.json`
- `git diff --check`

## Stage 8: Agent/CLI marketplace adapter feasibility and target selection

- [x] Define candidate host list focused on Codex, Claude Code, GitHub Copilot CLI, and named comparable coding-agent/CLI surfaces that satisfy the candidate boundary.
- [x] Define in-scope candidate boundary: coding-agent or CLI host, marketplace/install/discovery surface, agent-facing extension point, repository workspace access path, and CLI invocation or bootstrap path.
- [x] Scrub README and AGENTS Stage 8 wording so public docs say agent/CLI marketplace or limited adapter, not generic host marketplace or IDE host.
- [x] Record IDE-only, CI-only, and hosted checks/review surfaces, if researched, as out-of-scope future evidence rather than Stage 9 candidates.
- [x] Define capability tier thresholds: full plugin, limited adapter, CLI-first fallback, and future adapter evidence.
- [x] Split limited-adapter core capabilities from rich UX capabilities before classifying hosts.
- [x] Define capability statuses (`yes`, `partial`, `no`, `unknown`) and fallback behaviors (`supported`, `hide`, `disable`, `cli-redirect`, `advisory-only`, `hard-error`) before classifying hosts.
- [x] Evaluate agent/CLI marketplace, command/hook discovery, MCP registry, skill-pack mechanism, or equivalent install distribution for each host.
- [x] Evaluate CLI bundling/bootstrap for each host.
- [x] Evaluate filesystem access.
- [x] Evaluate CLI invocation or tool execution.
- [x] Evaluate CLI report rendering.
- [x] Evaluate annotation APIs.
- [x] Evaluate background runs.
- [x] Evaluate repair-action UI.
- [x] Evaluate trace deep-links.
- [x] Define capability matrix schema or durable format for Stage 9 consumption, with fields for host, surface kind, candidate status, tier, capability statuses, CLI management modes, stable evidence ids, evidence entries, fallback behavior, and Stage 9 consequence.
- [x] Define evidence-link requirements for matrix entries: stable `evidence_id`, source date, acceptable source type, positive/partial/negative finding, and reproduction or inspection note.
- [x] Define matrix-to-Stage 9 decision rules that map proven capabilities to implemented, hidden, disabled, CLI-redirected, advisory-only, or hard-error behavior.
- [x] Produce per-host capability matrix with a capability tier and Stage 9 consequence for every host.
- [x] Revalidate provisional plugin-capability schema against matrix, including whether tier, surface kind, evidence ids, evidence links, fallback fields, and adapter scope manifest fields are required.
- [x] Revalidate provisional repair-action schema against matrix, including advisory-only behavior for limited adapters without proven preview/approval affordances.
- [x] Validate matrix completeness and cross-artifact invariants with schema fixture tests or equivalent automated checks.
- [x] Choose first full-plugin target, choose a limited adapter target with explicit UX limits, or explicitly document CLI-first until an adapter exists.
- [x] Update docs to avoid unavailable plugin promises.
- [x] Run `git diff --check`.

### Stage 8 acceptance criteria

- [x] Capability matrix focuses on Codex, Claude Code, GitHub Copilot CLI, and named comparable coding-agent/CLI surfaces that satisfy the candidate boundary.
- [x] Capability matrix distinguishes in-scope candidates from out-of-scope future evidence; IDE-only, CI-only, and hosted checks/review surfaces cannot be selected for Stage 9 in this slug.
- [x] Capability matrix assigns each host a capability tier and explains the permitted Stage 9 scope.
- [x] Capability tiers have explicit thresholds so two reviewers would classify the same evidence consistently.
- [x] Capability matrix covers agent/CLI marketplace or install distribution, CLI bundling/bootstrap, filesystem access, CLI invocation, report rendering, annotation APIs, background runs, repair-action UI, and trace deep-links.
- [x] Capability matrix has a durable format that Stage 9 can consume or cite, with fields for host, surface kind, candidate status, tier, capability statuses, CLI management modes, stable evidence ids, evidence entries, fallback behavior, and Stage 9 consequence.
- [x] Capability matrix evidence links identify stable `evidence_id`, source date, acceptable source type, positive/partial/negative finding, and reproduction or inspection note.
- [x] Provisional plugin-capability and repair-action schemas from Stage 2 are revalidated against host APIs and the capability matrix shape.
- [x] Matrix completeness and cross-artifact invariants are validated with schema fixture tests or equivalent automated checks.
- [x] If a target is chosen, it has documented agent/CLI marketplace distribution evidence and API evidence for the tier-specific supported capabilities proven by Stage 8.
- [x] Full-plugin target feasibility was evaluated; none is feasible, so Stage 9 is not a full-plugin implementation.
- [x] If only a limited adapter is feasible, Stage 9 scope is explicitly limited to the limited adapter and docs do not imply rich plugin UX.
- [x] At least one limited-adapter target is feasible, so Stage 9 is not skipped; docs still keep CLI-first as the available path until an adapter ships.
- [x] The matrix does not classify every named host as limited-adapter; Gemini CLI remains CLI-first fallback, and the selected Stage 9 journey is limited-adapter only.

Stage 8 implementation result:

- Codex CLI, Claude Code, and GitHub Copilot CLI qualify as **limited adapter**; Gemini CLI remains **CLI-first fallback** because core bootstrap evidence is partial.
- GitHub Copilot CLI is selected as the first limited-adapter target for Stage 9.
- Stage 9 must keep rich UX gaps explicit: annotation APIs and trace deep-links are advisory/partial, and write-class repair execution must remain limited to capabilities proven by the selected host evidence.

Stage 8 validation evidence:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`

## Stage 9: Conditional adapter MVP

Status note: Stage 9 currently ships the schema-backed GitHub Copilot CLI limited-adapter scope and `harness adapter validate`; it does not ship an installable host package because no concrete host package manifest/install format has been proven for this repository. Where the original checklist says "adapter-bundled," the selected Stage 8 matrix currently proves `bootstrap` instead of `bundled`, so the scope manifest declares repo-pinned, bootstrap-managed, then user-installed resolution. Runtime CLI resolution and host packaging remain pending.

- [x] Implement selected full plugin or limited adapter only if Stage 8 finds a feasible target.
- [x] Add a schema-backed machine-readable adapter scope manifest, or equivalent revalidated plugin-capability metadata, declaring implemented capabilities, unavailable capabilities, fallback behavior, required Stage 8 matrix evidence ids, CLI/schema compatibility, and trust/write boundaries.
- [x] Validate the adapter scope manifest or equivalent revalidated plugin-capability metadata against the Stage 8 matrix so implemented scope is a subset of proven capabilities.
- [x] Extend `schemas/repair-action.schema.json` with advisory-only versus preview-backed repair mode, or equivalent adapter-scope metadata, before any Stage 9 host surface executes write-class repairs.
- [x] Add repair-action or adapter-scope fixtures proving advisory-only limited-adapter behavior before write-class repairs are exposed.
- [ ] Package through selected agent/CLI marketplace mechanism only if Stage 8 proves that mechanism. _(Deferred: host package format remains unproven.)_
- [ ] Discover repo-local `harness.yaml` only through a repository access path proven in Stage 8. _(Deferred: runtime adapter pending.)_
- [ ] Initialize through CLI substrate only when Stage 8 proves write-capable CLI invocation and approval/trust boundaries. _(Deferred: runtime adapter pending.)_
- [ ] Render doctor/eval/trace reports from CLI JSON/Markdown outputs only for report surfaces proven in Stage 8. _(Deferred: runtime adapter pending.)_
- [ ] Create supported annotations only for annotation/session feedback APIs proven in Stage 8. _(Deferred: runtime adapter pending; current scope labels durable annotations advisory-only.)_
- [x] Keep repair actions CLI-backed and advisory in the current scope manifest; preview-backed repair remains schema-supported but not claimed by the un-packaged limited-adapter runtime.
- [x] Declare bundle, pin, or bootstrap CLI dependency modes only through mechanisms proven in Stage 8.
- [x] Declare CLI resolution order: repo-pinned compatible CLI, adapter-bundled or bootstrap-managed CLI when proven, then user-installed CLI.
- [ ] Detect repo-pinned CLI version from `harness.yaml` `engines.cli`. _(Deferred: runtime adapter pending.)_
- [x] Require adapter-scope metadata to refuse write actions on CLI/schema incompatibility.
- [x] Ensure adapter does not reimplement doctor checks or eval verifiers.
- [x] Ensure adapter-local cache is non-authoritative and reconstructible.
- [x] For full-plugin targets with proven preview/approval affordances, ensure repair actions show preview diffs, use approval policy, declare risk class, and emit equivalent CLI commands. Current status: no full-plugin target selected; preview-backed schema fixtures cover the contract without claiming a host package.
- [x] For limited adapters without proven preview/approval affordances, keep repair actions advisory: show the equivalent CLI command, explain approval/risk, and do not execute writes through the host surface.
- [x] Run adapter tests for the selected host surface and capability tier.
- [x] Run `git diff --check`.

Verification evidence:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`

### Stage 9 acceptance criteria

- [ ] A user can install or enable the selected host surface at the capability tier proven by Stage 8 without separately guessing CLI prerequisites. _(Deferred: host package format and runtime adapter pending.)_
- [x] Automated validation proves the adapter scope manifest or equivalent revalidated plugin-capability metadata is a subset of capabilities proven in the Stage 8 matrix.
- [ ] The adapter bundles or auto-manages a pinned CLI dependency unless the host forbids it; constrained-host manual guidance includes missing/incompatible CLI detection and repair prompts. _(Deferred: runtime adapter pending; scope manifest only declares bootstrap-compatible behavior.)_
- [ ] The adapter resolves CLI versions in this order: repo-pinned compatible CLI, adapter-bundled or bootstrap-managed CLI when proven, then user-installed CLI. _(Deferred: runtime adapter pending; scope manifest validates the declared order.)_
- [ ] The adapter refuses write actions when no compatible CLI/schema version exists. _(Deferred: runtime adapter pending; scope manifest requires this behavior.)_
- [x] Repair actions show preview diffs, use the approval policy, declare risk class, and emit equivalent CLI commands only when Stage 8 proves host preview and approval affordances.
- [x] Limited adapters without proven preview and approval affordances keep repair actions advisory and redirect write execution to the CLI.
- [x] Adapter does not create a second source of truth; adapter-local cache is non-authoritative, reconstructible, and excluded from CLI/CI behavior.
- [x] Any rich UX capability not proven in Stage 8 is absent or clearly labeled unavailable.

## Stage 10: Native execution loop and continuity adapter

- [x] Define native implementation-loop contract or adapter.
- [x] Read `harness.yaml`.
- [x] Read approval policy.
- [x] Read sandbox policy.
- [x] Read continuity schema.
- [x] Read self-verification evidence schema.
- [x] Require original spec reread before completion.
- [x] Compare acceptance criteria before completion.
- [x] Run relevant CLI and doctor checks.
- [x] Capture evidence paths.
- [x] Update continuity state.
- [x] Define startup verification.
- [x] Run startup verification before work begins.
- [x] Record startup verification in continuity state.
- [x] Define handoff expectations.
- [x] Document that any external producer of continuity and self-verification artifacts must conform to the same schema and CLI validation gates.
- [x] Add tests/fixtures for failed startup verification and failed completion gates.
- [x] Run `git diff --check`.

Evidence: `harness loop validate` validates Stage 10 startup and completion gates over `harness.yaml`, approval/sandbox policy references, continuity state, and self-verification evidence without adding a new skill-only artifact shape. Positive examples live at `examples/continuity/stage10-loop-state.yaml`, `examples/verification/stage10-startup.yaml`, and `examples/verification/stage10-completion.yaml`; semantic-negative fixtures under `examples/fixtures/execution-loop/` prove refusal for failed startup, missing startup progress, late startup, startup command/timeout mismatch, failed startup self-verification, missing startup command evidence, failed completion evidence, wrapped command evidence, missing doctor evidence, missing policy/sandbox artifact evidence, missing handoff artifacts, and unlinked completion evidence. Verified with `bun run check`, `bun run test:unit`, `bun run build`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, `git diff --check`, `node dist/index.js loop validate --file examples/harness.yaml --continuity examples/continuity/stage10-loop-state.yaml --verification examples/verification/stage10-completion.yaml`, `node dist/index.js doctor --file examples/harness.yaml`, and `node dist/index.js adapter validate`.

### Stage 10 acceptance criteria

- [x] Execution loop cannot claim completion without substrate-aware verification evidence.
- [x] Approval/sandbox policy decisions are read and either followed or explicitly escalated.
- [x] Startup verification runs before work begins and records the result in continuity state.
- [x] Fixtures demonstrate the execution loop refusing to start or complete when startup verification or completion-gate evidence fails.

## Stage 11: Optional CI adapters

- [x] Add generic CLI exit semantics for CI.
- [x] Add CI examples for schema validation.
- [x] Add CI examples for doctor checks.
- [x] Add CI examples for eval/trace validation.
- [x] Add report artifact upload example.
- [x] Include GitHub Actions as one optional example, not the CI contract.
- [x] Document blocking vs advisory checks.
- [x] Confirm shared schema/report artifacts support blocking/advisory status for downstream adapter consistency.
- [x] Ensure uncalibrated LLM-judge results are advisory-only by default.
- [x] Run CI examples locally where possible.
- [x] Run `git diff --check`.

Evidence: Stage 11 adds `examples/ci/github-actions.yml` as an optional GitHub Actions recipe over the deterministic CLI. The workflow builds the CLI, runs objective blocking checks (`validate`, `doctor`, reviewed `health`, `eval validate`, `trace validate`), records `gc audit` as advisory evidence, writes schema-backed artifacts under `.harness/**`, runs `assess` as a summary, and uploads `.harness/**` as evidence. `docs/guides/ci.md` records blocking versus advisory policy, including that GC findings require review rather than blocking by exit code and that uncalibrated, stale, below-threshold, or policy-invalid judge results are advisory-only. The recipe does not install a plugin, run live models, require secrets, apply cleanup or repairs, schedule profiles, or create CI-only source-of-truth state. CI recipe tests verify the workflow remains CLI-first and evidence-backed.

### Stage 11 acceptance criteria

- [x] A downstream repo can opt into objective CI feedback without needing a plugin or agent.
- [x] CI examples are clearly optional adapters.
- [x] Blocking/advisory status is represented in shared CLI/schema/report artifacts so CI, plugin, and skill adapters use consistent policy.
- [x] Uncalibrated LLM-judge results remain advisory-only by default.

## Stage 12: Native agent-facing harness-engineering adapter

- [x] Choose adapter path, such as `skills/harness-engineering/`, or document a different native adapter path.
- [x] Add read-only assessment/design workflow.
- [x] Read `harness.yaml` when present.
- [x] Read doctor output.
- [x] Read eval plans.
- [x] Read traces.
- [x] Read run results.
- [x] Read reports.
- [x] Output maturity scorecard.
- [x] Output missing primitives.
- [x] Output rollout stage plan.
- [x] Output policy/eval/trace/continuity recommendations.
- [x] Document repair-action discovery/routing mechanism.
- [x] Route implementation to trusted applicable native repair actions, native execution-loop adapters, or clear CLI/schema-backed fallback guidance.
- [x] Add example showing adapter routing to at least one repair action or gracefully deferring to CLI/schema-backed fallback guidance.
- [x] Ensure adapter does not assume external workflow skills are installed or vendored.
- [x] Add trigger/behavior evals if using a skill format.
- [x] Run adapter tests/evals.
- [x] Run `git diff --check`.

Evidence: Stage 12 ships `harness assess` as the native agent-facing adapter path instead of a skill-first adapter. The command is read-only, validates its output with `schemas/assessment.schema.json`, reads harness/doctor/eval-plan/run-result/trace/scoreboard/report/repair-action artifacts, emits maturity and missing-primitive guidance, and routes implementation requests to applicable repair actions only when a trusted approval id is supplied, native execution-loop guidance, or a CLI fallback while marking external workflow skills as unavailable source material rather than implementation routes. Review refinements ensure schema-invalid, duplicate-id, untrusted, unapproved, and non-applicable repair actions are surfaced but not selected, repair-action `equivalent_cli_command` values are not emitted as executable assessment route commands, Stage 12 implementation does not select external-source-material routes, and `artifacts_read` includes composed harness references validated from `harness.yaml`. The CLI path and non-skill trigger/eval decision are documented in `docs/guides/cli.md`; routing is illustrated by a generated `harness assess` output at `examples/assessments/repair-action-routing.json`. Verified with `bun run check`, `bun run test:unit`, `bun run test:e2e`, and `git diff --check`.

### Stage 12 acceptance criteria

- [x] The adapter emits a maturity scorecard, missing primitives, rollout stage plan, and policy/eval/trace/continuity recommendations from substrate artifacts while preserving CLI/schema as source of truth.
- [x] Adapter does not assume external workflow skills are installed or vendored in this repo.
- [x] Adapter demonstrates routing implementation requests to trusted applicable repair actions, native execution-loop adapters, or a clear fallback when no implementation route is configured.

## Stage 13: Agent-practice mining for harness-native capabilities

- [x] Start external practice-mining research after Stage 1.
- [x] Dogfood `harness assess --format json` on this repository and at least one more realistic downstream fixture before recording capability candidates, assessment gaps, repair-action applicability, and any trusted approval requirements.
- [x] Create `plans/harness-engineering-platform/capability-ledger.yaml` with stable kebab-case `capability_id` values for later Stage 14/16 citations.
- [x] Review `workflow-orchestrator`.
- [x] Review `execute-plan-loop`.
- [x] Review `decompose-feature`.
- [x] Review `plan-parallel-work`.
- [x] Review `ensure-atomic-pr`.
- [x] Review `refresh-related-docs`.
- [x] Review `achieve-goal`.
- [x] Explicitly exclude the vulnerability-scanning skill from Stage 13 because domain-specific security tooling is out of scope for this slice.
- [x] For each mined capability candidate, record:
  - [x] stable `capability_id`,
  - [x] `status` (`active`, `deferred`, `rejected`, or `retired`),
  - [x] source observations,
  - [x] practice worth preserving,
  - [x] failure mode or substrate gap,
  - [x] possible harness-native surface,
  - [x] deterministic/advisory/non-core disposition,
  - [x] future owner stage or `deferred` rationale,
  - [x] evidence, fixtures, or evals required before internalization,
  - [x] trust/sandbox or false-positive policy requirements,
  - [x] user-behavior-change category (`none`, `future-adoption`, or `supersede-existing-guidance`),
  - [x] rationale,
  - [x] what stays outside harness core.
- [x] Decide whether each capability is a schema/CLI/profile/eval/GC candidate, adapter guidance, non-core, or rejected/deferred idea.
- [x] Explicitly state that no external skill is copied, vendored, rewritten, merged, deprecated, namespaced as a product surface, or made default quickstart in Stage 13.
- [x] Provide replacement path, migration timeline, and before/after workflow examples only for capability paths where Stage 13 records that user behavior would later change.
- [x] Provide non-core rationale for rejected/deferred and non-core capability ideas.
- [x] Ensure ignored or non-core source material is not described as a harness primitive.
- [x] Resolve or explicitly defer remaining Stage 12 light polish: Markdown selected-route emphasis, explicit empty/ephemeral repair-action fixture handling, and the production repair-action discovery/default-directory policy.
- [x] Revisit assessment taxonomy after capability mining and record whether scorecard primitives, maturity thresholds, rollout stages, or future capability-candidate fields need adjustment.
- [x] Document `capability_id` stability: committed ids are not reused, and retired records remain in the ledger as `status: retired`.
- [x] Run `git diff --check`.

Evidence: Stage 13 mines external workflow skills only as source material and records seven harness-native capability candidates in `plans/harness-engineering-platform/capability-ledger.yaml`: `workflow-phase-gates`, `execution-atomic-slices`, `planning-feature-decomposition`, `parallel-work-ownership`, `review-atomicity-evidence`, `docs-freshness-profile`, and `goal-lifecycle-profile`. The ledger cites `LaChimere/agent-coding` source material at commit `a200a89f9949af9a2e8a2b7610be2a43b754d260` but creates no `agent-coding` namespace, adapter path, default quickstart, or runtime dependency. `scan-image-vulnerabilities` is explicitly excluded as domain-specific security tooling. Dogfood assessment evidence is preserved at `plans/harness-engineering-platform/evidence/stage13-repo-assessment.json` and `plans/harness-engineering-platform/evidence/stage13-downstream-minimal-assessment.json`: the canonical example assessed as `observable` 8/9 with execution-loop route and only advisory repair-routing gap, while an initialized downstream minimal fixture assessed as `validated` 5/9 with missing or partial doctor, run-result, scoreboard/report, and repair-routing evidence. Stage 13 does not change the assessment scorecard or maturity thresholds; future capability adoption is routed to Stage 14/15 evidence gates or Stage 19 recurring-profile gates, and Stage 16 remains dormant until an adopted capability or replacement path exists. Stage 12 selected-route Markdown polish is deferred until profile or delivery-surface consumption is concrete; empty/ephemeral repair-action fixture handling and production repair-action discovery/default-directory policy remain deferred until cleanup eligibility or repair execution has a product path.

### Stage 13 acceptance criteria

- [x] `plans/harness-engineering-platform/capability-ledger.yaml` exists with stable kebab-case `capability_id` values.
- [x] Each mined capability record follows the canonical ledger fields defined in `design.md`, including `status`, source observations, user-behavior-change category, required evidence, rationale, and boundary.
- [x] Every internalization candidate names the proof required before it can become harness-native: schema contract, CLI owner, fixtures or evals, trust/sandbox requirements, false-positive policy, and migration/adoption examples only when user behavior would change.
- [x] Every rejected/deferred or non-core capability includes a rationale; migration timing and before/after workflow examples are required only when Stage 13 records that user behavior would later change.
- [x] Stage 13 docs do not imply this repository supports, depends on, or exposes `agent-coding` as a product surface.

## Stage 14: GC framework and first deterministic categories

- [x] Implement `harness gc audit`.
- [x] Implement `harness gc validate`.
- [x] Add append-only GC evidence output.
- [x] Define append-only evidence format such as JSONL, timestamped files, or another durable format.
- [x] Document how multiple GC audits are preserved without overwriting.
- [x] Define first deterministic categories with explicit algorithms.
- [x] Add category for broken references.
- [x] Add category for duplicate IDs.
- [x] Add category for stale schema versions.
- [x] Add passing/failing fixtures for each category.
- [x] Document false-positive policy for each category.
- [x] Promote Stage 13 capability candidates only when they can be expressed as deterministic GC evidence rather than subjective process scoring.
- [x] When adopting a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
- [x] Produce ranked atomic cleanup slices.
- [x] Include evidence refs and confidence.
- [x] Include blast radius and atomicity notes.
- [x] Prohibit fully automated cleanup.
- [x] Revisit Stage 12 repair-action routing presentation once GC repair evidence exists, including trusted approval provenance, duplicate action ids, risk, sandbox, and review metadata without emitting executable assessment-route commands.
- [x] Run GC tests.
- [x] Run `git diff --check`.

Evidence: Stage 14 adds `harness gc audit` and `harness gc validate` as read-only deterministic GC commands. Audit output conforms to `schemas/gc-evidence.schema.json`; optional `--output` atomically creates a new file inside the selected root and refuses to overwrite existing files so audit history is append-only. The first deterministic categories are `broken-reference`, `duplicate-id`, and `stale-schema-version`; their algorithms use existing harness reference validation, schema-engine range checks, and stable id scans for doctor checks, repair actions, and the capability ledger. GC audit refuses schema-invalid harnesses instead of reporting a false clean result. Findings include evidence refs, confidence, proposed cleanup slices, blast radius, and atomicity notes; Markdown output includes evidence paths, target files, confidence, and decision refs for review. Finding fixtures live under `examples/fixtures/gc/`, and `examples/gc/evidence.json` is now a truthful no-finding example instead of a synthetic broken-reference claim. Stage 13 capability candidates were not adopted as native GC categories in this slice, so Stage 16 cleanup remains dormant. Repair-action discovery polish is limited to documenting the future policy boundary; production defaults and richer empty-directory distinctions remain candidates for later repair/GC evidence refinement.

### Stage 14 acceptance criteria

- [x] Users can run a GC audit and get reviewable cleanup slices tied to evidence.
- [x] GC evidence output is append-only and preserves historical audit runs.
- [x] Cleanup slices include evidence refs, confidence, blast radius, and atomicity notes; they do not mix unrelated concerns.
- [x] No GC category ships unless its inputs, algorithm, false-positive policy, and passing/failing fixtures are documented.

## Stage 15: Evidence-driven GC expansion

- [x] Add tool/policy entropy categories when evidence exists.
- [x] Add verification entropy categories when evidence exists.
- [x] Add execution entropy categories when evidence exists.
- [x] Add eval entropy categories when evidence exists.
- [x] Add trace entropy categories when evidence exists.
- [x] Document threshold policy for future repeated-feedback promotion without implementing automatic promotion.
- [x] Document holdout evidence requirements for future behavioral rule/eval promotion.
- [x] Document that future behavioral promotion must cite holdout results, not only optimization-suite improvement.
- [x] Document evidence requirements for future stale rule/template/eval retirement.
- [x] Keep promotion/retirement citation-only in this slice rather than shipping automatic promotion or retirement.
- [x] When adopting a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
- [x] Ensure a single preference cannot become a durable rule.
- [x] Ensure LLM-judge evidence follows Stage 7 calibration policy.
- [x] Run GC expansion tests.
- [x] Run `git diff --check`.

Evidence: Stage 15 extends `harness gc audit` with optional evidence inputs for self-verification, run-result JSON/arrays/JSONL, scoreboard, trace, and judge-result artifacts. The new evidence-driven categories are `verification-evidence`, `execution-evidence`, `eval-evidence`, `trace-evidence`, and `judge-calibration`; all require schema-valid input artifacts and produce reviewable cleanup slices instead of applying cleanup. `harness gc validate` now checks that local evidence refs, previous-audit refs, promotion/retirement refs, and cleanup targets resolve inside the selected root, while still allowing external URI and fragment-only evidence/decision references where the schema permits references. Cleanup targets must remain local fragment-free files; archived evidence can be shape-checked with `--skip-reference-checks` when the original checkout is unavailable. The duplicate-id scan can now take an explicit `--capability-ledger` path rather than relying only on this repo's planning ledger, and generated cleanup ids are deduplicated when repeated evidence records share an id. Promotion/retirement remains citation-only in this slice: durable rules, templates, and evals are not promoted from one-off preferences, behavioral promotion must include holdout evidence, and retirement requires evidence that the rule/template/eval no longer adds value. Judge GC findings consume schema-valid judge-result calibration status only; full policy digest, threshold, staleness, and blocking-eligibility validation remains in `harness report`. No Stage 13 capability was adopted as a native category in this slice, so Stage 16 remains dormant until a later substrate-backed replacement exists.

### Stage 15 acceptance criteria

- [x] Promotion/retirement policy requires evidence citations, but automatic promotion/retirement is not shipped in this slice.
- [x] A single preference cannot become a durable rule because GC emits evidence only and does not promote rules automatically.
- [x] LLM-judge evidence follows Stage 7 calibration policy.
- [x] Behavioral rule/eval promotion cites holdout results, not only optimization-suite improvement.

## Stage 16: Productization gate and cleanup eligibility

- [x] Review `capability-ledger.yaml` and mark whether Stage 14/15 candidates were adopted, deferred, superseded, or still advisory.
- [x] Confirm whether any capability has a substrate-backed replacement path.
- [x] If no replacement exists, record Stage 16 as dormant and add no cleanup categories.
- [x] Confirm no replacement exists, so no cleanup target, migration evidence, or false-positive policy is implemented in this stage.
- [x] Ensure every capability has explicit `adoption_status` and `cleanup_eligible` fields before cleanup eligibility is evaluated.
- [x] Ensure cleanup eligibility never deletes user-facing behavior without documented replacement.
- [x] Update roadmap status to point to local project health checks as the next product-value slice.
- [x] Persist Stage 16 GC audit and ledger metadata evidence artifacts.
- [x] Add a re-evaluation trigger for future adopted, superseded, cleanup-eligible, or replacement-path changes.
- [x] Add a Stage 17 handoff note requiring re-entry to Stage 16 if Stage 17 changes capability adoption or replacement status.
- [x] Run eligibility/status tests or docs validation where available.
- [x] Run `git diff --check`.

Evidence: Stage 16 is a dormant productization gate, not a cleanup implementation. The persisted GC evidence artifact `plans/harness-engineering-platform/evidence/stage16-gc-audit.json` records `findings: []` for the example harness and capability-ledger duplicate-id namespace. The persisted ledger metadata artifact `plans/harness-engineering-platform/evidence/stage16-ledger-metadata.json` records seven capabilities, zero missing `adoption_status` or `cleanup_eligible` fields, zero `cleanup_eligible: true` entries, and zero `adopted` or `superseded` capabilities. Because no Stage 13 capability has a substrate-backed replacement path, Stage 16 adds no cleanup categories and deletes no behavior. The roadmap now points to Stage 17 local project health checks as the next product-value slice. Stage 16 must be re-run before merging any future change that adopts or supersedes a capability, flips `cleanup_eligible` to true, or documents a substrate-backed replacement path.

### Stage 16 acceptance criteria

- [x] The stage records active or dormant cleanup status with evidence.
- [x] Every capability record has explicit adoption and cleanup eligibility metadata.
- [x] No capability-specific GC finding is produced in this dormant stage; future capability-specific findings remain gated on capability-ledger records, required evidence, and supported-path migration notes.
- [x] Stage 16 produces no cleanup implementation when no adopted capability or substrate-backed replacement exists.
- [x] No cleanup slice deletes user-facing behavior without a documented replacement path.

## Stage 17: Local project health checks

- [x] Define `harness health` as the executable local project health-check surface without creating a second source of truth.
- [x] Keep `doctor` as the structural harness checker and document the boundary with `health`.
- [x] Reuse existing trust requirements plus approval and sandbox policy artifacts for health checks.
- [x] Require trust and sandbox declarations before any local check can execute.
- [x] Record command, timeout, status, failure class, artifacts, and trust/sandbox evidence for each check.
- [x] Extend `harness assess` to accept health evidence through a scorecard version with a distinct `project-health` dimension.
- [x] Mark existing Stage 13 assessment fixtures as the pre-health scorecard baseline or re-baseline them explicitly when the scorecard version changes.
- [x] Add pass/fail/timeout/unsafe-declaration fixtures.
- [x] Add policy-mismatch refusal fixtures, such as a check requiring process spawning when policy denies it.
- [x] Add downstream example checks such as lint, test, typecheck, or doc-link checks that require no network or secrets.
- [x] Ensure local health checks do not collapse `doctor`, `verify`, and `eval` into one generic runner.
- [x] Add command tests and schema/fixture validation.
- [x] Run `git diff --check`.

Evidence: Stage 17 adds `harness health` as the executable local project health-check surface while keeping `doctor` structural. Health checks are declared in the optional `health` block of `harness.yaml`, reuse existing `trustRequirements`, approval policy, and sandbox policy artifacts, and emit `schemas/health-result.schema.json` evidence with command, timeout, status, failure code, duration, artifacts, and trust requirements. The current runner is declaration-gated and records `sandbox_enforcement: declarative` plus `runtime_enforced: false`; it requires explicit `--accept-unsandboxed-execution`, refuses unsafe trust, network/secret/host-file access, missing declared artifacts, policy mismatches, symlinked output, and unsafe run ids rather than pretending to enforce a stronger sandbox. `harness assess` now accepts `--health-result`, emits `scorecard_version: "0.2.0"`, and adds a distinct `project-health` dimension instead of folding executable checks into `doctor-evidence`. The starter health check verifies `README.md` and `AGENTS.md` without network or secrets. Running `node dist/index.js health --file examples/harness.yaml --format json --accept-unsandboxed-execution` passed with one `docs-present` check; running `harness assess` with `examples/health/results/pass.json` produced `status: ready`, `project-health: present`, and maturity `9/10`.

### Stage 17 acceptance criteria

- [x] A downstream fixture reports configured check statuses and an overall health status beyond schema validity.
- [x] A downstream fixture demonstrates at least one passing and one failing health check with machine-readable evidence.
- [x] Assessment output cites health evidence and reflects it in the versioned maturity scorecard.
- [x] Local check execution is refused when trust/sandbox declarations are missing or unsafe.
- [x] Check evidence is machine-readable and cites command, timeout, status, artifacts, and failure class.
- [x] The starter path remains safe without network, secrets, or unbounded host access.

## Stage 18: Real runner readiness

- [x] Define the minimum contract for non-stub model/agent runner execution.
- [x] Require explicit credential references, cost/token/request budgets, approval policy, sandbox requirements, trace output, and trace redaction/scoping.
- [x] Define the supported credential-reference shape for this slice.
- [x] Define a field-level trace allowlist and refuse trace fields that reference credential environment variables.
- [x] Add refusal cases for trace-redaction or trace-scope violations.
- [x] Preserve deterministic stub/recorded runners as CI-safe defaults.
- [x] Add refusal cases for missing credentials, missing budgets, unsupported sandbox, and unbounded live execution.
- [x] Add readiness docs explaining what is supported now versus what remains planned.
- [x] Add tests or fixtures for refusal behavior.
- [x] Run `git diff --check`.

Evidence: Stage 18 adds `harness runner readiness` as a non-executing readiness check for future live runners. The deterministic stub runner remains CI-safe and reports `mode: stub`, `live_ready: false` without requiring live credentials. Explicit live readiness currently supports `credential_reference.source: env`, hard cost/token/request budgets, schema-valid approval policy, container/VM sandbox policy with concrete enforcement, none/restricted network mode, exact env-only credential scope, live model profile, repo-local trace output, and `trace_redaction` with a schema-defined field allowlist, one credential env-var, and `refuse_credential_env_references: true`. Readiness emits `schemas/runner-readiness.schema.json` evidence and refuses unsupported credentials, missing budgets, weak sandbox policy, missing trace output, missing trace redaction, or stub model profile without making a model call. The example live readiness fixture `examples/agent-runners/live-ready.yaml` passes readiness, while tests cover unsupported sandbox and missing trace-redaction refusal. `bun run check`, unit tests, e2e tests, build, fixture validation, and `git diff --check` passed.

### Stage 18 acceptance criteria

- [x] No live runner path can execute without explicit credentials, budgets, and trace capture.
- [x] Live-runner traces cannot capture secrets or unsupported sensitive data without an explicit redaction/scoping policy.
- [x] The product can explain exactly what must be configured before real execution is allowed.
- [x] CI-safe validation does not require live credentials.

## Stage 18.5: Copilot-as-model import evidence

- [x] Run project entropy and GC audit before adding the slice.
- [x] Add an explicit CLI path for importing a repo-local external candidate.
- [x] Copy imported candidates into harness-managed agent-output artifacts before verifier execution.
- [x] Emit schema-valid trace, verifier-result, and run-result evidence for imported candidates.
- [x] Keep external-import evidence distinct from deterministic `agent-run`, assessment run-result evidence, and provider-backed live execution.
- [x] Record candidate provenance, zero external usage, and `credential_reference.source: external`.
- [x] Refuse path-escaping or symlinked external candidates.
- [x] Add schema fixtures preventing external imports from being mislabeled as eval agent runs or stub-provenance traces.
- [x] Add CLI tests for passing external imports, live-runner context imports, path refusal, and verifier failures.

Evidence: The pre-slice GC audit produced `findings: []`. Stage 18.5 adds `harness run --external-candidate <path>` for Copilot-as-model / agent-mediated smoke testing. The command imports a repo-local candidate into `.harness/agent-outputs/`, runs the configured verifier, and emits `external-import` run-result and trace evidence without executing a model provider, reading live credentials, or charging model usage. External-import artifacts use `credential_reference.source: external`, zero external usage, candidate provenance links with SHA-256, and omit `model_status` so they cannot be mistaken for deterministic `agent-run` or provider-backed live execution. Assessment reports external imports separately and does not count them as agent-run evidence, and the run-result ledger refuses to replace an existing run id with a different evidence kind. Targeted CLI and schema fixture tests passed.

### Stage 18.5 acceptance criteria

- [x] A Copilot-as-model candidate can be verified through harness and produces trace, verifier-result, and run-result evidence.
- [x] Imported candidates are path-safe, provenance-linked, and copied into the harness artifact area.
- [x] External-import artifacts are schema-distinct from deterministic `agent-run`, assessment run-result evidence, and provider-backed `live-model` execution.
- [x] No provider-backed model call, credential read, or model spend is implied by this path.

## Stage 19: Recurring maintenance profile substrate and MVP

- [x] Define recurring-profile state, trigger, inputs, state artifacts, allowed actions, stop condition, and handoff contract.
- [x] Ship GC stability as the MVP profile because it can consume GC and health evidence without live-runner support.
- [x] Document objective trigger thresholds for non-MVP profiles: doc-gardener needs docs-health evidence, eval-curator needs holdout eval evidence, and trace-reviewer needs Stage 18 trace evidence.
- [x] Implement or document the MVP profile only when it consumes substrate evidence and adds value beyond a one-shot summary.
- [x] Add plugin- or scheduler-driven examples if useful.
- [x] Add fixtures or examples demonstrating the MVP profile stopping when its condition is met.
- [x] Promote Stage 13 capability candidates owned by recurring profiles only when recurring-profile contracts express them as evidence-backed scheduled work with measurable stop conditions, not prompt-only habits.
- [x] When adopting a Stage 13 capability, record the adopted `capability_id` and whether cleanup eligibility is triggered.
- [x] Run profile tests/evals where available.
- [x] Run `git diff --check`.

Evidence: The pre-slice project GC audit produced `findings: []`, and the capability ledger still has no adopted/superseded or cleanup-eligible entries. Stage 19 adds `schemas/recurring-profile.schema.json` and `schemas/profile-run.schema.json`, plus `harness profile validate` and `harness profile run` as deterministic single-run profile commands. The MVP `examples/profiles/gc-stability.yaml` consumes GC evidence and health-result evidence, evaluates structured trigger and stop-condition thresholds, emits hashed evidence inputs and a profile-run handoff artifact, and records deterministic summary actions only. The profile does not run GC, schedule itself, execute cleanup, mutate repository files, call models, or write capability-ledger adoption state. Tests cover clean stop behavior, dirty not-met behavior, and previous-run clean streak continuity. `bun run check`, unit tests, e2e tests, build, fixture validation, and `git diff --check` passed.

### Stage 19 acceptance criteria

- [x] The MVP profile consumes substrate artifacts and adds behavior beyond one-shot summaries.
- [x] Stage 13 capability candidates owned by recurring profiles are promoted only when recurring-profile contracts express them as evidence-backed scheduled work with measurable stop conditions.
- [x] Future profiles have objective trigger thresholds before implementation begins.
- [x] The MVP profile has a measurable stop condition and handoff artifact.
- [x] Fixtures or examples demonstrate the MVP profile stopping when its condition is met.

## Stage 20: Delivery surface and adoption packaging

- [x] Harden package contents for external users.
- [x] Document the CLI-first quickstart from install/invoke through first health check and evidence review.
- [x] Verify schema distribution and examples are included in the deliverable package.
- [x] Add a sandboxed downstream adoption smoke test that runs install/invoke -> init -> health -> evidence inspection -> assessment with health evidence.
- [x] Require the downstream smoke test to reach at least 8/10 on the scorecard version that adds `project-health`, improving on the Stage 13 downstream baseline of 5/9 without reinterpreting the old denominator.
- [x] Ensure the downstream smoke test has no critical gaps for initialization, local health evidence, and basic assessment/report output.
- [x] Document unsupported paths clearly: full plugin, CI enforcement, and live runners remain optional or planned until proven.
- [x] Ensure adapter and CI guidance remain projections over CLI/schema artifacts.
- [x] Run package/build validation.
- [x] Run `git diff --check`.

Evidence: The pre-slice project GC audit produced `findings: []`, and the capability ledger still has no adopted/superseded or cleanup-eligible entries. Stage 20 adds package dry-run coverage that verifies delivery artifacts such as `dist/index.js`, schemas, examples, docs, and README are included, plus a packed-content smoke that unpacks the tarball and initializes a downstream project from the packaged CLI bundle. The downstream e2e smoke now initializes a project, validates it, runs health checks, generates GC/profile evidence, inspects health evidence through `harness assess`, and asserts the scorecard version with `project-health` reaches at least `8/10`. README and CLI docs now include the CLI-first quickstart, package dry-run/packed-content status, generated artifact expectations, and explicit unsupported paths for host plugins, CI enforcement, scheduler daemons, and provider-backed live model execution. `bun run check`, unit tests, e2e tests, build, fixture validation, and `git diff --check` passed.

Post-review layout refinement: `harness init` now keeps the target repository root focused on `harness.yaml`, writes editable harness support files under `.harness/**`, and routes generated evidence/runtime outputs under `.harness/outputs/**`. The packaged repository `examples/**` remain examples and fixtures rather than the default initialized-project layout. Tests and docs now distinguish user-editable support files such as `.harness/policies/sandbox-policy.yaml` and `.harness/profiles/gc-stability.yaml` from generated evidence such as `.harness/outputs/health/*.json`, `.harness/outputs/gc/*.json`, and `.harness/outputs/run-results.jsonl`.

### Stage 20 acceptance criteria

- [x] A downstream user can install or invoke the CLI and initialize a harness without repo-author handholding.
- [x] Quickstart explains generated artifacts, safe defaults, and next health-check command.
- [x] The downstream smoke test reaches at least 8/10 on the scorecard version that adds `project-health`.
- [x] Package contents include dist, schemas, examples, docs, and no implementation-only assumptions.
- [x] Public docs distinguish current product support from planned adapters, CI, and live-runner paths.

## Cross-cutting checks before each stage

Use this as a reusable checklist before starting each future stage; unchecked items here are not evidence that completed stages regressed.

- [ ] Confirm the stage has one logical purpose.
- [ ] Confirm intermediate repo state remains useful and not misleading.
- [ ] Confirm docs separate current capability from planned capability.
- [ ] Confirm schema/CLI/plugin/adapter changes do not create a second source of truth.
- [ ] Confirm no secrets, credentials, or unbounded model spend are introduced.
- [ ] Confirm any local check/verifier/repair action declares trust and sandbox requirements.
- [ ] Confirm touched stage acceptance criteria are satisfied.
- [ ] Run appropriate tests for touched code.
- [ ] Run `git diff --check`.
