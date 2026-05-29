import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lintSkills, lintSkillText } from '../../scripts/lint-skills.ts';

const validSkill = `---
id: harness-doctor
purpose: Run and interpret harness doctor structural inspection
invocation_policy: user-or-model
version: 1.0.0
---

## Purpose
Runs harness doctor and interprets JSON evidence.

## Invocation
Use when structural inspection is needed.

## Steps
1. Run \`harness doctor --format json\`.
2. Read status and issues from the JSON output.

## Safety
- Do not infer harness state from chat.
`;

test('canonical skills lint cleanly', async () => {
  expect(await lintSkills(process.cwd())).toEqual([]);
});

test('skill lint catches missing required sections', () => {
  const findings = lintSkillText(
    'skills/harness-doctor/SKILL.md',
    'harness-doctor',
    validSkill.replace('## Safety', '## Notes'),
  );
  expect(findings.map((finding) => finding.ruleId)).toContain('missing-section');
});

test('skill lint catches forbidden generated-output and action patterns', () => {
  const text = `${validSkill}
## Troubleshooting
\`harness doctor --format json > .harness/outputs/doctor.json\`
  \`tee .harness/outputs/log.txt\`
  \`echo '{}' > .harness/outputs/profile.json\`
  openai.chat
  anthropic.messages
  model.generate
  next_actions should not be used.
  {"success": true}
  \`harness validate\`
  \`harness loop run\`
  \`harness evidence-loop\`
  `;
  const ruleIds = lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', text).map(
    (finding) => finding.ruleId,
  );
  expect(ruleIds).toContain('generated-output-redirect');
  expect(ruleIds).toContain('generated-output-tee');
  expect(ruleIds).toContain('manual-generated-evidence-write');
  expect(ruleIds).toContain('direct-model-execution');
  expect(ruleIds).toContain('next-actions');
  expect(ruleIds).toContain('universal-success-field');
  expect(ruleIds).toContain('agent-facing-validate');
  expect(ruleIds).toContain('aggregate-loop-run');
  expect(ruleIds).toContain('invented-evidence-loop-command');
});

test('skill lint ignore markers are next-line only and require reasons', () => {
  const allowed = `${validSkill}
<!-- harness-skill-lint-ignore next-actions: documenting external next_actions input field -->
next_actions
`;
  expect(lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', allowed)).toEqual([]);

  const missingReason = `${validSkill}
<!-- harness-skill-lint-ignore next-actions:  -->
next_actions
`;
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', missingReason).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('invalid-ignore');

  const blankLine = `${validSkill}
<!-- harness-skill-lint-ignore next-actions: documenting external input field -->

next_actions
`;
  const blankLineFindings = lintSkillText(
    'skills/harness-doctor/SKILL.md',
    'harness-doctor',
    blankLine,
  ).map((finding) => finding.ruleId);
  expect(blankLineFindings).toContain('unused-ignore');
  expect(blankLineFindings).toContain('next-actions');
});

test('skill lint catches invented harness commands', () => {
  const text = validSkill.replace(
    'harness doctor --format json',
    'harness imaginary --format json',
  );
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', text).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('unknown-harness-command');
});

test('skill lint catches invented harness subcommands', () => {
  const text = validSkill.replace('harness doctor --format json', 'harness gc fabricate');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', text).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('unknown-harness-subcommand');

  const missingGroupedSubcommand = validSkill.replace(
    'harness doctor --format json',
    'harness gc --format json',
  );
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', missingGroupedSubcommand).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('missing-harness-subcommand');

  const extraLeafSubcommand = validSkill.replace(
    'harness doctor --format json',
    'harness doctor fabricate',
  );
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', extraLeafSubcommand).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('unknown-harness-subcommand');
});

test('skill lint catches frontmatter and policy violations', () => {
  const missingFrontmatter = validSkill.replace('---\n', '');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', missingFrontmatter).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('missing-frontmatter');

  const unterminatedFrontmatter = validSkill.replace('\n---\n\n## Purpose', '\n\n## Purpose');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', unterminatedFrontmatter).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('missing-frontmatter');

  const missingId = validSkill.replace('id: harness-doctor\n', '');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', missingId).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-required');

  const wrongId = validSkill.replace('id: harness-doctor', 'id: harness-health');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', wrongId).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-id');

  const wrongPolicy = validSkill.replace(
    'invocation_policy: user-or-model',
    'invocation_policy: maybe',
  );
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', wrongPolicy).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-invocation-policy');

  const badVersion = validSkill.replace('version: 1.0.0', 'version: soon');
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', badVersion).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-version');

  const healthWithoutApproval = validSkill
    .replaceAll('harness-doctor', 'harness-health')
    .replace(
      'purpose: Run and interpret harness doctor structural inspection',
      'purpose: Run health',
    );
  expect(
    lintSkillText('skills/harness-health/SKILL.md', 'harness-health', healthWithoutApproval).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-requires-approval');
  expect(
    lintSkillText('skills/harness-health/SKILL.md', 'harness-health', healthWithoutApproval).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-invocation-policy');

  const wrongHealthPolicy = healthWithoutApproval.replace(
    'version: 1.0.0',
    'version: 1.0.0\nrequires_approval: true',
  );
  expect(
    lintSkillText('skills/harness-health/SKILL.md', 'harness-health', wrongHealthPolicy).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-invocation-policy');

  const bodyBeforeClose = validSkill.replace(
    'version: 1.0.0\n---',
    'version: 1.0.0\n## Purpose\n---',
  );
  expect(
    lintSkillText('skills/harness-doctor/SKILL.md', 'harness-doctor', bodyBeforeClose).map(
      (finding) => finding.ruleId,
    ),
  ).toContain('frontmatter-invalid-line');
});

test('skill lint catches tree shape violations', async () => {
  const root = await mkdtemp(join(tmpdir(), 'harness-skill-lint-'));
  try {
    await mkdir(join(root, 'skills', 'harness-doctor'), { recursive: true });
    await mkdir(join(root, 'skills', 'harness-health'), { recursive: true });
    await mkdir(join(root, 'skills', 'harness-health', 'SKILL.md'), { recursive: true });
    await mkdir(join(root, 'skills', 'unknown-skill'), { recursive: true });
    await writeFile(join(root, 'skills', 'README.md'), '# Incomplete\n');
    await writeFile(join(root, 'skills', 'extra.txt'), 'extra\n');
    await writeFile(join(root, 'skills', 'harness-doctor', 'NOTES.md'), 'extra\n');
    const ruleIds = (await lintSkills(root)).map((finding) => finding.ruleId);
    expect(ruleIds).toContain('missing-skill');
    expect(ruleIds).toContain('missing-skill-file');
    expect(ruleIds).toContain('unknown-skill');
    expect(ruleIds).toContain('unexpected-skill-root-entry');
    expect(ruleIds).toContain('unexpected-skill-file');
    expect(ruleIds).toContain('unreadable-skill-file');
    expect(ruleIds).toContain('missing-readme-section');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
