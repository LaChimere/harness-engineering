# Todo: Agent CLI plugin architecture implementation

## Status

Gate 2 is approved, and PR 1 is complete. These todos track execution after the approved design.

## Legend

- `[ ]` pending
- `[~]` in progress
- `[x]` done
- `[!]` blocked

## Gate 2

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `gate-2-approval` | Gate 1 design approval | Review `plan.md` and `todo.md` for alignment with `design.md`. | User approved Gate 2 and implementation may begin. |

## PR 1: Biome naming cleanup plan and rename-only interface slices

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr1-interface-inventory` | `gate-2-approval` | Run `bun biome lint --reporter=json` and extract `useNamingConvention` interface violations. | Every non-`I` interface violation is captured with current name, target name, affected files, and proposed slice. |
| [x] | `pr1-interface-plan` | `pr1-interface-inventory` | Create `plans/agent-cli-plugin-architecture/interface-rename-plan.md`. | The plan has a table with current interface, target interface, affected files, slice ID, grouping rationale, and verification checklist. |
| [x] | `pr1-interface-slices` | `pr1-interface-plan` | Apply rename-only slices by domain. | Each slice changes only interface names/imports/type references and preserves runtime behavior. |
| [x] | `pr1-check-blockers` | `pr1-interface-slices` | Clear remaining Biome naming blockers required for `bun run check`. | External JSON/evidence field names keep their emitted snake_case or CONSTANT_CASE wire shape by using computed literal property keys in TypeScript, and the remaining non-conforming type parameter is renamed to a `T*` name. |
| [x] | `pr1-external-key-convention` | `pr1-check-blockers` | Document the external-key convention and expanded cleanup inventory. | `interface-rename-plan.md` explains computed literal keys for external JSON/evidence/manifest fields, notes the type-only fixture-shape case, and includes a reviewer-verifiable key inventory command. |
| [x] | `pr1-verify` | `pr1-external-key-convention` | Validate PR 1. | `bun run check`, `bun run test:unit`, and `git diff --check` pass; rerunning `bun biome lint --reporter=json` shows no remaining `useNamingConvention` diagnostics. |

## PR 2: Runner/model cleanup inventory and removal

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr2-cleanup-inventory` | `pr1-verify` | Expand the runner/model cleanup inventory in `design.md`. | Every runner/model command, lib, schema, fixture, example, doc, and test path has current purpose and explicit target fate; edits are limited to the cleanup inventory table and do not reopen approved scope/principles/architecture decisions. |
| [x] | `pr2-remove-runner-commands` | `pr2-cleanup-inventory` | Remove `harness run` and `harness runner` model-execution semantics. | Commands are deleted or renamed out of Harness-owned model execution, with usage/tests updated. |
| [x] | `pr2-remove-runner-libs` | `pr2-cleanup-inventory` | Remove `src/lib/agent-runner.ts`, `src/lib/runner-readiness.ts`, and dependent code. | No runtime import or test references deleted runner/model libraries. |
| [x] | `pr2-remove-runner-schemas-config` | `pr2-cleanup-inventory` | Remove runner/model schema and default config surfaces. | `model_profiles`, `agent_runners`, model profile schemas, agent runner schemas, and readiness schema are gone from default user substrate. |
| [x] | `pr2-update-init-examples-docs` | `pr2-cleanup-inventory` | Update `harness init`, examples, fixtures, and docs. | Initialized projects no longer emit runner/model files; public docs use host-agent-produced evidence language. |
| [x] | `pr2-update-trace-profile-provenance` | `pr2-cleanup-inventory` | Update trace/profile schema field descriptions. | `environment_snapshot.runner` and `environment_snapshot.model_profile` are documented as read-only imported provenance. |
| [x] | `pr2-verify` | PR 2 tasks | Validate PR 2. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, runner/model stale search over `README.md AGENTS.md docs src schemas examples tests`, public-doc boundary search, and `git diff --check` pass; any remaining matches are approved exceptions recorded in the cleanup inventory; `harness verify` and `harness eval` behavior remain unchanged except inventory-required import/type fixups. |

