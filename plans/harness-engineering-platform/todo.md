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
  - [x] `agent-coding` skill compatibility pending Stage 13.
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

- [x] README includes a host/path quickstart matrix covering the current documented CLI-first path, planned marketplace plugin paths, audited skill compatibility status, and optional CI.
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
- `PYTHONPATH=/tmp/harness-schema-validation python3 examples/fixtures/validate.py`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/calibrated-blocking.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/advisory-only.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/below-threshold.json`
- `node dist/index.js report --file examples/harness.yaml --judge-result examples/judges/results/stale-advisory.json`
- policy-violation smoke for `examples/judges/results/policy-violations/blocking-low-agreement.json`
- `git diff --check`

## Stage 8: Plugin marketplace/API feasibility and target selection

- [ ] Define candidate host list.
- [ ] Evaluate marketplace/extension distribution for each host.
- [ ] Evaluate CLI bundling/bootstrap for each host.
- [ ] Evaluate filesystem access.
- [ ] Evaluate CLI report rendering.
- [ ] Evaluate annotation APIs.
- [ ] Evaluate background runs.
- [ ] Evaluate repair-action UI.
- [ ] Evaluate trace deep-links.
- [ ] Define capability matrix schema or durable format for Stage 9 consumption.
- [ ] Produce per-host capability matrix.
- [ ] Revalidate provisional plugin-capability schema against matrix.
- [ ] Revalidate provisional repair-action schema against matrix.
- [ ] Choose first plugin target or explicitly document CLI-first until plugin exists.
- [ ] Update docs to avoid unavailable plugin promises.
- [ ] Run `git diff --check`.

### Stage 8 acceptance criteria

- [ ] Capability matrix covers marketplace distribution, CLI bundling/bootstrap, filesystem access, report rendering, annotation APIs, background runs, repair-action UI, and trace deep-links.
- [ ] Capability matrix has a durable format that Stage 9 can consume or cite.
- [ ] Provisional plugin-capability and repair-action schemas from Stage 2 are revalidated against host APIs.
- [ ] Chosen plugin target has documented marketplace/extension distribution evidence and API evidence for the required UX.
- [ ] If a plugin target is feasible, proceed to Stage 9.
- [ ] If no rich plugin target is feasible, skip Stage 9, update docs to make CLI-first the default until a plugin exists, and do not promise an unavailable plugin.

## Stage 9: Conditional plugin adapter MVP

- [ ] Implement selected plugin or plugin-style adapter only if Stage 8 finds a feasible target.
- [ ] Package through selected host marketplace/extension mechanism when available.
- [ ] Discover repo-local `harness.yaml`.
- [ ] Initialize through CLI substrate.
- [ ] Render doctor/eval/trace reports from CLI JSON/Markdown outputs.
- [ ] Create supported annotations.
- [ ] Implement supported repair actions through CLI-backed init/migrate/repair flows only.
- [ ] Bundle, pin, or bootstrap CLI dependency.
- [ ] Implement CLI resolution order: repo-pinned compatible CLI, plugin-bundled CLI, then user-installed CLI.
- [ ] Detect repo-pinned CLI version from `harness.yaml` `engines.cli`.
- [ ] Refuse write actions on CLI/schema incompatibility.
- [ ] Ensure plugin does not reimplement doctor checks or eval verifiers.
- [ ] Ensure plugin-local cache is non-authoritative and reconstructible.
- [ ] Ensure repair actions show preview diffs.
- [ ] Ensure repair actions use approval policy.
- [ ] Ensure repair actions declare risk class.
- [ ] Ensure repair actions emit equivalent CLI commands.
- [ ] Run plugin tests for supported host.
- [ ] Run `git diff --check`.

### Stage 9 acceptance criteria

- [ ] A user can install from the selected host marketplace/extension surface and follow plugin-first setup without separately guessing CLI prerequisites.
- [ ] The plugin bundles or auto-manages a pinned CLI dependency unless the host forbids it; constrained-host manual guidance includes missing/incompatible CLI detection and repair prompts.
- [ ] The plugin resolves CLI versions in this order: repo-pinned compatible CLI, plugin-bundled CLI, then user-installed CLI.
- [ ] The plugin refuses write actions when no compatible CLI/schema version exists.
- [ ] Repair actions show preview diffs, use the approval policy, declare risk class, and emit equivalent CLI commands.
- [ ] Plugin does not create a second source of truth; plugin-local cache is non-authoritative, reconstructible, and excluded from CLI/CI behavior.

## Stage 10: Native execution loop and continuity adapter

- [ ] Define native implementation-loop contract or adapter.
- [ ] Read `harness.yaml`.
- [ ] Read approval policy.
- [ ] Read sandbox policy.
- [ ] Read continuity schema.
- [ ] Read self-verification evidence schema.
- [ ] Require original spec reread before completion.
- [ ] Compare acceptance criteria before completion.
- [ ] Run relevant CLI and doctor checks.
- [ ] Capture evidence paths.
- [ ] Update continuity state.
- [ ] Define startup verification.
- [ ] Run startup verification before work begins.
- [ ] Record startup verification in continuity state.
- [ ] Define handoff expectations.
- [ ] Document how external `agent-coding` `execute-plan-loop` can consume the same evidence.
- [ ] Add tests/fixtures for failed startup verification and failed completion gates.
- [ ] Run `git diff --check`.

### Stage 10 acceptance criteria

- [ ] Execution loop cannot claim completion without substrate-aware verification evidence.
- [ ] Approval/sandbox policy decisions are read and either followed or explicitly escalated.
- [ ] Startup verification runs before work begins and records the result in continuity state.
- [ ] Fixtures demonstrate the execution loop refusing to start or complete when startup verification or completion-gate evidence fails.

## Stage 11: Optional CI adapters

- [ ] Add generic CLI exit semantics for CI.
- [ ] Add CI examples for schema validation.
- [ ] Add CI examples for doctor checks.
- [ ] Add CI examples for eval/trace validation.
- [ ] Add report artifact upload example.
- [ ] Include GitHub Actions as one optional example, not the CI contract.
- [ ] Document blocking vs advisory checks.
- [ ] Confirm shared schema/report artifacts support blocking/advisory status for downstream adapter consistency.
- [ ] Ensure uncalibrated LLM-judge results are advisory-only by default.
- [ ] Run CI examples locally where possible.
- [ ] Run `git diff --check`.

### Stage 11 acceptance criteria

- [ ] A downstream repo can opt into objective CI feedback without needing a plugin or agent.
- [ ] CI examples are clearly optional adapters.
- [ ] Blocking/advisory status is represented in shared CLI/schema/report artifacts so CI, plugin, and skill adapters use consistent policy.
- [ ] Uncalibrated LLM-judge results remain advisory-only by default.

## Stage 12: Native agent-facing harness-engineering adapter

- [ ] Choose adapter path, such as `skills/harness-engineering/`, or document a different native adapter path.
- [ ] Add read-only assessment/design workflow.
- [ ] Read `harness.yaml` when present.
- [ ] Read doctor output.
- [ ] Read eval plans.
- [ ] Read traces.
- [ ] Read run results.
- [ ] Read reports.
- [ ] Output maturity scorecard.
- [ ] Output missing primitives.
- [ ] Output rollout stage plan.
- [ ] Output policy/eval/trace/continuity recommendations.
- [ ] Document repair-action discovery/routing mechanism.
- [ ] Route implementation to configured native repair actions, native execution-loop adapters, or documented external skills when available.
- [ ] Add example showing adapter routing to at least one repair action or gracefully deferring to an external skill/fallback.
- [ ] Ensure adapter does not assume `agent-coding` skills are installed or vendored.
- [ ] Add trigger/behavior evals if using a skill format.
- [ ] Run adapter tests/evals.
- [ ] Run `git diff --check`.

### Stage 12 acceptance criteria

- [ ] The adapter emits a maturity scorecard, missing primitives, rollout stage plan, and policy/eval/trace/continuity recommendations from substrate artifacts while preserving CLI/schema as source of truth.
- [ ] Adapter does not assume `agent-coding` skills are installed or vendored in this repo.
- [ ] Adapter demonstrates routing implementation requests to available repair actions, native execution-loop adapters, documented external skills, or a clear fallback when no implementation route is configured.

## Stage 13: `agent-coding` compatibility inventory and migration

- [ ] Start inventory research after Stage 1.
- [ ] Review `workflow-orchestrator`.
- [ ] Review `execute-plan-loop`.
- [ ] Review `decompose-feature`.
- [ ] Review `plan-parallel-work`.
- [ ] Review `ensure-atomic-pr`.
- [ ] Review `refresh-related-docs`.
- [ ] Review `achieve-goal`.
- [ ] Review `scan-image-vulnerabilities`.
- [ ] Classify each as:
  - [ ] native-adapter candidate,
  - [ ] external compatibility helper,
  - [ ] optional utility,
  - [ ] deprecation candidate,
  - [ ] extraction candidate.
- [ ] Decide whether each skill is copied, left external, replaced, extracted, or documentation-only.
- [ ] Provide migration notes or compatibility shims for supported paths.
- [ ] Provide replacement path and migration timeline for unsupported paths.
- [ ] Include before/after workflow examples.
- [ ] Ensure optional utilities are not described as core harness primitives.
- [ ] Run `git diff --check`.

### Stage 13 acceptance criteria

- [ ] Each audited skill is classified with the Stage 13 taxonomy: native-adapter candidate, external compatibility helper, optional utility, deprecation candidate, or extraction candidate.
- [ ] For every deprecated, moved, extracted, or unsupported skill path, docs include replacement path, breaking-change notice, migration timeline, and before/after workflow example.
- [ ] Existing `agent-coding` skill users have a documented adoption path if compatibility remains supported.
- [ ] README and skill docs do not imply optional utilities are core harness primitives.

## Stage 14: GC framework and first deterministic categories

- [ ] Implement `harness gc audit`.
- [ ] Implement `harness gc validate`.
- [ ] Add append-only GC evidence output.
- [ ] Define append-only evidence format such as JSONL, timestamped files, or another durable format.
- [ ] Document how multiple GC audits are preserved without overwriting.
- [ ] Define first deterministic categories with explicit algorithms.
- [ ] Add category for broken references.
- [ ] Add category for duplicate IDs.
- [ ] Add category for stale schema versions.
- [ ] Add passing/failing fixtures for each category.
- [ ] Document false-positive policy for each category.
- [ ] Produce ranked atomic cleanup slices.
- [ ] Include evidence refs and confidence.
- [ ] Include blast radius and atomicity notes.
- [ ] Prohibit fully automated cleanup.
- [ ] Run GC tests.
- [ ] Run `git diff --check`.

### Stage 14 acceptance criteria

- [ ] Users can run a GC audit and get reviewable cleanup slices tied to evidence.
- [ ] GC evidence output is append-only and preserves historical audit runs.
- [ ] Cleanup slices include evidence refs, confidence, blast radius, and atomicity notes; they do not mix unrelated concerns.
- [ ] No GC category ships unless its inputs, algorithm, false-positive policy, and passing/failing fixtures are documented.

## Stage 15: Evidence-driven GC expansion

- [ ] Add tool/policy entropy categories when evidence exists.
- [ ] Add verification entropy categories when evidence exists.
- [ ] Add execution entropy categories when evidence exists.
- [ ] Add eval entropy categories when evidence exists.
- [ ] Add trace entropy categories when evidence exists.
- [ ] Define thresholds for promoting repeated feedback.
- [ ] Require holdout evidence for behavioral rule/eval promotion.
- [ ] Require behavioral promotion to cite holdout results, not only optimization-suite improvement.
- [ ] Define retirement rules for stale rules/templates/evals.
- [ ] Ensure promotion/retirement cites evidence artifacts.
- [ ] Ensure a single preference cannot become a durable rule.
- [ ] Ensure LLM-judge evidence follows Stage 7 calibration policy.
- [ ] Run GC expansion tests.
- [ ] Run `git diff --check`.

### Stage 15 acceptance criteria

- [ ] Promotion/retirement cites evidence artifacts.
- [ ] A single preference cannot become a durable rule.
- [ ] LLM-judge evidence follows Stage 7 calibration policy.
- [ ] Behavioral rule/eval promotion cites holdout results, not only optimization-suite improvement.

## Stage 16: Skill-adapter GC and migration cleanup

- [ ] Add checks only for skill adapters this repo chooses to support.
- [ ] Add skill trigger/routing drift checks.
- [ ] Add duplicated adapter guidance checks.
- [ ] Add obsolete skill reference checks.
- [ ] Add migration cleanup categories.
- [ ] Connect findings to Stage 13 classification or migration docs.
- [ ] Ensure no cleanup slice deletes behavior without documented replacement.
- [ ] Run skill-adapter GC tests.
- [ ] Run `git diff --check`.

### Stage 16 acceptance criteria

- [ ] Skill-specific GC findings cite Stage 13 classification or migration docs.
- [ ] No skill cleanup slice deletes user-facing behavior without a documented replacement path.

## Stage 17: Recurring profiles and scheduled maintenance

- [ ] Add entropy-auditor profile.
- [ ] Add doc-gardener profile.
- [ ] Add eval-curator profile.
- [ ] Add trace-reviewer profile.
- [ ] Document trigger for each profile.
- [ ] Document inputs for each profile.
- [ ] Document state artifacts for each profile.
- [ ] Document allowed actions for each profile.
- [ ] Document measurable stop condition for each profile.
- [ ] Document handoff artifact for each profile.
- [ ] Add plugin- or scheduler-driven examples if useful.
- [ ] Ensure profiles consume substrate artifacts and add value beyond one-shot summaries.
- [ ] Add fixtures or examples demonstrating profile stopping when condition is met.
- [ ] Run profile tests/evals where available.
- [ ] Run `git diff --check`.

### Stage 17 acceptance criteria

- [ ] Profiles consume substrate artifacts and add behavior beyond one-shot summaries.
- [ ] The initial shipped profile set includes entropy-auditor, doc-gardener, eval-curator, and trace-reviewer profiles.
- [ ] Each profile has a measurable stop condition and handoff artifact.
- [ ] Fixtures or examples demonstrate each profile stopping when its condition is met.

## Cross-cutting checks before each stage

- [ ] Confirm the stage has one logical purpose.
- [ ] Confirm intermediate repo state remains useful and not misleading.
- [ ] Confirm docs separate current capability from planned capability.
- [ ] Confirm schema/CLI/plugin/adapter changes do not create a second source of truth.
- [ ] Confirm no secrets, credentials, or unbounded model spend are introduced.
- [ ] Confirm any local check/verifier/repair action declares trust and sandbox requirements.
- [ ] Confirm touched stage acceptance criteria are satisfied.
- [ ] Run appropriate tests for touched code.
- [ ] Run `git diff --check`.
