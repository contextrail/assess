import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const directories: string[] = [];
afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// A fresh module per test: the resolved executable is cached for the life of the process.
const resolveWith = async (path: string) => {
    vi.stubEnv('PATH', path);
    const { gitExecutable } = await import('../src/git.js');
    return gitExecutable;
};

describe.skipIf(process.platform === 'win32')('git executable resolution', () => {
    it('resolves the first executable git on an absolute PATH entry and keeps it', async () => {
        const empty = mkdtempSync(join(tmpdir(), 'assess-git-empty-'));
        const bin = mkdtempSync(join(tmpdir(), 'assess-git-bin-'));
        directories.push(empty, bin);
        writeFileSync(join(bin, 'git'), '#!/bin/sh\n', { mode: 0o755 });
        const gitExecutable = await resolveWith([empty, bin].join(delimiter));
        expect(gitExecutable()).toBe(join(bin, 'git'));
        vi.stubEnv('PATH', '');
        expect(gitExecutable()).toBe(join(bin, 'git'));
    });

    it('skips relative and non-executable entries and falls back to the bare name', async () => {
        const bin = mkdtempSync(join(tmpdir(), 'assess-git-plain-'));
        directories.push(bin);
        writeFileSync(join(bin, 'git'), 'not executable', { mode: 0o644 });
        const gitExecutable = await resolveWith(['relative/bin', '', bin].join(delimiter));
        expect(gitExecutable()).toBe('git');
    });
});