## PR 3: CLI JSON migration plan and shared contract base

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr3-rerun-json-inventory` | `pr2-verify` | Rerun agent-facing commands with `--format json` against fixtures/test configs. | Current output shapes for `doctor`, `health`, `assess`, `gc audit`, `trace validate`, and `profile run` are confirmed or recorded in the `design.md` current-state inventory table only; approved scope/principles/architecture decisions are not reopened. |
| [x] | `pr3-write-migration-plan` | `pr3-rerun-json-inventory` | Create `plans/agent-cli-plugin-architecture/cli-json-migration.md`. | Each schema has field additions/renames/moves, schema version bump, status semantics, and a clean pre-release migration strategy that updates first-party code, fixtures, tests, and docs without dual-field compatibility shims. |
| [x] | `pr3-add-contract-base` | `pr3-write-migration-plan` | Add shared contract scaffolding if non-behavioral. | `ICliJsonContract`, `ICliJsonIssue`, and `ICliJsonArtifact` scaffolding exists only if it does not change command outputs prematurely. |
| [x] | `pr3-verify` | `pr3-add-contract-base` | Validate PR 3. | `bun run check`, `bun run test:unit`, and `git diff --check` pass. |

## PR 4A: Structural command JSON hardening

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr4a-doctor-json` | `pr3-verify` | Apply the migration plan to `harness doctor --format json`. | Doctor output validates against schema, preserves `checks`, exposes structured `issues` only as planned, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [x] | `pr4a-health-json` | `pr3-verify` | Apply the migration plan to `harness health --format json`. | Health output validates against schema, preserves per-check details, exposes structured `issues` only as planned, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [x] | `pr4a-assess-json` | `pr3-verify` | Apply the migration plan to `harness assess --format json`. | Assessment output validates against schema, does not conflate recommendations with command failures, and replaces renamed legacy command-result fields cleanly without dual-field compatibility shims. |
| [x] | `pr4a-fixtures-tests` | PR 4A command tasks | Add structural command golden fixtures and schema validation tests. | Each command has at least one success and one failure/non-passing fixture validated by tests. |
| [x] | `pr4a-verify` | `pr4a-fixtures-tests` | Validate PR 4A. | `bun run check`, `bun run test:unit`, `bun run build`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, and `git diff --check` pass. |

## PR 4B: Evidence command JSON hardening

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr4b-gc-json` | `pr4a-verify` | Apply the migration plan to `harness gc audit --format json`. | GC output has planned top-level status/issues while keeping `findings` separate, and renamed legacy command-result fields are replaced cleanly without dual-field compatibility shims. |
| [x] | `pr4b-trace-json` | `pr4a-verify` | Add `schemas/trace-validate-result.schema.json` for `harness trace validate --format json`. | Trace validation command output validates against `schemas/trace-validate-result.schema.json`, which is distinct from `schemas/trace.schema.json`, and string trace validation issues are replaced by structured `issues[]` without dual-field compatibility shims. |
| [x] | `pr4b-profile-json` | `pr4a-verify` | Apply the migration plan to `harness profile run --format json`. | Profile output has planned top-level status/issues while keeping `handoff` canonical, and legacy command-result `profile-run.errors[]` is replaced by structured `issues[]` in the same pre-release migration. |
| [x] | `pr4b-fixtures-tests` | PR 4B command tasks | Add evidence command golden fixtures and schema validation tests. | Each command has at least one success and one failure/non-passing fixture validated by tests. |
| [x] | `pr4b-verify` | `pr4b-fixtures-tests` | Validate PR 4B. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, and `git diff --check` pass; code-review, review-pr aspect agents, and rubber-duck report no material remaining comments. |

## PR 4C: Shared JSON contract type enforcement

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr4c-contract-types` | `pr4b-verify` | Finalize shared CLI JSON contract interfaces for migrated outputs. | `ICliJsonContract` requires top-level status, exposes typed issue/artifact links, and adds command-specific interfaces for the six agent-facing JSON outputs from the design inventory. |
| [x] | `pr4c-wire-assemblers` | `pr4c-contract-types` | Wire migrated JSON output assemblers through shared contract types. | Doctor, health, assess, GC audit, trace validate, and profile run result objects use `satisfies` against the shared command-specific interfaces at the sites that mint `schema_version`, without runtime builder wrappers or wire-shape changes. |
| [x] | `pr4c-status-docs` | `pr4c-wire-assemblers` | Update slug status and PR dependency docs. | The plan records PR 4C as the serial bridge between PR 4B and PR 5, and PR 5 depends on PR 4C before canonical skills parse the JSON contract. |
| [x] | `pr4c-verify` | `pr4c-status-docs` | Validate PR 4C. | `bun run check`, `bun run test:unit`, `bun run build`, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, and `git diff --check` pass; review-pr aspect agents and rubber-duck report no material remaining comments. |

