import { config, e, guarded, loadAssessModule, output } from './common.mjs';
await guarded('comparison', async () => {
    const c = config();
    const { prepareGitHubAssessment } = await loadAssessModule('github');
    const prepared = await prepareGitHubAssessment({
        repository: c.repository,
        prNumber: c.pr,
        reviewer: c.reviewer,
        outputDir: e.ASSESS_ROOT,
        baseBranch: c.baseBranch,
        fixed: c.fixed,
        token: e.GH_READ_TOKEN,
    });
    output('pr-context-path', prepared.prContextPath);
});
