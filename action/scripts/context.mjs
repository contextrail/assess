import { join } from 'node:path';
import { config, e, guarded, loadAssessModule, output, read, write } from './common.mjs';
await guarded('context', async () => {
    const c = config(),
        fixed = read(join(e.ASSESS_ROOT, 'comparison.json'));
    if (!fixed) throw new Error('configuration_unavailable');
    const { collectGitHubContext, githubRequester } = await loadAssessModule('github');
    const request = githubRequester(c.repository, e.GH_READ_TOKEN);
    const metadata = read(join(e.ASSESS_ROOT, 'pr-context.json'));
    const pr = { title: metadata?.intent?.title ?? '', body: metadata?.intent?.body ?? '' };
    const context = await collectGitHubContext(
        {
            version: 1,
            repository: c.repository,
            pr: c.pr,
            reviewer: c.reviewer,
            base: fixed.base,
            targetBase: fixed.targetBase,
            head: fixed.head,
            baseBranch: c.baseBranch ?? '',
        },
        pr,
        request,
        true,
        e.GH_READ_TOKEN,
    );
    const path = join(e.ASSESS_ROOT, 'pr-context.json');
    write(path, context);
    write(join(e.ASSESS_ROOT, 'context-status.json'), {
        status: 'captured',
        discussion: context.discussion.status,
        history: context.history.status,
    });
    output('path', path);
});
