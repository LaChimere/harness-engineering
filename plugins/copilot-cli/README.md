# Copilot CLI adapter

This directory packages the canonical Harness skills for GitHub Copilot CLI
plugin distribution. It is an adapter over `skills/`, schemas, and the
deterministic `harness` CLI; it is not a separate source of truth.

## Layout

- `plugin.json` is the Copilot CLI plugin manifest.
- `agents/harness.agent.md` gives host-level routing guidance for Harness work.
- `skills/<id>/SKILL.md` contains one Copilot metadata prelude followed by the
  canonical `skills/<id>/SKILL.md` body.
- `skill-hashes.json` records canonical and normalized packaged hashes.

## Validation

Run these checks before treating the package as ready:

```sh
bun run check:skill-parity
bun run check:hook-safety
bun run check:plugin-manifests
```

## Policy behavior

Copilot CLI plugin metadata exposes skills and agents, but this adapter has not
validated a per-skill policy flag equivalent to Claude
`disable-model-invocation` or Codex `allow_implicit_invocation`. The
`harness-health` packaged skill description and `agents/harness.agent.md`
therefore preserve the explicit-user-intent requirement. Repo-local smoke has
confirmed that Copilot did not run health without explicit user intent; this is
guidance-based behavior, not a host-enforced per-skill policy flag.

Local package smoke can be run without invoking a model:

```sh
copilot plugin install ./plugins/copilot-cli
copilot plugin list
```

Live non-interactive smoke that allows the host to run deterministic Harness
commands needs Copilot tool permission, for example:

```sh
copilot --allow-all-tools --plugin-dir ./plugins/copilot-cli -p "Use harness-doctor ..."
```

Use `--allow-all-tools` only in controlled smoke tests; it disables Copilot's
tool-permission prompts and is not end-user guidance.

Observed local package evidence:

- Check date: 2026-05-30
- Host CLI: `GitHub Copilot CLI 1.0.57-2`
- Temporary-home package smoke used one shared temporary home for install and
  list:
  ```sh
  tmp=$(mktemp -d)
  HOME="$tmp" copilot plugin install ./plugins/copilot-cli
  HOME="$tmp" copilot plugin list
  rm -rf "$tmp"
  ```
- Install output: `Plugin "harness-engineering" installed successfully. Installed 7 skills.`
- Visibility output: `harness-engineering (v0.1.0)` appears in `copilot plugin list`.
- Current-auth live/model-backed installed-plugin invocation smoke loaded
  `harness-doctor` from
  `<HOME>/.copilot/installed-plugins/_direct/copilot-cli/skills/harness-doctor`
  and returned `harness doctor --format json`.
- Real-temp-project smoke confirmed Copilot did not run health without explicit
  user intent, did invoke `harness-health` when explicitly asked, and interpreted
  missing `bun`/`npm` as host PATH/toolchain failures rather than Harness
  structural failures.
- The current-auth smoke uninstalled `harness-engineering` afterward; it is not
  left in the user plugin list.

Remaining host smoke: no additional Copilot smoke blocker is known for the
repo-local adapter path. Marketplace evidence remains separate.

Do not claim marketplace availability until separate marketplace evidence
exists.
