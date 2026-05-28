# PR 1 Biome naming cleanup plan

## Scope

PR 1 started as a rename-only cleanup for existing TypeScript interfaces that violate the configured Biome `useNamingConvention` interface rule. It now also includes the remaining current naming blockers required for `bun run check` to pass: external JSON/evidence field property syntax and one type-parameter rename. It must not change runtime behavior, schemas, command JSON output, runner/model semantics, or `biome.json`.

## Inventory source

Inventory command:

```sh
bun biome lint --reporter=json
```

The initial inventory found 67 interface diagnostics:

- 66 names missing the required `I` prefix.
- 1 name, `InvalidFixture`, beginning with `I` but failing the required `I` + PascalCase name part. Its target is `IInvalidFixture`.
- Additional check-blocking diagnostics were cleared without changing wire shapes: external JSON/evidence field names that intentionally use snake_case or CONSTANT_CASE now use computed literal property keys in TypeScript, and the remaining generic `T` was renamed to a `T*` type parameter.

## Rename slices

| Slice | Rationale | Files |
|---|---|---|
| `pr1-cli-command-types` | Command entrypoint/context interfaces and command-local validation types. | `src/cli.ts`, `src/commands/**` |
| `pr1-core-library-types` | Shared substrate interfaces used by command implementations. | `src/lib/adapter-scope.ts`, `src/lib/assessment.ts`, `src/lib/doctor.ts`, `src/lib/execution-loop.ts`, `src/lib/gc.ts`, `src/lib/harness.ts`, `src/lib/health.ts`, `src/lib/options.ts`, `src/lib/process.ts`, `src/lib/profile.ts`, `src/lib/schema-registry.ts` |
| `pr1-runner-eval-types` | Existing runner/eval interfaces renamed only; runner/model cleanup is deferred to PR 2. | `src/lib/agent-runner.ts`, `src/lib/eval.ts`, `src/lib/runner-readiness.ts` |
| `pr1-test-types` | Test-local helper interfaces. | `tests/**` |

## Rename inventory

