# Plan: Agent CLI plugin architecture implementation

## Status

Gate 1 design is approved. This plan translates the approved `design.md` into an implementation sequence and explicit parallelization boundaries. Do not start executable implementation work until Gate 2 approval.

## Feature summary

Implement Harness Engineering's agent CLI integration as a CLI-first, schema-backed substrate with canonical shared skills and thin host adapters for Claude Code, OpenAI Codex, GitHub Copilot CLI, and Gemini CLI.

Main constraints:

- `harness.yaml`, versioned schemas, and deterministic `harness` CLI evidence remain the source of truth.
- Skills, plugins, hooks, CI recipes, and host manifests are adapters only; they must not define product rules or hold independent state.
- MCP is out of scope for this slug and must not define product semantics.
- Runner/model surfaces that imply Harness owns model execution must be removed or renamed before skills/plugins ship.
- CLI JSON contract changes must be inventory-driven and schema-backed; no universal `success` flag and no CLI-emitted `next_actions`.
- Marketplace/installability claims require host-specific installation evidence.
- Public docs, code, schemas, examples, fixtures, and tests must not inherit roadmap/phase wording.

This split is chosen because the work has strict contract dependencies: naming cleanup must remove current lint blockers before behavior cleanup; runner/model cleanup must land before JSON contract hardening; JSON contract hardening must stabilize before skills; canonical skills and parity checks must exist before host adapters can safely fan out.

## PR sequence

### PR 1: Biome naming cleanup plan and rename-only interface slices

Goal: Bring current TypeScript naming into compliance with the already-enforced Biome naming rules so `bun run check` passes, without changing runtime behavior.

Likely directories/files:

- `src/**/*.ts`
- `tests/**/*.ts`
- `plans/agent-cli-plugin-architecture/interface-rename-plan.md`

Dependencies: Gate 2 approval.

Allowed changes:

- Generate `interface-rename-plan.md` from `bun biome lint --reporter=json` `useNamingConvention` interface violations.
- Rename non-`I`-prefixed interfaces to `I*` names.
- Update imports, exports, and type references required by those renames.
- Preserve external JSON/evidence field names that intentionally use snake_case or CONSTANT_CASE by representing them with computed literal property keys in TypeScript.
- Rename non-conforming type parameters to `T*` names.
- Split into small domain slices when the generated inventory is large.

Prohibited changes:

- Runtime behavior changes.
- Schema shape changes.
- Runner/model cleanup.
- CLI JSON contract changes.
- `biome.json` weakening or rule removal.

Acceptance criteria:

- `interface-rename-plan.md` lists every non-conforming interface, target name, affected files, slice ID, and slice rationale.
- Each slice diff is rename-only and reviewer-verifiable.
- External JSON/evidence field names retain their emitted wire shape; only their TypeScript syntax changes to satisfy Biome.
- The external-key convention is documented with a reviewer-verifiable inventory command so future slices do not reintroduce bare snake_case/CONSTANT_CASE properties.
- No remaining `useNamingConvention` diagnostics block the configured Biome check.
- The final inventory is proven by rerunning `bun biome lint --reporter=json` and confirming there are no remaining `useNamingConvention` diagnostics.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `git diff --check`

Mergeability notes: This PR must land before runner/model cleanup so later behavioral diffs do not mix with unrelated lint repair.

### PR 2: Runner/model cleanup inventory and removal

Goal: Remove or rename product surfaces that imply Harness owns model execution or agent runners.

Likely directories/files:

- `src/commands/run*.ts`
- `src/commands/runner*.ts`
- `src/lib/agent-runner.ts`
- `src/lib/runner-readiness.ts`
- `schemas/model-profile.schema.json`
- `schemas/agent-runner.schema.json`
- `schemas/runner-readiness.schema.json`
- `schemas/harness.schema.json`
- `schemas/trace.schema.json`
- `schemas/profile-run.schema.json`
- `examples/**`
- `.harness/**`
- `README.md`
- `docs/**`
- `tests/**`
- `plans/agent-cli-plugin-architecture/design.md`

