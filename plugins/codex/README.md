# Codex adapter

This directory packages the canonical Harness skills for Codex plugin distribution.
It is an adapter over `skills/`, schemas, and the deterministic `harness` CLI; it is
not a separate source of truth.

## Layout

- `.codex-plugin/plugin.json` is the Codex plugin manifest.
- `skills/<id>/SKILL.md` contains one Codex metadata prelude followed by the
  canonical `skills/<id>/SKILL.md` body.
- `skills/<id>/agents/openai.yaml` maps canonical invocation policy to a
  repo-local Codex adapter declaration. `harness-health` sets
  `allow_implicit_invocation: false`; the other skills set it to `true` because
  their canonical policy is `user-or-model`.
- Codex host enforcement of `agents/openai.yaml` is not yet validated. Treat
  `allow_implicit_invocation` and the local `schema_version` as
  forward-compatible adapter declarations until smoke evidence proves Codex
  refuses implicit `harness-health` invocation.
- `skill-hashes.json` records canonical and normalized packaged hashes.

## Validation

Run these checks before treating the package as ready:

```sh
bun run check:skill-parity
bun run check:hook-safety
bun run check:plugin-manifests
```

Observed local package environment:

- Check date: 2026-05-30
- Host CLI: `codex-cli 0.135.0`
- Repo marketplace: `.agents/plugins/marketplace.json`
- The repo-local marketplace file is intentionally at the repository root because
  `codex plugin marketplace add .` loads marketplace metadata from
  `.agents/plugins/marketplace.json`; it is not a plugin-only source of truth.
- Temporary-home marketplace/install smoke uses one shared temporary home:
  ```sh
  tmp=$(mktemp -d)
  HOME="$tmp" codex plugin marketplace add .
  HOME="$tmp" codex plugin add harness-engineering --marketplace harness-engineering-local
  HOME="$tmp" codex plugin list --marketplace harness-engineering-local
  rm -rf "$tmp"
  ```
- Temporary-home list output showed
  `harness-engineering@harness-engineering-local` as `installed, enabled` with
  version `0.1.0`.
- Current-auth live/model-backed invocation smoke installed and enabled
  `harness-engineering@harness-engineering-local`, then `codex -a never exec`
  returned `harness doctor --format json` for an explicit `harness-doctor`
  prompt.
- Temp projects outside a trusted Git repository may require
  `codex -a never exec --skip-git-repo-check --cd <temp-project> ...` for
  non-interactive smoke. Use that flag only for disposable smoke projects where
  the repository trust boundary is intentionally external to Codex.

Codex local smoke uses the repo marketplace because the Codex plugin command
exposes marketplace management rather than direct local plugin install. This is
not public Plugin Directory availability. Remaining manual smoke checklist:

1. Restart Codex after marketplace changes.
2. Verify the plugin appears in the interactive plugin directory.
3. Verify the seven Harness skills appear in `/skills`.
4. Capture a negative smoke showing Codex does not implicitly invoke
   `harness-health` from an unrelated prompt.

Do not claim public directory availability or workspace sharing until that
evidence exists.