| Slice | Current interface | Target interface | Declaration file | Affected files |
|---|---|---|---|---|
| `pr1-cli-command-types` | `RunContext` | `IRunContext` | `src/cli.ts` | `src/cli.ts` |
| `pr1-cli-command-types` | `CommandContext` | `ICommandContext` | `src/commands/init.ts` | `src/commands/adapter.ts`<br>`src/commands/assess.ts`<br>`src/commands/doctor.ts`<br>`src/commands/eval.ts`<br>`src/commands/gc.ts`<br>`src/commands/health.ts`<br>`src/commands/init.ts`<br>`src/commands/loop.ts`<br>`src/commands/migrate.ts`<br>`src/commands/profile.ts`<br>`src/commands/report.ts`<br>`src/commands/run.ts`<br>`src/commands/runner.ts`<br>`src/commands/trace.ts`<br>`src/commands/validate.ts`<br>`src/commands/verify.ts` |
| `pr1-cli-command-types` | `SchemaIssue` | `ISchemaIssue` | `src/commands/loop.ts` | `src/commands/loop.ts` |
| `pr1-cli-command-types` | `PolicyContext` | `IPolicyContext` | `src/commands/loop.ts` | `src/commands/loop.ts` |
| `pr1-core-library-types` | `AdapterScopeValidationSummary` | `IAdapterScopeValidationSummary` | `src/lib/adapter-scope.ts` | `src/lib/adapter-scope.ts` |
| `pr1-core-library-types` | `AdapterScopeValidationResult` | `IAdapterScopeValidationResult` | `src/lib/adapter-scope.ts` | `src/lib/adapter-scope.ts` |
| `pr1-runner-eval-types` | `AgentRunRequest` | `IAgentRunRequest` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-runner-eval-types` | `AgentEvalRunRequest` | `IAgentEvalRunRequest` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-runner-eval-types` | `AgentRunArtifacts` | `IAgentRunArtifacts` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-runner-eval-types` | `AgentEvalRunArtifacts` | `IAgentEvalRunArtifacts` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-runner-eval-types` | `RunnerContext` | `IRunnerContext` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-runner-eval-types` | `EvalTaskData` | `IEvalTaskData` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts`<br>`src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalTaskArtifact` | `IEvalTaskArtifact` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts`<br>`src/lib/eval.ts` |
| `pr1-runner-eval-types` | `AgentExecution` | `IAgentExecution` | `src/lib/agent-runner.ts` | `src/lib/agent-runner.ts` |
| `pr1-core-library-types` | `AssessmentRequest` | `IAssessmentRequest` | `src/lib/assessment.ts` | `src/lib/assessment.ts` |
| `pr1-core-library-types` | `LoadedArtifact` | `ILoadedArtifact` | `src/lib/assessment.ts` | `src/lib/assessment.ts` |
| `pr1-core-library-types` | `RepairActionCandidate` | `IRepairActionCandidate` | `src/lib/assessment.ts` | `src/lib/assessment.ts` |
| `pr1-core-library-types` | `DoctorRun` | `IDoctorRun` | `src/lib/doctor.ts` | `src/lib/doctor.ts` |
| `pr1-core-library-types` | `DoctorRunInput` | `IDoctorRunInput` | `src/lib/doctor.ts` | `src/lib/doctor.ts` |
| `pr1-core-library-types` | `DoctorDeclaration` | `IDoctorDeclaration` | `src/lib/doctor.ts` | `src/lib/doctor.ts` |
| `pr1-runner-eval-types` | `EvalTaskDiscoveryInput` | `IEvalTaskDiscoveryInput` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalTaskDiscoveryResult` | `IEvalTaskDiscoveryResult` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalValidationInput` | `IEvalValidationInput` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalValidationRun` | `IEvalValidationRun` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `VerifierResultArtifact` | `IVerifierResultArtifact` | `src/lib/eval.ts` | `src/commands/eval.ts`<br>`src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalTaskData` | `IEvalTaskData` | `src/lib/eval.ts` | `src/lib/agent-runner.ts`<br>`src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalTaskArtifact` | `IEvalTaskArtifact` | `src/lib/eval.ts` | `src/lib/agent-runner.ts`<br>`src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvalCase` | `IEvalCase` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `EvaluatedCase` | `IEvaluatedCase` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-runner-eval-types` | `VerifierExecutionResult` | `IVerifierExecutionResult` | `src/lib/eval.ts` | `src/lib/eval.ts` |
| `pr1-core-library-types` | `ExecutionLoopValidationInput` | `IExecutionLoopValidationInput` | `src/lib/execution-loop.ts` | `src/lib/execution-loop.ts` |
| `pr1-core-library-types` | `ExecutionLoopValidationSummary` | `IExecutionLoopValidationSummary` | `src/lib/execution-loop.ts` | `src/lib/execution-loop.ts` |
| `pr1-core-library-types` | `ExecutionLoopValidationResult` | `IExecutionLoopValidationResult` | `src/lib/execution-loop.ts` | `src/lib/execution-loop.ts` |
| `pr1-core-library-types` | `GcAuditInput` | `IGcAuditInput` | `src/lib/gc.ts` | `src/lib/gc.ts` |
| `pr1-core-library-types` | `GcAuditRun` | `IGcAuditRun` | `src/lib/gc.ts` | `src/lib/gc.ts` |
| `pr1-core-library-types` | `FindingInput` | `IFindingInput` | `src/lib/gc.ts` | `src/lib/gc.ts` |
| `pr1-core-library-types` | `DuplicateRecord` | `IDuplicateRecord` | `src/lib/gc.ts` | `src/lib/gc.ts` |
| `pr1-core-library-types` | `LoadedEvidenceArtifact` | `ILoadedEvidenceArtifact` | `src/lib/gc.ts` | `src/lib/gc.ts` |
| `pr1-core-library-types` | `HarnessValidationResult` | `IHarnessValidationResult` | `src/lib/harness.ts` | `src/lib/assessment.ts`<br>`src/lib/gc.ts`<br>`src/lib/harness.ts` |
| `pr1-core-library-types` | `HarnessReference` | `IHarnessReference` | `src/lib/harness.ts` | `src/lib/harness.ts` |
| `pr1-core-library-types` | `HealthCheckDeclaration` | `IHealthCheckDeclaration` | `src/lib/health.ts` | `src/lib/health.ts` |
| `pr1-core-library-types` | `HealthCheckRun` | `IHealthCheckRun` | `src/lib/health.ts` | `src/lib/health.ts` |
| `pr1-core-library-types` | `HealthRunInput` | `IHealthRunInput` | `src/lib/health.ts` | `src/lib/health.ts` |
| `pr1-core-library-types` | `HealthRun` | `IHealthRun` | `src/lib/health.ts` | `src/lib/health.ts` |
| `pr1-core-library-types` | `ParsedOptions` | `IParsedOptions` | `src/lib/options.ts` | `src/lib/options.ts` |
| `pr1-core-library-types` | `ShellCommandInput` | `IShellCommandInput` | `src/lib/process.ts` | `src/lib/process.ts` |
| `pr1-core-library-types` | `ShellCommandResult` | `IShellCommandResult` | `src/lib/process.ts` | `src/lib/process.ts` |
| `pr1-core-library-types` | `LoadedEvidence` | `ILoadedEvidence` | `src/lib/profile.ts` | `src/lib/profile.ts` |
| `pr1-core-library-types` | `ConditionObservation` | `IConditionObservation` | `src/lib/profile.ts` | `src/lib/profile.ts` |
| `pr1-core-library-types` | `ConditionResult` | `IConditionResult` | `src/lib/profile.ts` | `src/lib/profile.ts` |
| `pr1-core-library-types` | `ProfileRunRequest` | `IProfileRunRequest` | `src/lib/profile.ts` | `src/lib/profile.ts` |
| `pr1-core-library-types` | `ProfileRun` | `IProfileRun` | `src/lib/profile.ts` | `src/lib/profile.ts` |
| `pr1-runner-eval-types` | `ReadinessCheck` | `IReadinessCheck` | `src/lib/runner-readiness.ts` | `src/lib/runner-readiness.ts` |
| `pr1-runner-eval-types` | `RunnerReadinessInput` | `IRunnerReadinessInput` | `src/lib/runner-readiness.ts` | `src/lib/runner-readiness.ts` |
| `pr1-runner-eval-types` | `RunnerReadinessRun` | `IRunnerReadinessRun` | `src/lib/runner-readiness.ts` | `src/lib/runner-readiness.ts` |
| `pr1-core-library-types` | `ValidationIssue` | `IValidationIssue` | `src/lib/schema-registry.ts` | `src/lib/harness.ts`<br>`src/lib/schema-registry.ts` |
| `pr1-core-library-types` | `SchemaRegistry` | `ISchemaRegistry` | `src/lib/schema-registry.ts` | `src/commands/loop.ts`<br>`src/commands/report.ts`<br>`src/lib/agent-runner.ts`<br>`src/lib/assessment.ts`<br>`src/lib/doctor.ts`<br>`src/lib/eval.ts`<br>`src/lib/gc.ts`<br>`src/lib/harness.ts`<br>`src/lib/health.ts`<br>`src/lib/profile.ts`<br>`src/lib/runner-readiness.ts`<br>`src/lib/schema-registry.ts` |
| `pr1-core-library-types` | `LoadedSchema` | `ILoadedSchema` | `src/lib/schema-registry.ts` | `src/lib/schema-registry.ts` |
| `pr1-test-types` | `RunResult` | `IRunResult` | `tests/cli/cli.test.ts` | `tests/cli/cli.test.ts` |
| `pr1-test-types` | `CliResult` | `ICliResult` | `tests/e2e/cli-e2e.test.ts` | `tests/e2e/cli-e2e.test.ts` |
| `pr1-test-types` | `Manifest` | `IManifest` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `MatrixInvariantRules` | `IMatrixInvariantRules` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `ValidFixture` | `IValidFixture` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `InvalidFixture` | `IInvalidFixture` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `ReferencedEvidenceFixture` | `IReferencedEvidenceFixture` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `CustomInvalidFixture` | `ICustomInvalidFixture` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |
| `pr1-test-types` | `CustomValidFixture` | `ICustomValidFixture` | `tests/schemas/schema-fixtures.test.ts` | `tests/schemas/schema-fixtures.test.ts` |

## Check-blocking naming cleanup inventory

External JSON, evidence, manifest, and environment field names that intentionally use snake_case or CONSTANT_CASE use computed literal property syntax in TypeScript. This preserves the exact serialized or parsed field name while satisfying the configured naming convention. Apply the same convention to type-only declarations that model external manifests or evidence shapes, because those names are still wire/input field names even when they do not emit runtime properties.

Do not apply Biome's `lint/complexity/useLiteralKeys` unsafe suggestion for these fields unless `biome.json` is updated in a separate approved change to explicitly allow the external field formats. The suggestion is info-level and `bun run check` exits successfully.

Reviewer inventory command:

```sh
git --no-pager diff -- src tests \
  | node -e "const fs=require('fs');const input=fs.readFileSync(0,'utf8');const files=new Map();let file=null;for(const line of input.split('\n')){const m=line.match(/^\+\+\+ b\/(.+)$/);if(m){file=m[1];continue;}if(!file||!line.startsWith('+')||line.startsWith('+++'))continue;const regex=/\[['\"]([A-Za-z0-9_]+)['\"]\]/g;let match;while((match=regex.exec(line))){const key=match[1];if(!key.includes('_')&&key!==key.toUpperCase())continue;if(!files.has(file))files.set(file,new Set());files.get(file).add(key);}}for(const [f,keys] of [...files.entries()].sort()){console.log(f+': '+[...keys].sort().join(', '));}"
