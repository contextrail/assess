# Assess pull requests with GitHub Actions

[Documentation index](README.md) · [Assess overview](../README.md)

Start with a maintainer-triggered advisory assessment. It produces a PR comment and evidence bundle
without making standards findings a required merge gate. Execution failures still fail the job.

## Prepare the repository settings

Complete [standards setup](standards.md), then add these in **Settings → Secrets and variables → Actions**:

| Kind     | Name                         | Value                                                         |
| -------- | ---------------------------- | ------------------------------------------------------------- |
| Variable | `CONTEXTRAIL_MCP_URL`        | Your authorized HTTPS MCP endpoint                            |
| Variable | `CONTEXTRAIL_MCP_ORG_ID`     | Your organization ID                                          |
| Variable | `ASSESS_MODEL`               | A tool-capable OpenAI model ID available to your account      |
| Secret   | `CONTEXTRAIL_MCP_AUTH_TOKEN` | Token authorized for the selected skill/contexts and feedback |
| Secret   | `OPENAI_API_KEY`             | Your provider key                                             |

## Choose an update policy

Use `contextrail/assess/action@v1-alpha` during alpha. After a stable v1 release exists,
use `@v1` to receive compatible v1 updates. Moving to v2 is a deliberate workflow change.
Alpha is experimental and does not carry the stable compatibility promise.

Each channel advances only after the matching npm package is downloadable. The Action reads
its release manifest and installs that exact version; there is no separate package variable to maintain.
For controlled upgrades or rollback, use an exact release tag such as `@v1.0.0-alpha.3`,
or its full public commit SHA. Exact tags remain protected; floating tags have no GitHub Release attached.
Only select a release that has actually been published.

A channel opts into future releases by the publisher; it is not an immutable source pin.
A fresh run, including a rerun, can resolve a newer channel revision. Pin the recorded commit
when reproducing an earlier run. For an independently qualified package override, the low-level
`package-version` input still accepts an exact version; it is unnecessary for normal use.

## Add the workflow

Save this as `.github/workflows/contextrail-assess.yml`. Replace the reviewer skill ID before committing it. No contribution checkout is needed.

```yaml
name: ContextRail Assess
on:
    workflow_dispatch:
        inputs:
            pr-number:
                description: Pull request number to assess
                required: true
                type: string
permissions: {}
concurrency:
    group: contextrail-assess-${{ github.repository }}-${{ inputs.pr-number }}
    cancel-in-progress: false
jobs:
    assess:
        runs-on: ubuntu-latest
        timeout-minutes: 20
        permissions:
            contents: read
            pull-requests: write
        steps:
            - name: Assess proposed changes
              uses: contextrail/assess/action@v1-alpha
              with:
                  pr-number: ${{ inputs.pr-number }}
                  reviewer: skill://engineering/your-reviewer
                  mcp-url: ${{ vars.CONTEXTRAIL_MCP_URL }}
                  mcp-org-id: ${{ vars.CONTEXTRAIL_MCP_ORG_ID }}
                  mcp-auth-token: ${{ secrets.CONTEXTRAIL_MCP_AUTH_TOKEN }}
                  provider: openai
                  model: ${{ vars.ASSESS_MODEL }}
                  openai-api-key: ${{ secrets.OPENAI_API_KEY }}
                  enforcement: advisory
                  max-time-ms: '600000'
                  post-comment: 'true'
```

The workflow must be available on the repository's default branch for the manual Run workflow
control. Run a trusted workflow revision and enter the PR number. With the GitHub CLI:

```sh
gh workflow run contextrail-assess.yml --repo OWNER/REPOSITORY -f pr-number=123
```

For OpenRouter, change `provider` to `openrouter`, use `openrouter-api-key` with
`secrets.OPENROUTER_API_KEY`, and set `ASSESS_MODEL` to its provider-native model ID.
Do not include an unused provider secret.

After the first run, inspect the PR comment, Action summary and artifact bundle. Confirm the expected
commits and guidance versions. ContextRail feedback status is separate from execution: a receipt
confirms ingestion only. [Results and next actions](review-results.md) explains what to do with findings.

## Tune only what you need

