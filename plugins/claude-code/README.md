# Claude Code adapter

This adapter packages the canonical Harness skills for Claude Code. The packaged copies are checked by `bun run check:skill-parity`; edit `skills/<id>/SKILL.md` first, then refresh packaged copies and `skill-hashes.json`.

## Invocation policy translation

| Canonical policy | Claude Code metadata |
|---|---|
| `user-or-model` | no extra host restriction |
| `explicit-user-intent` | `disable-model-invocation: true` in the Claude skill prelude |

`harness-health` uses `explicit-user-intent` because it can execute local commands through `harness health`.

## Validation evidence

The adapter has local package validation evidence, not marketplace evidence.

| Check | Evidence |
|---|---|
| Host CLI version | `claude --version` -> `2.1.145 (Claude Code)` |
| Plugin manifest validation | `claude plugin validate plugins/claude-code --strict` |
| Skill visibility | `claude --plugin-dir plugins/claude-code plugin details harness-engineering` lists 7 skills: `harness-assess`, `harness-doctor`, `harness-evidence-loop`, `harness-gc-review`, `harness-health`, `harness-profile`, `harness-quickstart` |
| Skill parity | `bun run check:skill-parity` |
| Hook safety | `bun run check:hook-safety` |
| Check date | 2026-05-29 |

## Installation and invocation smoke

Marketplace or global installation is not claimed in this repository. Before claiming host installability, capture real evidence for:

1. install command output,
2. host CLI version,
3. skill visibility output,
4. one skill invocation smoke result,
5. check date.

Skill invocation smoke is also pending because invoking a Claude Code skill requires provider/model execution. Run it only with explicit approval and a bounded budget. Until that evidence exists, this adapter is a validated local package layout only.