```

The current PR 1 diff has 414 computed external-field occurrences across these files. A raw grep for `\[['"]` returns one additional camelCase type indexed-access expression (`IAgentExecution['importedCandidate']`) that is part of an interface rename and is not an external field.

| File | External keys |
|---|---|
| `src/commands/gc.ts` | `schema_version` |
| `src/commands/migrate.ts` | `cli_version`, `dry_run`, `from_schema_version`, `media_type`, `schema_version`, `to_schema_version`, `would_change` |
| `src/commands/trace.ts` | `schema_version` |
| `src/lib/agent-runner.ts` | `HARNESS_EVAL_CANDIDATE`, `HARNESS_EVAL_CASE`, `HARNESS_EVAL_DATASET_HASH`, `HARNESS_EVAL_EXPECTED_STATUS`, `HARNESS_EVAL_SPLIT`, `HARNESS_EVAL_SUITE_ID`, `HARNESS_EVAL_TASK`, `HARNESS_EVAL_TASK_ID`, `HARNESS_EVAL_TASK_VERSION`, `actual_status`, `agent_output`, `agent_status`, `approval_policy`, `artifact_links`, `billed_model_id`, `completed_at`, `credential_reference`, `dataset_hash`, `determinism_level`, `duration_ms`, `environment_snapshot`, `exit_code`, `expectation_met`, `expected_status`, `failure_buckets`, `failure_code`, `generated_at`, `harness_status`, `harness_version`, `incurred_cost_usd`, `input_tokens`, `latency_ms`, `media_type`, `model_call`, `model_id`, `model_profile`, `model_status`, `output_tokens`, `request_id`, `run_id`, `run_results`, `schema_version`, `scoreboard_id`, `session_id`, `source_candidate`, `started_at`, `suite_id`, `task_id`, `task_version`, `timed_out`, `total_tokens`, `verifier_id`, `verifier_result`, `verifier_results`, `verifier_status` |
| `src/lib/assessment.ts` | `adapter_path`, `approval_state`, `approval_trust`, `artifacts_read`, `assessment_id`, `cli_version`, `external_import_error`, `external_import_failed`, `external_import_passed`, `external_import_skipped`, `external_import_total`, `implementation_routing`, `line_count`, `max_score`, `media_type`, `missing_primitives`, `rejected_paths`, `repair_mode`, `risk_class`, `rollout_plan`, `sandbox_requirement`, `schema_version`, `scorecard_version`, `selected_route`, `target_files`, `trust_requirements` |
| `src/lib/doctor.ts` | `allowed_inputs`, `allowed_outputs`, `exit_semantics`, `false_positive_policy`, `harness_version`, `host_file_access`, `media_type`, `network_access`, `run_id`, `sandbox_required`, `schema_version`, `secret_access`, `trust_level`, `trust_requirements` |
| `src/lib/eval.ts` | `HARNESS_EVAL_CANDIDATE`, `HARNESS_EVAL_CASE`, `HARNESS_EVAL_DATASET_HASH`, `HARNESS_EVAL_EXPECTED_STATUS`, `HARNESS_EVAL_SPLIT`, `HARNESS_EVAL_SUITE_ID`, `HARNESS_EVAL_TASK`, `HARNESS_EVAL_TASK_ID`, `HARNESS_EVAL_TASK_VERSION`, `actual_status`, `billed_model_id`, `dataset_hash`, `exit_code`, `expectation_met`, `expected_status`, `failure_code`, `harness_status`, `harness_version`, `incurred_cost_usd`, `input_tokens`, `media_type`, `model_profile`, `output_tokens`, `run_id`, `run_results`, `schema_version`, `suite_id`, `task_id`, `task_version`, `timed_out`, `total_tokens`, `verifier_id`, `verifier_result`, `verifier_results`, `verifier_status` |
| `src/lib/gc.ts` | `atomicity_notes`, `audit_id`, `blast_radius`, `evidence_refs`, `generated_at`, `media_type`, `previous_audit_ref`, `promotion_decision_refs`, `proposed_cleanup_slice`, `retirement_decision_refs`, `schema_version`, `target_files` |
| `src/lib/health.ts` | `approval_policy`, `duration_ms`, `exit_code`, `failure_code`, `harness_version`, `media_type`, `run_id`, `runtime_enforced`, `sandbox_enforcement`, `sandbox_policy`, `schema_version`, `stderr_truncated`, `stdout_truncated`, `timeout_seconds`, `trust_requirements` |
| `src/lib/profile.ts` | `actions_taken`, `clean_streak`, `declared_capability_id`, `evidence_inputs`, `gc_findings`, `generated_at`, `harness_version`, `health_status`, `media_type`, `next_step`, `previous_run_ref`, `profile_id`, `profile_ref`, `profile_version`, `run_id`, `schema_version`, `stop_condition_evaluation`, `trigger_evaluation` |
| `src/lib/runner-readiness.ts` | `failure_code`, `harness_version`, `live_ready`, `media_type`, `run_id`, `schema_version` |
| `tests/cli/cli.test.ts` | `agent_status`, `allowed_inputs`, `allowed_outputs`, `approval_state`, `atomicity_notes`, `audit_id`, `billed_model_id`, `blast_radius`, `cli_management_modes`, `cli_resolution_order`, `dataset_hash`, `evidence_ids`, `evidence_refs`, `failure_code`, `generated_at`, `harness_status`, `harness_version`, `host_file_access`, `implementation_routing`, `implemented_capabilities`, `incurred_cost_usd`, `input_tokens`, `judge_results`, `max_score`, `media_type`, `model_profile`, `model_status`, `network_access`, `output_tokens`, `previous_audit_ref`, `profile_id`, `promotion_decision_refs`, `proposed_cleanup_slice`, `retirement_decision_refs`, `run_id`, `sandbox_required`, `schema_version`, `secret_access`, `selected_route`, `suite_id`, `target_files`, `task_id`, `task_version`, `total_tokens`, `trust_level`, `unavailable_capabilities`, `user_label`, `verifier_result`, `verifier_status` |
| `tests/e2e/cli-e2e.test.ts` | `NO_COLOR` |
| `tests/schemas/schema-fixtures.test.ts` | `capability_dimensions`, `custom_invalid`, `custom_valid`, `expected_error_code`, `expected_keyword`, `expected_message_contains`, `expected_missing_code`, `expected_path`, `failure_taxonomy_required_codes`, `limited_adapter_core_capabilities`, `null_decision_consequences`, `out_of_scope_distribution_surfaces`, `out_of_scope_surface_kinds`, `plugin_capability_matrix_invariants`, `referenced_evidence`, `rich_ux_capabilities`, `selectable_tiers`, `tier_consequences` |

The single type-parameter cleanup is `sortRepairActions<T>` to `sortRepairActions<TRepairActionCandidate>` in `src/lib/assessment.ts`.

## Verification result

- [x] Applied the rename inventory as type-only identifier changes.
- [x] Confirmed no interface-declaration `lint/style/useNamingConvention` diagnostics remain.
- [x] Cleared remaining `useNamingConvention` diagnostics required for `bun run check` while preserving emitted JSON/evidence field names.
- [x] Confirmed TypeScript still resolves all imports and references with `bun run typecheck`.
- [x] Confirmed unit tests still pass with `bun run test:unit`.
- [x] Confirmed `git diff --check` passes for PR 1 files.
- [x] Confirmed `bun run check` passes.