Dependencies: PR 1.

Allowed changes:

- Expand the cleanup inventory in `design.md` with audited paths, current purpose, target fate, tests, and docs.
- Delete runner/model schemas, libraries, commands, examples, fixtures, and tests when they represent Harness-owned model execution.
- Remove `model_profiles` and `agent_runners` from default user substrate and `harness init`.
- Update trace/profile schema descriptions so `environment_snapshot.runner` and `environment_snapshot.model_profile` are read-only imported provenance.
- Preserve `harness profile run`, `harness trace validate`, and `harness eval` as evidence consumers/verifiers.
- Limit `design.md` edits to the cleanup inventory table; do not reopen the approved scope, principles, or architecture decisions in this implementation PR.

Prohibited changes:

- New evidence-import command surfaces.
- New provider-backed or live model runner behavior.
- Skill or host adapter implementation.
- JSON contract normalization beyond what is required to keep cleanup coherent.
- Behavioral edits to `harness verify` or `harness eval` beyond import/type fixups required by runner/model removal.

Acceptance criteria:

- `harness run` and `harness runner` command surfaces are deleted or renamed out of model-execution semantics as approved by the inventory.
- `src/lib/agent-runner.ts` and `src/lib/runner-readiness.ts` are deleted if the inventory confirms no retained non-runner responsibility.
- `harness init` no longer emits `model_profiles`, `agent_runners`, `.harness/model-profiles/**`, or `.harness/agent-runners/**`.
- No public docs present runner/model execution as a supported product boundary.
- Trace/profile provenance fields are retained but documented as imported metadata, not Harness-configured execution.
- `harness verify` and `harness eval` behavior remains intact unless the inventory identifies a runner/model-only reference that must be removed.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `bun run test:e2e`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`
- `rg -n "(model_profiles|agent_runners|model-profile|agent-runner|runner-readiness|\\bharness runner\\b|\\bharness run\\b|live-runner|provider-backed|deterministic stub runner)" README.md AGENTS.md docs src schemas examples tests`
- Public-doc boundary search over `README.md`, `docs/guides/**`, and `docs/dev/**`; any remaining runner/model term must be an explicitly documented approved exception in the cleanup inventory.

Mergeability notes: This PR is intentionally serial because it touches shared config, schemas, examples, docs, tests, and command surfaces.

### PR 3: CLI JSON migration plan and shared contract base

Goal: Turn the approved JSON inventory into a committed migration plan and base contract types before command behavior changes.

Likely directories/files:

- `plans/agent-cli-plugin-architecture/cli-json-migration.md`
- `plans/agent-cli-plugin-architecture/design.md`
- `src/lib/**`
- `schemas/**`
- `tests/**`

Dependencies: PR 2.

Allowed changes:

- Rerun each agent-facing command with `--format json` against fixture data or test `harness.yaml` configs: `doctor`, `health`, `assess`, `gc audit`, `trace validate`, and `profile run`.
- Update only the current-state inventory table if actual output differs from `design.md`; do not reopen the approved scope, principles, or architecture decisions.
- Create `cli-json-migration.md` with per-schema field additions, renames, moves, schema version bumps, status semantics, and the clean pre-release migration strategy.
- Add shared TypeScript contract scaffolding such as `ICliJsonContract`, `ICliJsonIssue`, and `ICliJsonArtifact` if it can be introduced without changing command output behavior.
- Add schema/test scaffolding that does not force incomplete command migrations.

Prohibited changes:

- Changing command JSON output before `cli-json-migration.md` is committed.
- Adding a universal `success` flag.
- Adding `next_actions`.
- Collapsing command-specific details such as doctor `checks`, health check details, GC `findings`, trace actions, or profile `handoff` into generic issues.

Acceptance criteria:

- `cli-json-migration.md` exists and is derived from actual command output inventory.
- The migration plan covers doctor, health, assess, GC audit, trace validate, and profile run.
- The plan explicitly documents `errors`/string issue migration to structured `issues`.
- Per-command status semantics are documented for skill authors.
- Provenance normalization is documented with any intentional deferrals justified by domain clarity, not compatibility with old command-result shapes.
- The clean-break strategy is explicitly scoped to removing old command-result compatibility shims; command-result schema changes still have previewable evidence through the migration plan, golden fixtures, and schema validation, and any persisted harness/schema upgrade path still requires `harness migrate` evidence.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `git diff --check`

Mergeability notes: This is a base PR for JSON hardening. It should be small enough to review before command migrations begin.

### PR 4A: Structural command JSON hardening

Goal: Apply the migration plan to structural agent-facing commands.

Likely directories/files:

- `src/commands/doctor.ts`
- `src/commands/health.ts`
- `src/commands/assess.ts`
- `src/lib/doctor*.ts`
- `src/lib/health*.ts`
- `src/lib/assessment.ts`
- `schemas/doctor-result.schema.json`
- `schemas/health-result.schema.json`
- `schemas/assessment.schema.json`
- `tests/**`
- `examples/fixtures/**`

Dependencies: PR 3.

Allowed changes:

- Add or update schema-backed `schema_version`, `generated_at`, `harness_version`, `issues`, and status semantics only as described in `cli-json-migration.md`.
- Keep doctor `checks`, health per-check details, and assessment `missing_primitives` / `recommendations` as domain-canonical details.
- Add golden fixtures covering success and failure cases for these commands.
- Validate JSON output against schemas in tests.

Prohibited changes:

- Skill or host adapter authoring.
- New workflow decision fields.
- Hidden migration behavior not documented in `cli-json-migration.md`.
- Emitting old and new command-result fields in parallel, such as `cli_version` with `harness_version` or legacy `errors` with structured `issues`, as a transitional shape.

Acceptance criteria:

- Doctor, health, and assess JSON outputs validate against their schemas.
- Structured `issues` exist only where the migration plan requires them.
- Existing domain-specific details remain available and canonical.
- Renamed legacy command-result fields such as `cli_version` to `harness_version` and string `errors` to structured `issues` are replaced cleanly in the same pre-release migration; no dual-field transitional support or back-compat regression assertions against the pre-migration command-result shape are required.
- Tests cover at least one success and one failure/non-passing output per command.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`

Mergeability notes: This PR is serial within the CLI JSON hardening workstream. PR 4B must wait for this PR to merge and verify, then rebase on it before evidence-command JSON changes begin.

### PR 4B: Evidence command JSON hardening

Goal: Apply the migration plan to evidence/audit agent-facing commands.

Likely directories/files:

- `src/commands/gc.ts`
- `src/commands/trace.ts`
- `src/commands/profile.ts`
- `src/lib/gc.ts`
- `src/lib/profile.ts`
- `schemas/gc-evidence.schema.json`
- `schemas/trace.schema.json`
- `schemas/trace-validate-result.schema.json`
- `schemas/profile-run.schema.json`
- `tests/**`
- `examples/fixtures/**`

Dependencies: PR 4A.

Allowed changes:

- Add GC audit top-level status and optional command-level `issues` while keeping `findings` separate.
- Add `schemas/trace-validate-result.schema.json` for `harness trace validate --format json` command-result output.
- Map trace validation string issues to structured `ICliJsonIssue` objects at the command-result layer.
- Add profile top-level status mirroring `handoff.status`.
- Map `profile-run.errors[]` to structured `issues[]` according to the migration plan.
- Add golden fixtures covering success and failure cases for these commands.

Prohibited changes:

- Treating `schemas/trace.schema.json` as the schema for trace validation command output.
- Reclassifying GC cleanup findings as command failures.
- Keeping legacy command-result `errors` solely to preserve pre-migration output compatibility. Action-local domain errors inside trace artifacts may remain if `cli-json-migration.md` keeps them as trace-specific detail.

Acceptance criteria:

- GC audit, trace validate, and profile run JSON outputs validate against their schemas or dedicated command-result schemas.
- GC `findings` and command `issues` remain semantically separate.
- Trace artifacts and trace validation command output have distinct schema coverage: `schemas/trace.schema.json` remains the trace artifact schema, and `schemas/trace-validate-result.schema.json` is the command-result schema.
- Profile `handoff` remains canonical while top-level status supports shared parsing.
- Renamed legacy command-result fields and migrated error/issue shapes are replaced cleanly in the same pre-release migration; no dual-field transitional support or back-compat regression assertions against the pre-migration command-result shape are required.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`

Mergeability notes: This PR starts only after PR 4A is merged and verified. It may reuse shared contract/test helpers from PR 4A but must not revise them beyond the frozen `cli-json-migration.md` without a focused follow-up plan.

### PR 5: Canonical shared skills and skill lint

Goal: Author the canonical host-agnostic skill set against the stabilized CLI JSON contract.

Likely directories/files:

- `skills/README.md`
- `skills/harness-quickstart/SKILL.md`
- `skills/harness-doctor/SKILL.md`
- `skills/harness-health/SKILL.md`
- `skills/harness-assess/SKILL.md`
- `skills/harness-evidence-loop/SKILL.md`
- `skills/harness-gc-review/SKILL.md`
- `skills/harness-profile/SKILL.md`
- `scripts/lint-skills.ts`
- `package.json`
- `tests/**`

Dependencies: PR 4A and PR 4B.

Allowed changes:

- Add canonical skill docs with required frontmatter and required sections.
- Ensure skills call `harness` CLI, prefer JSON output, cite evidence, and never edit `.harness/outputs/**`.
- Require explicit user approval for local checks, mutating commands, and provider/model spend.
- Implement high-confidence skill lint patterns from `design.md`.
- Document skill authoring rules in `skills/README.md`.

Prohibited changes:

- Host-specific skill forks.
- Skill-only product rules.
- Agent-facing `harness validate` skill.
- Batch evidence import skill.
- Manual generated evidence manipulation instructions.

Acceptance criteria:

- All seven canonical skills exist and match the approved structure.
- `harness-health` and other consequential workflows require explicit user intent.
- `harness-evidence-loop` sequences explicit commands and does not require a new aggregate `harness loop run` command.
- Skill lint fails on the high-confidence forbidden patterns, including `next_actions`, and supports narrow ignore markers with reasons.
- Canonical skill bodies and `skills/README.md` are reviewed and frozen before adapter packaging starts; later skill body changes require a deliberate follow-up that refreshes every packaged copy and hash.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `git diff --check`

Mergeability notes: This PR must wait until CLI JSON outputs are stable enough for skills to parse consistently.

### PR 6: Adapter packaging base, parity checks, and Claude Code adapter

Goal: Prove the host adapter pattern with Claude Code before parallelizing other hosts.

Likely directories/files:

- `plugins/README.md`
- `plugins/claude-code/**`
- `scripts/check-skill-parity.ts`
- `scripts/check-hook-safety.ts`
- `package.json`
- `tests/**`

Dependencies: PR 5 and the canonical skill freeze.

Allowed changes:

- Implement copied skill packaging plus `plugins/claude-code/skill-hashes.json`.
- Add parity checking for packaged host skills.
- Add hook safety checking for read-only host hooks.
- Add Claude Code manifest, packaged canonical skills, optional read-only reviewer agent, and optional reminder hooks.
- Document Claude Code installation and invocation policy translation.
- Integrate parity/hook checks into `bun run test:unit`.

Prohibited changes:

- Symlinks as release/evidence format.
- Host-specific skill body forks.
- Hook child processes or filesystem writes.
- Marketplace claims without installation evidence.

Acceptance criteria:

- Claude adapter installs by a documented, verified path.
- Packaged skill bodies match canonical `skills/**` after declared metadata normalization.
- `skill-hashes.json` drift fails CI.
- Hook safety check forbids writes, `.harness/outputs/**` writes, and child-process execution.
- The parity script records the canonical SHA256 set used to seed packaged host `skill-hashes.json` files, and it either supports a documented host metadata prelude normalization interface or states that any new prelude format after PR 6 must be handled through a convergence-owner shared-path change.
- `bun run test:unit` proves parity and hook safety are integrated by failing in local negative-control checks: temporarily corrupt one packaged skill or hash, then temporarily add a forbidden hook pattern such as `fs.writeFileSync`, confirm test failure, and revert both throwaway mutations before commit.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- Claude Code manual or automated install smoke check documented in `plugins/claude-code/README.md`; evidence includes install command output, skill visibility output, one skill invocation output, check date, and host CLI version.
- `git diff --check`

Mergeability notes: This PR is the base prerequisite for host adapter fan-out.

### PR 7A: OpenAI Codex adapter

Goal: Package the canonical skills for OpenAI Codex with Codex-native metadata and installation evidence.

Likely directories/files:

- `plugins/codex/**`

Dependencies: PR 6.

Allowed changes:

- Add `.codex-plugin/plugin.json`, `agents/openai.yaml`, copied skills, `skill-hashes.json`, optional read-only hook, and README.
- Map canonical invocation policies to Codex metadata such as `allow_implicit_invocation`.
- Document repo-scoped or user-scoped marketplace installation evidence.

Prohibited changes:

- Canonical `skills/**` edits.
- Shared parity script edits, including new host metadata prelude normalization, unless coordinated through the convergence owner before commit.
- Public marketplace claims unless upstream self-serve publishing is re-verified and documented.

Acceptance criteria:

- Codex adapter package passes parity and hook safety checks.
- README documents the installation path used, host CLI/version/date, skill visibility check, and one skill invocation smoke check.

Validation commands:

- `bun run check`
- `bun run test:unit`
- Codex install smoke check when available; otherwise documented manual evidence
- `git diff --check`

Mergeability notes: Can fan out with PR 7B and PR 7C after PR 6.

### PR 7B: GitHub Copilot CLI adapter

Goal: Package the canonical skills for GitHub Copilot CLI with Copilot-native plugin metadata and installation evidence.

Likely directories/files:

- `plugins/copilot-cli/**`

Dependencies: PR 6.

Allowed changes:

- Add `plugin.json`, `agents/harness.agent.md`, copied skills, `skill-hashes.json`, optional hooks, and README.
- Map canonical invocation policies to Copilot CLI capabilities and document any manual enforcement gaps.
- Document GitHub repository/subdirectory installation evidence.

Prohibited changes:

- Canonical `skills/**` edits.
- Shared parity script edits, including new host metadata prelude normalization, unless coordinated through the convergence owner before commit.
- Treating GitHub Actions as the in-agent plugin surface.

Acceptance criteria:

- Copilot CLI adapter package passes parity and hook safety checks.
- README documents install command, skill visibility, and one skill invocation smoke check.

Validation commands:

- `bun run check`
- `bun run test:unit`
- Copilot CLI install smoke check when available; otherwise documented manual evidence
- `git diff --check`

Mergeability notes: Can fan out with PR 7A and PR 7C after PR 6.

### PR 7C: Gemini CLI adapter

Goal: Package the canonical skills for Gemini CLI with Gemini-native extension metadata and installation evidence.

Likely directories/files:

- `plugins/gemini-cli/**`

Dependencies: PR 6.

Allowed changes:

- Add `gemini-extension.json`, `GEMINI.md`, copied skills, `skill-hashes.json`, optional commands, optional policies, and README.
- Declare required extension settings or environment variables explicitly.
- Map canonical invocation policies to Gemini policy behavior.

Prohibited changes:

- Canonical `skills/**` edits.
- Shared parity script edits, including new host metadata prelude normalization, unless coordinated through the convergence owner before commit.
- Hidden shell environment assumptions.

Acceptance criteria:

- Gemini adapter package passes parity and hook safety checks.
- README documents install/link command, skill visibility or equivalent discovery, and one skill invocation smoke check.
- Required settings/env vars are declared, not assumed.

Validation commands:

- `bun run check`
- `bun run test:unit`
- Gemini extension install/link smoke check when available; otherwise documented manual evidence
- `git diff --check`

Mergeability notes: Can fan out with PR 7A and PR 7B after PR 6.

### PR 8: Adapter convergence and documentation cleanup

Goal: Reconcile host adapter branches, verify all installation evidence, and remove stale public wording.

Likely directories/files:

- `plugins/**`
- `skills/**`
- `README.md`
- `docs/guides/**`
- `docs/dev/**`
- `plans/agent-cli-plugin-architecture/**`
- `package.json`
- `tests/**`

Dependencies: PR 7A, PR 7B, and PR 7C.

Allowed changes:

- Resolve host adapter README consistency.
- Add final cross-host checks if needed.
- Update user-facing docs to describe shipped adapter install paths only where evidence exists.
- Keep planned or unverified marketplace paths clearly labeled as not yet shipped.
- Remove stale runner/model, skill-first, or plugin-source-of-truth language.

Prohibited changes:

- New host adapters.
- New canonical skill workflows.
- Marketplace/installability promises without evidence.
- Roadmap/phase wording outside planning artifacts.

Acceptance criteria:

- All host adapters pass parity checks.
- All host hook files pass safety checks.
- Each host README contains installation evidence with check date and host CLI version.
- Public docs describe current capabilities directly and keep unshipped paths clearly labeled.
- No stale references contradict the source-of-truth boundaries in `design.md`.

Validation commands:

- `bun run check`
- `bun run test:unit`
- `bun run build`
- `bun run test:e2e`
- `PYTHONPATH="${HARNESS_SCHEMA_VALIDATION_DEPS:-.harness/schema-validation-deps}" python3 examples/fixtures/validate.py`
- `git diff --check`
- `rg -n "(model_profiles|agent_runners|model-profile|agent-runner|runner-readiness|\\bharness runner\\b|\\bharness run\\b|live-runner|provider-backed|deterministic stub runner|MCP tool|MCP server|marketplace installability|Phase [0-9]|Stage [0-9])" README.md AGENTS.md docs src schemas examples tests`
- `rg -n "(next_actions|\"success\"[[:space:]]*:)" src schemas examples tests skills plugins README.md AGENTS.md docs`
- Any remaining search match is either removed or recorded as an approved exception with rationale in the convergence PR.

Mergeability notes: This is the convergence PR. It should be owned by one person/agent to avoid reintroducing cross-host drift.

## Parallelization readiness

Must stay serial:

1. PR 1 interface naming cleanup.
2. PR 2 runner/model cleanup.
3. PR 3 CLI JSON migration plan and shared contract base.
4. PR 4A depends on PR 3; PR 4B depends on the merged and verified PR 4A. The JSON hardening PRs are intentionally serial because tests, schemas, and shared contract helpers are conflict hotspots.
5. PR 5 canonical shared skills.
6. PR 6 parity/check infrastructure and Claude Code adapter.
7. PR 8 convergence.

Can fan out after PR 6:

- PR 7A OpenAI Codex adapter.
- PR 7B GitHub Copilot CLI adapter.
- PR 7C Gemini CLI adapter.

This is readiness guidance. The explicit ownership plan below defines safe branch, worktree, and path boundaries.

## Parallel execution plan

### Base prerequisite

Name: `agent-cli-plugin-base`

Why serial: Host adapters depend on stabilized CLI JSON behavior, canonical skill bodies, parity checking, hook safety checking, and one proven adapter packaging pattern.

Must stabilize first:

- PR 1 through PR 6 merged or frozen.
- `skills/**` canonical skill content frozen.
- `scripts/check-skill-parity.ts` and `scripts/check-hook-safety.ts` stable.
- `plugins/README.md` host adapter rules stable.
- Claude Code adapter validates the packaging and install-evidence pattern.

### Parallel task table

| Task | Branch | Worktree | Owns | Must not touch | Depends on | Validation |
|---|---|---|---|---|---|---|
| OpenAI Codex adapter | `agent-cli/codex-adapter` | `../harness-agent-cli-codex` | `plugins/codex/**` | `skills/**`, `src/**`, `schemas/**`, `scripts/**`, `plugins/README.md`, `plugins/claude-code/**`, `plugins/copilot-cli/**`, `plugins/gemini-cli/**`, `package.json`, `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `tests/**`, root docs except approved README links | PR 6 | `bun run check`, `bun run test:unit`, ownership diff check from frozen base, Codex smoke evidence or documented manual checklist, `git diff --check` |
| GitHub Copilot CLI adapter | `agent-cli/copilot-adapter` | `../harness-agent-cli-copilot` | `plugins/copilot-cli/**` | `skills/**`, `src/**`, `schemas/**`, `scripts/**`, `plugins/README.md`, `plugins/claude-code/**`, `plugins/codex/**`, `plugins/gemini-cli/**`, `package.json`, `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `tests/**`, root docs except approved README links | PR 6 | `bun run check`, `bun run test:unit`, ownership diff check from frozen base, Copilot CLI smoke evidence or documented manual checklist, `git diff --check` |
| Gemini CLI adapter | `agent-cli/gemini-adapter` | `../harness-agent-cli-gemini` | `plugins/gemini-cli/**` | `skills/**`, `src/**`, `schemas/**`, `scripts/**`, `plugins/README.md`, `plugins/claude-code/**`, `plugins/codex/**`, `plugins/copilot-cli/**`, `package.json`, `bun.lock`, `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `tests/**`, root docs except approved README links | PR 6 | `bun run check`, `bun run test:unit`, ownership diff check from frozen base, Gemini install/link smoke evidence or documented manual checklist, `git diff --check` |

### Merge strategy

Rebase order:

1. Record the merged PR 6 commit SHA and convergence owner in `plans/agent-cli-plugin-architecture/parallel-freeze.md` before any fan-out branch starts.
2. Rebase each fan-out branch on the frozen PR 6 base.
3. Before each host branch merges, prove `git diff --name-only <frozen-base>...HEAD` only touches the owned `plugins/<host>/**` path unless the convergence owner has explicitly approved a shared-path edit in writing.
4. Merge Codex, Copilot, and Gemini branches in any order if they respect ownership boundaries and pass their smoke evidence checks.
5. Run PR 8 as the convergence branch after all host branches merge.

If a canonical skill body, parity script, hook safety script, or other shared path must change after the PR 6 freeze, the convergence owner pauses host fan-out, lands the shared fix in a serial branch, refreshes every packaged skill copy and hash, records the new frozen SHA, and has each host branch rebase before continuing.

Conflict hotspots:

- `plugins/README.md`
- `package.json`
- `tests/**`
- `scripts/check-skill-parity.ts`
- `scripts/check-hook-safety.ts`
- root `README.md`
- `docs/**`

Convergence owner: Assigned at the PR 6 base freeze and carried into PR 8. This owner arbitrates any requested shared-path edits during PR 7A/7B/7C before those edits are committed.

Final cleanup owner: PR 8 owner.

## Risks

- Contract churn: mitigated by PR 3 `cli-json-migration.md` and schema-backed tests before skills.
- Migration hazards: mitigated by inventory-driven clean schema migrations and same-PR updates to first-party code, fixtures, tests, and docs.
- Conflict hotspots: mitigated by keeping shared scripts/docs serial and host adapters directory-owned.
- Over-design: mitigated by refusing MCP, `next_actions`, universal `success`, host-forked skills, and unproven marketplace claims.
- Rollback: each PR is independently mergeable; host adapter PRs can be reverted independently if installation evidence fails without reverting the CLI contract or canonical skills.

## Gate 2 approval criteria

Gate 2 can approve implementation when reviewers agree that:

- This PR sequence matches `design.md`.
- Parallel work is limited to host adapter directories after the base is stable.
- Every PR has explicit allowed/prohibited changes and validation commands.
- No implementation step creates plugin-only, skill-only, CI-only, or profile-only source-of-truth state.
