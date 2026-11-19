import { defineConfig } from 'vitest/config';

// Contract tests drive real git, the compiled CLI and the Action scripts; they run in CI (`test:contract`),
// not in the workspace gate. Everything else runs in `test`.
const contract = 'tests/**/*.contract.test.ts';

export default defineConfig({
    test: {
        // Recursive pnpm runs independent Vitest processes concurrently.
        fsModuleCachePath: new URL('./node_modules/.vitest-cache', import.meta.url).pathname,
        environment: 'node',
        pool: 'threads',
        maxWorkers: 3,
        // Independent test files own their temporary repositories.
        testTimeout: 20_000,
        projects: [
            { extends: true, test: { name: 'unit', include: ['tests/**/*.test.ts'], exclude: [contract] } },
            { extends: true, test: { name: 'contract', include: [contract] } },
        ],
    },
});
