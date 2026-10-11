import { describe, expect, it } from 'vitest';
import { formatGitContextMarkdown } from '../src/utils/git.js';
import { defaultRedactor } from '../src/utils/redact.js';

describe('current Git context in recovery prompts', () => {
  it('labels current state and redacts full values before shortening them', () => {
    const secret = `ghp_${'A'.repeat(36)}`;
    const markdown = formatGitContextMarkdown({
      cwd: '/synthetic/project',
      available: true,
      branch: `topic-${secret}`,
      recentCommits: [`abcd123 ${'x'.repeat(770)} ${secret}`],
      status: ` M ${'x'.repeat(775)}${secret}`,
    })!;
    expect(markdown).toContain('current checkout, not historical');
    expect(markdown).not.toContain('ghp_');
    expect(markdown).not.toContain('AAAA');
    expect(markdown).toContain('abcd123');
  });

  it('honors configured extra patterns before display limits', () => {
    const redactor = defaultRedactor({
      extraPatterns: [
        { name: 'private-name', regex: /private-project-[a-z]+/g, replacement: '[PRIVATE]' },
      ],
    });
    const markdown = formatGitContextMarkdown(
      {
        cwd: '/synthetic/project',
        available: true,
        branch: 'private-project-alpha',
        status: ' M private-project-beta/file.ts',
      },
      redactor,
    )!;
    expect(markdown).not.toContain('private-project');
    expect(markdown).toContain('[PRIVATE]/file.ts');
  });
});
