# Lessons: Harness Engineering Platform

This file records historical process corrections for the slug. `design.md`, `plan.md`, and `todo.md` remain the execution source of truth.

## Stage 8 target correction

- When Stage 8 says "marketplace plugin", interpret the first target as a coding-agent or CLI marketplace surface such as Codex, Claude Code, GitHub Copilot CLI, or a comparable agent marketplace.
- IDE-only extension hosts can be researched as future adapter evidence, but they are out of scope for the corrected Stage 8/9 target.
- Before implementing a plugin adapter, confirm that the selected target matches the product direction, not merely that it has the richest generic extension APIs.
- Grade Stage 8 hosts by capability tier. A limited command/skill/MCP adapter can be useful, but it must not be presented as full plugin UX.
- Do not let plugin-first outrun the CLI substrate. Marketplace adapters depend on a published, versioned, boring CLI or an explicitly documented bootstrap path.
- Treat "marketplace" broadly enough for agent/CLI ecosystems: command/hook discovery, MCP registries, and skill-pack mechanisms can support limited adapters, but general IDE extension stores remain out of scope for this corrected Stage 8/9 target.

## Design drift failure

- The failed Stage 8 attempt selected VS Code because it was the easiest rich extension host to implement, not because it matched the intended user entrypoint. Implementation convenience must never override the approved product direction.
- "Host marketplace" must not be silently broadened to "any extension marketplace." For this roadmap, the relevant host is where users run coding agents, not a general IDE extension surface.
- Stage 8 is a feasibility gate, not a target-selection shortcut. If the intended agent/CLI marketplace surfaces are not ready, the correct outcome is CLI-first fallback or limited-adapter scope, not switching to an unrelated host.
- Stage 8 must reconcile its capability result with the user journey. A limited adapter must not be shipped under the full-plugin north-star story; either rewrite the journey to the proven limited workflow or label the full-plugin journey aspirational.
- Any change from agent/CLI marketplace-first to IDE-first is a design change across Gate 1/2 boundaries. Stop, update the slug, explain the tradeoff, and get explicit user approval before implementation.
- When a user has already asked "how will users use this?", preserve that answer as a constraint: CLI-first is the current substrate; agent/CLI marketplace plugin-first is the north star; skills and CI are adapters. Do not re-rank those entrypoints without approval.
