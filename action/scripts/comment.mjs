import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { config, e, fail, guarded, loadAssessModule, output, read, write } from './common.mjs';
await guarded('comment', async () => {
    try {
        const c = config(),
            { publishGitHubAssessment } = await loadAssessModule('github');
        // Summary has already selected the only comparison-bound run. A startup failure uses
        // the same package renderer, without inventing an assessment or silently posting it inline.
        const record = read(join(e.ASSESS_ROOT, 'comment-run.json'));
        const run = record?.row?.cliRunId;
        let input = read(join(e.ASSESS_ROOT, 'github-input.json'));
        if (!input) {
            const f = read(join(e.ASSESS_ROOT, 'comparison.json'));
            input = {
                version: 1,
                repository: c.repository,
                pr: c.pr,
                reviewer: c.reviewer,
                base: f.base,
                targetBase: f.targetBase,
                head: f.head,
                baseBranch: c.baseBranch ?? '',
                githubRun: e.GITHUB_RUN_ID,
                githubAttempt: Number(e.GITHUB_RUN_ATTEMPT),
            };
            write(join(e.ASSESS_ROOT, 'github-input.json'), input);
        }
        const result = await publishGitHubAssessment({
            runDir: run ? join(e.ASSESS_ROOT, 'comparison/.contextrail/assess', run) : e.ASSESS_ROOT,
            githubDir: e.ASSESS_ROOT,
            postComment: true,
            inlineComments: c.inlineComments ?? e.INLINE_COMMENTS === 'true',
            artifactUrl: e.ARTIFACT_URL,
            token: e.GH_READ_TOKEN,
        });
        output('comment-status', result.status.startsWith('skipped_') ? result.status : result.commentStatus);
        appendFileSync(
            e.GITHUB_STEP_SUMMARY,
            `\nPR comment: ${result.commentStatus}; inline: ${result.inlineStatus} (${result.omittedInline} omitted, ${result.duplicateInline} existing).${result.commentUrl ? ` [View comment](${result.commentUrl})` : ''}\n`,
        );
        if (result.exitCode) fail('comment_failed');
    } catch {
        output('comment-status', 'failed');
        appendFileSync(e.GITHUB_STEP_SUMMARY, '\nPR comment: failed.\n');
        fail('comment_failed');
    }
});
