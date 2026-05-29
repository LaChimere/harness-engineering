# Canonical Harness skills

Canonical skills are the only authored skill workflows in this repository. Host adapters may package or reference these files, but they must not fork their bodies or create host-specific product rules.

## Canonical skill structure

Each skill lives at `skills/<id>/SKILL.md` and must start with YAML frontmatter:

```yaml
---
id: harness-doctor
purpose: Run and interpret harness doctor structural inspection
invocation_policy: user-or-model
version: 1.0.0
---
```

Required frontmatter keys are `id`, `purpose`, `invocation_policy`, and `version`. `requires_approval: true` is required when the skill needs explicit user intent before execution. Required sections are `## Purpose`, `## Invocation`, `## Steps`, and `## Safety`.

## Invocation policies

`user-or-model` means the host agent may invoke the skill when the user request or CLI evidence makes it relevant. `explicit-user-intent` means the user must explicitly ask for the workflow before the agent runs it. `harness-health` uses `explicit-user-intent` because it executes declared local commands.

Every skill must still stop and get user approval before commands that execute local checks, mutate files, or trigger provider/model spend.

## Safety rules

Skills call the deterministic `harness` CLI and prefer JSON output when a command offers it. Some validation commands return human-readable summaries; skills must cite their command output and artifact paths instead of inventing JSON. Skills must not infer harness state from chat, hand-edit generated evidence, call provider/model APIs directly, create host-specific source-of-truth state, or invent aggregate commands. Use `harness doctor --format json` for agent-facing structural inspection; `harness validate` remains human-facing.

`harness-evidence-loop` is prompt-level orchestration over existing explicit commands. It sequences commands and stops before unsafe execution; it does not require a new aggregate command.

## Evidence citation

When reporting results, cite the command that produced the evidence, the JSON `status` when available, relevant `issues` or domain-specific detail arrays, and artifact paths when the CLI output includes them. Keep command-specific details canonical: doctor uses `checks`, health uses check details, assess uses scorecard/recommendations, GC uses `findings`, trace validation uses per-trace issues, and profile uses `handoff`.

## Lint rules

Run `bun run lint:skills` or `bun run test:unit` after editing skills. The linter checks the approved skill set, required frontmatter, required sections, invocation policy expectations, known Harness commands, and high-confidence forbidden patterns such as generated-output shell writes, direct model calls, `next_actions`, and universal `"success"` fields.

If a future skill must show a forbidden literal, place a narrow ignore marker on the line immediately before the literal:

```markdown
<!-- harness-skill-lint-ignore next-actions: quoted external field name -->
```

The marker applies only to the next line and must include a reason.