- **Inline feedback:** add `inline-comments: 'true'` to publish eligible verified findings and code suggestions.
- **More progress detail:** add `log-level: debug`; routine logs still exclude full conversations and raw provider errors.
- **PR discussion/history:** add `pr-context: 'true'`. Read the [data implications](security.md) first.
- **Merge policy:** set `enforcement: required` for supported binding violations, or `strict` to also block unresolved evidence. Configure branch protection to require the job if desired. Do not use `continue-on-error` to create advisory behavior; it would hide execution failures.
- **Retention:** set `artifact-retention-days` to a permitted value from 1–90. The default is seven days.
- **Large pull requests:** add a second label that re-runs an incomplete assessment with a faster tier, a longer time limit and more verification calls. See [give large pull requests more capacity](../README.md#give-large-pull-requests-more-capacity).
- **Models:** one model serves both roles by default. Add `effort` only if the model supports it; [phase overrides](configuration.md#models-by-phase-and-logging) let you select a different verifier later.

Repository variable names belong to your caller workflow. In this example `ASSESS_MODEL` is passed
explicitly to the Action; setting it alone in a local shell does not configure the CLI. The maintained
monorepo caller uses one `ASSESS_RELEASE` variable (default `v1-alpha`) and records the resolved
public Action SHA and exact npm version in the summary and a `contextrail-assess-release-*` artifact.
It also supports `ASSESS_EFFORT`, `ASSESS_VERIFY_MODEL`, `ASSESS_VERIFY_EFFORT`
and `ASSESS_ENFORCEMENT`. Standalone CLI aliases use `CONTEXTRAIL_ASSESS_*`.

## Triggers, permissions and trust

You decide which events and people may spend provider budget or access credentials. Manual dispatch
is a starting policy, not permission for untrusted PR authors to run credentialed code. If you add
labels, automatic PR events or schedules, define fork/bot/branch admission in the caller workflow.
The Action does not authorize a run from the PR author's association or account type.

The Action prepares a fixed PR comparison using GitHub and Git objects. PR events bind to event
SHAs; manual and scheduled invocations resolve current PR SHAs. The comparison uses the unique Git
merge base, excluding changes made only on the target branch. `comparison.json` records the analysis
base and observed target tip separately. Missing/ambiguous ancestry or stale event identities stop
preparation. Optional `base-branch` checks an expected target branch; it is not needed for the example.

Fork heads are fetched through the base repository's PR ref. The Action does not check out contribution
files or execute their scripts/hooks, and rechecks comparison identity before introducing provider
credentials. A final freshness check labels changed comparisons as superseded before publication.

A composite Action shares its job and runner. **Do not execute untrusted contribution code anywhere
in this credentialed job**, restore untrusted caches or run untrusted services alongside it. Only a
trusted Action revision and qualified npm artifact may receive credentials. Disabled npm lifecycle
scripts do not make runtime package code trusted. The Action requires Linux, Git >=2.45, access to
GitHub.com and the public npm registry; it installs Node 22.18.0. GHES/private registries are outside
this interface.

For read-only results, set `post-comment: 'false'` and reduce `pull-requests` to `read`; keep
`contents: read`. Optional `checks: read` and `statuses: read` permit capture of GitHub status metadata,
not logs. Those receipts are not the artifact assessment's subject. Use the default GitHub Actions
token for comments; it updates only the matching bot-owned comment. No labels or Slack messages are written.

## Qualify and operate a consumer

1. Check the installed package identity and the reviewed Action SHA.
2. Confirm the intended published reviewer and context versions are readable.
3. Run one small authorized PR and inspect its findings, source links, completion and evidence artifacts.
4. Check feedback delivery separately, and correct any endpoint/contract or credential problem.
5. Decide whether advisory behavior meets your needs before making the job a required check.

Use a fresh dispatch for current commits. Rerunning an old event can reject superseded comparisons;
removing/readding a trigger label is a new paid request. Duplicate execution requests are not deduplicated.
Disable the workflow to stop new runs. Rotate expired credentials through their issuing service and
GitHub secrets, then verify a small run without logging secret values.

See [Action reference](action-reference.md) for every input/output and failure-delivery behavior,
and [operations](operations.md) for diagnostics and recovery.