## PR 5: Canonical shared skills and skill lint

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr5-skills-readme` | `pr4c-verify` | Add `skills/README.md`. | README documents canonical skill structure, invocation policies, safety rules, evidence citation, and review expectations. |
| [x] | `pr5-author-skills` | `pr5-skills-readme` | Author seven canonical skills under `skills/`. | `harness-quickstart`, `harness-doctor`, `harness-health`, `harness-assess`, `harness-evidence-loop`, `harness-gc-review`, and `harness-profile` exist with required frontmatter and sections. |
| [x] | `pr5-skill-safety-review` | `pr5-author-skills` | Check skill content against design boundaries. | Skills call CLI, prefer JSON where available, cite evidence, never edit `.harness/outputs/**`, and require approval for consequential commands; review-pr aspect agents and rubber-duck reported no material remaining comments. |
| [x] | `pr5-lint-skills` | `pr5-author-skills` | Implement `scripts/lint-skills.ts`. | High-confidence forbidden patterns, including `next_actions`, fail CI; narrow ignore markers require reasons; frontmatter, required sections, approved skill set, invocation policies, and known Harness command/subcommand examples are covered by tests. |
| [x] | `pr5-verify` | `pr5-lint-skills` | Validate PR 5. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, and `git diff --check` pass. |
| [x] | `pr5-skills-freeze` | `pr5-verify` | Freeze canonical skills before adapter work. | All seven canonical skill bodies and `skills/README.md` are reviewed and stable; no further skill body changes are planned before adapter packaging except through a deliberate follow-up that refreshes every packaged copy and hash. |

## PR 6: Adapter packaging base, parity checks, and Claude Code adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr6-parity-check` | `pr5-skills-freeze` | Implement copied skill parity checking. | `scripts/check-skill-parity.ts` validates canonical skill body hashes and `plugins/<host>/skill-hashes.json`, records the canonical SHA256 set, and documents the supported host metadata prelude normalization interface or the convergence-owner path for future prelude changes. |
| [x] | `pr6-hook-safety-check` | `pr5-skills-freeze` | Implement hook safety checking. | Hook checks fail on mutating filesystem APIs, `.harness/outputs/**` writes, child-process/dynamic execution, generated evidence paths, shell writes, and network commands. |
| [x] | `pr6-plugins-readme` | `pr6-parity-check` | Add shared plugin adapter documentation. | `plugins/README.md` documents parity, packaging, hook safety, normalization, and install evidence rules. |
| [x] | `pr6-claude-adapter` | `pr6-parity-check`, `pr6-hook-safety-check` | Implement Claude Code adapter. | Claude manifest, packaged skills, `skill-hashes.json`, README, and inert hook documentation exist; `claude plugin validate plugins/claude-code --strict` and `claude --plugin-dir plugins/claude-code plugin details harness-engineering` pass locally. |
| [!] | `pr6-claude-install-evidence` | `pr6-claude-adapter` | Capture Claude Code installation evidence. | Blocked on explicit approval for provider/model skill invocation smoke; README records local package validation, host CLI version, skill visibility, check date, and the remaining install/invocation evidence requirement without claiming marketplace or global installability. |
| [!] | `pr6-verify` | `pr6-claude-install-evidence` | Validate PR 6. | Deterministic validation passed (`bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `bun run check:skill-parity`, `bun run check:hook-safety`, `claude plugin validate plugins/claude-code --strict`, `claude --plugin-dir plugins/claude-code plugin details harness-engineering`, and `git diff --check`); full PR 6 verification remains blocked on Claude install/invocation smoke evidence with explicit approval. |

## PR 7A: OpenAI Codex adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr7a-codex-adapter` | `pr6-verify` | Implement Codex plugin package under `plugins/codex/**`. | Codex manifest, per-skill `agents/openai.yaml`, copied skills, hash manifest, inert hook docs, and README exist; implemented on the deterministic PR 6 base while full PR 6 provider/model invocation remains blocked by user decision. |
| [x] | `pr7a-codex-policy-map` | `pr7a-codex-adapter` | Map canonical invocation policies to Codex metadata. | Per-skill Codex `agents/openai.yaml` maps canonical `invocation_policy` to `allow_implicit_invocation`; `harness-health` is false and parity tests fail if the policy drifts, but host enforcement of this declaration remains unverified until smoke evidence proves implicit `harness-health` invocation is refused. |
| [!] | `pr7a-codex-install-evidence` | `pr7a-codex-adapter` | Capture Codex installation evidence. | README documents repo marketplace path, check date, host CLI version (`codex-cli 0.135.0`), reproducible single-temp-home marketplace add/install/list smoke showing `installed, enabled`, and current-auth live/model-backed explicit `harness-doctor` invocation output; interactive `/skills` visibility and negative `harness-health` implicit-invocation smoke remain unverified. |
| [!] | `pr7a-verify` | `pr7a-codex-install-evidence` | Validate PR 7A. | Deterministic validation passed (`bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `bun run check:skill-parity`, `bun run check:hook-safety`, `bun run check:plugin-manifests`, ownership diff from PR 6 base reviewed, and `git diff --check`); comprehensive code/docs/tests/security/types/simplify review plus rubber-duck converged with no material comments after tightening prelude, path/symlink, marketplace, and health-guidance checks; Codex repo-local marketplace install/list and live/model-backed explicit invocation smoke pass; full verification remains blocked on interactive `/skills` visibility, negative `harness-health` implicit-invocation smoke, and PR 6 full invocation evidence. |

## PR 7B: GitHub Copilot CLI adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr7b-copilot-adapter` | `pr6-verify` | Implement Copilot CLI plugin package under `plugins/copilot-cli/**`. | Copilot `plugin.json`, harness agent, copied skills, hash manifest, inert hook docs, and README exist; implemented on the deterministic PR 6 base while full PR 6 provider/model invocation remains blocked by user decision. |
| [x] | `pr7b-copilot-policy-map` | `pr7b-copilot-adapter` | Map canonical invocation policies to Copilot CLI capabilities. | README and `agents/harness.agent.md` document that Copilot policy parity is description/guidance-only for now and preserve explicit `harness-health` user intent guidance in the packaged skill description and agent routing guidance. |
| [x] | `pr7b-copilot-install-evidence` | `pr7b-copilot-adapter` | Capture Copilot CLI installation evidence. | README documents install command, smoke check, check date, host CLI version (`GitHub Copilot CLI 1.0.57-2`), same-temporary-home install/list output reporting seven installed skills and plugin visibility, current-auth live/model-backed installed-plugin `harness-doctor` invocation output, and cleanup of the temporary user install. |
| [x] | `pr7b-verify` | `pr7b-copilot-install-evidence` | Validate PR 7B. | Deterministic validation passed (`bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `bun run check:skill-parity`, `bun run check:hook-safety`, `bun run check:plugin-manifests`, same-temporary-home `copilot plugin install/list`, cleanup check, and `git diff --check`); comprehensive code/docs/tests/security/types/simplify review plus rubber-duck converged with no material comments after tightening prelude, path/symlink, manifest, and health-guidance checks; live/model-backed installed-plugin `harness-doctor` invocation passed; real-temp-project explicit and negative `harness-health` smoke passed for the repo-local adapter path. |

## PR 7C: Gemini CLI adapter

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr7c-gemini-adapter` | `pr6-verify` | Implement Gemini extension package under `plugins/gemini-cli/**`. | Gemini manifest, `GEMINI.md`, copied skills, hash manifest, and README exist; no commands, policies, MCP servers, settings, env vars, or executable hooks are shipped. |
| [x] | `pr7c-gemini-policy-map` | `pr7c-gemini-adapter` | Map canonical invocation policies to Gemini policy behavior. | README documents Gemini skill activation consent and that Gemini policy parity is description/guidance-only until host smoke evidence exists; packaged `harness-health` description and `GEMINI.md` preserve explicit user intent guidance. |
| [!] | `pr7c-gemini-install-evidence` | `pr7c-gemini-adapter` | Capture Gemini installation evidence. | README documents the manual install/link checklist, check date, host CLI unavailable on PATH, and no required settings/env vars; the concrete install/link command, full install output, skill visibility, and invocation output remain blocked because Gemini CLI is unavailable in this environment. |
| [!] | `pr7c-verify` | `pr7c-gemini-install-evidence` | Validate PR 7C. | Deterministic validation passed (`bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, `bun run check:skill-parity`, `bun run check:hook-safety`, `bun run check:plugin-manifests`, and `git diff --check`); comprehensive code/docs/tests/security/types/simplify review plus rubber-duck converged with no material comments after tightening prelude, path/symlink, manifest, and health-guidance checks; full Gemini install/invocation smoke remains blocked because Gemini CLI is unavailable and no provider/model skill invocation was approved. |

## PR 8: Adapter convergence and documentation cleanup

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [x] | `pr8-reconcile-adapters` | `pr7a-verify`, `pr7b-verify`, `pr7c-verify` | Reconcile adapter READMEs, manifests, hash manifests, and smoke evidence. | Host docs use consistent repo-local/package-validation terminology; Codex, Copilot CLI, and Gemini evidence boundaries remain explicitly scoped; `bun run check:skill-parity`, `bun run check:hook-safety`, and `bun run check:plugin-manifests` pass. |
| [x] | `pr8-update-public-docs` | `pr8-reconcile-adapters` | Update public docs for shipped adapter paths only. | README, quickstart, architecture, and development docs describe repo-local host adapter packages directly and do not promise unverified public marketplace/global installability. |
| [x] | `pr8-stale-wording-search` | `pr8-update-public-docs` | Search for stale or forbidden wording. | Exact PR 8 stale searches were run. Remaining matches are approved exceptions: AGENTS/schema text forbids or scopes provider-backed evidence rather than promising a runner, and skill-lint tests/README intentionally contain `next_actions` and `"success"` as forbidden-pattern fixtures. |
| [x] | `pr8-final-validation` | `pr8-stale-wording-search` | Run final validation. | `bun run check`, `bun run test:unit`, `bun run build`, `bun run test:e2e`, adapter checks, `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`, both PR 8 `rg` commands from `pr8-stale-wording-search`, and `git diff --check` pass. |

## Parallel execution checklist

Historical parallelization note: the approved implementation proceeded in one
worktree with a convergence-owner shared-script update because PR 6 full host
invocation evidence remained blocked by user decision. These parallel fan-out
items are retained as the original alternative plan and are not current execution
state; their pending markers mean "not executed in this historical alternative,"
not remaining PR 8 work.

| Status | ID | Depends on | Task | Done when |
|---|---|---|---|---|
| [ ] | `parallel-base-freeze` | `pr6-verify` | Freeze the base before fan-out. | Canonical skills, parity scripts, hook safety scripts, `plugins/README.md`, and Claude adapter pattern are stable; frozen PR 6 commit SHA and convergence owner are recorded in `plans/agent-cli-plugin-architecture/parallel-freeze.md`. |
| [ ] | `parallel-create-codex-worktree` | `parallel-base-freeze` | Create Codex branch/worktree. | Branch `agent-cli/codex-adapter` and worktree `../harness-agent-cli-codex` are based on the frozen base. |
| [ ] | `parallel-create-copilot-worktree` | `parallel-base-freeze` | Create Copilot branch/worktree. | Branch `agent-cli/copilot-adapter` and worktree `../harness-agent-cli-copilot` are based on the frozen base. |
| [ ] | `parallel-create-gemini-worktree` | `parallel-base-freeze` | Create Gemini branch/worktree. | Branch `agent-cli/gemini-adapter` and worktree `../harness-agent-cli-gemini` are based on the frozen base. |
| [ ] | `parallel-enforce-ownership` | Parallel worktrees | Keep each adapter inside its owned paths. | Each branch proves `git diff --name-only <frozen-base>...HEAD` only touches its owned `plugins/<host>/**` path; any shared-path edit has written convergence-owner approval before commit. If a frozen shared path must change, fan-out pauses, all packaged skill copies/hashes are refreshed when relevant, a new frozen SHA is recorded, and branches rebase before continuing. |
| [ ] | `parallel-merge-convergence` | PR 7A/7B/7C | Merge adapter branches and run convergence PR. | Host branches merge after ownership and smoke evidence checks; PR 8 then resolves shared docs/scripts and runs final validation. |

## Global guardrails

- Do not weaken `biome.json`.
- Do not add MCP tools or MCP product semantics.
- Do not add plugin-only, skill-only, CI-only, or profile-only source-of-truth state.
- Do not add live model/provider execution without a separately approved substrate contract, credentials, budgets, and trust boundaries.
- Do not manually edit `.harness/outputs/**`.
- Do not promise installability through a host marketplace without working host evidence.
- Do not copy roadmap/phase wording into public docs, code, schemas, examples, fixtures, or tests.
