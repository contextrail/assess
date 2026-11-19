# ContextRail Assess

[![npm latest version](https://img.shields.io/npm/v/@contextrail/assess/latest?label=npm%20latest)](https://www.npmjs.com/package/@contextrail/assess)
[![npm alpha version](https://img.shields.io/npm/v/@contextrail/assess/alpha?label=npm%20alpha)](https://www.npmjs.com/package/@contextrail/assess?activeTab=versions)

**Your experts set the standards. Bring them into the work.**

ContextRail brings your experts’ guidance into the tools where teams work. Experts maintain and
publish that knowledge; people and AI agents retrieve it to inform their decisions.

**ContextRail Assess is the platform’s standards assessment tool.** It checks proposed code,
configuration and documentation against your organization’s selected published guidance. Developers
get findings they can act on. When runs report back, standards owners see in ContextRail which of
their standards were applied, at which version, and which outcomes stayed unresolved—a prompt to
check whether the guidance needs clarifying. Teams retain which standards were assessed, the exact
versions used, the evidence and any unanswered questions.

[Run your first assessment](docs/getting-started.md) · [Set up GitHub Actions](docs/github-actions.md) · [Explore ContextRail](https://contextrail.app/product)

## What a finding looks like

An illustrative example—not a captured assessment:

> **Standard:** Every release workflow must require the quality checks before deployment.
>
> **Proposed change:** The deploy job's dependency on the quality gate is removed.
>
> **Finding:** `deploy.yml:42` allows deployment without waiting for the required checks.
> Restore the dependency on the quality gate. Basis: the selected delivery standard, version 3.

Assess examines the proposed workflow. Whether today's CI run is green is a separate question.
It applies the standards you select, rather than treating every possible code improvement as a finding.

## From shared expertise to assessment feedback

1. **Experts publish the guidance in ContextRail.** A reviewer skill selects the contexts to consider.
   Feedback can inform changes; ignored findings do not automatically switch standards off.
2. **Teams apply that guidance while doing the work.** Connected tools retrieve published guidance
   and reusable skills through MCP. The same expert-owned knowledge can inform creation and assessment.
3. **Assess pins the code and guidance versions for the run.** It inspects the proposed changes and
   can read supporting source. Nominated concerns receive independent model validation.
4. **Developers see what needs attention.** A compact PR comment shows findings, unresolved questions
   and a change overview. Optional inline comments include eligible code suggestions.
5. **Teams keep the assessment record.** Every enumerated standard has a recorded outcome, including
   unresolved or not evaluated. Detailed evidence stays in your run artifacts; structured outcome
   metadata can return to ContextRail.

“No concern identified” is an observation, not independently verified compliance. Missing scope,
unfinished assessments and execution failures remain visible. Assess does not run your test suite
or certify deployment readiness.

## Start where you work

You need Node 22.18.0+, Git 2.45+, ContextRail MCP access, a published reviewer skill with selected
contexts, and an OpenAI or OpenRouter API key. [Standards setup](docs/standards.md) explains the
ContextRail side before you install anything.

| Your task                                         | Start here                                         |
| ------------------------------------------------- | -------------------------------------------------- |
| Try one Git comparison locally                    | [First assessment](docs/getting-started.md)        |
| Add assessment to pull requests                   | [GitHub Actions](docs/github-actions.md)           |
| Understand a finding or unresolved question       | [Results and next actions](docs/review-results.md) |
| Choose models, logging and limits                 | [Configuration](docs/configuration.md)             |
| Evaluate source access, retention and credentials | [Security and data handling](docs/security.md)     |
| Diagnose an incomplete or failed run              | [Operations](docs/operations.md)                   |

Start in **advisory** mode. Choose **required** to gate supported binding violations, or **strict**
to also gate unresolved evidence. Execution failures remain failures in every mode.

Source excerpts and selected guidance are sent to your chosen model provider. Detailed source,
quotes and conversations are not included in ContextRail's assessment-feedback payload.
See [where data goes](docs/security.md) before connecting a repository.

## Give large pull requests more capacity

A standard run keeps cost and time predictable. A large pull request can stop before it finishes:
the PR comment reports an incomplete assessment, and the run's stop reason is `max_time_ms` (time
limit reached) or `model_call_limit` (a verification used all its model calls). You do not have to
change how your team sizes pull requests. Instead, let a maintainer re-run that PR with more capacity
by adding a second label.

Three Action inputs set a run's capacity:

| Input              | Standard run       | Suggested extended run | What it changes                                                                                                                                                                                          |
| ------------------ | ------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `speed`            | `normal` (default) | `fast`                 | Requests the provider's priority tier: quicker calls at a higher per-token price. `ultrafast` is also accepted. If a model doesn't serve a tier, Assess logs `provider_speed_unavailable` and continues. |
| `max-time-ms`      | `600000` (10 min)  | `1500000` (25 min)     | Model time limit for the run. Keep the job's `timeout-minutes` about 10 minutes above it for setup and publishing.                                                                                       |
| `max-verify-calls` | empty (12)         | `30`                   | Model calls each finding's independent verification may use.                                                                                                                                             |

### 1. Create the labels

```sh
gh label create contextrail-assess --color 1D76DB \
  --description "Run ContextRail Assess on this pull request"
gh label create contextrail-assess-extended --color 5319E7 \
  --description "Re-run ContextRail Assess with extended capacity"
```

In the GitHub UI: **Pull requests → Labels → New label**. Any names work if the workflow uses the same ones.

### 2. Optionally tune the extended run

The workflow below has built-in defaults. To change them without editing it, set repository variables:

```sh
gh variable set ASSESS_EXTENDED_SPEED --body fast
gh variable set ASSESS_EXTENDED_MAX_TIME_MS --body 1500000
gh variable set ASSESS_EXTENDED_MAX_VERIFY_CALLS --body 30
```

In the GitHub UI: **Settings → Secrets and variables → Actions → Variables → New repository variable**.
These names belong to your workflow; the Action itself reads only its inputs. Set up the connection
variables and secrets first, as described in [GitHub Actions](docs/github-actions.md#prepare-the-repository-settings).

### 3. Add the workflow

Save as `.github/workflows/contextrail-assess.yml` on the default branch and replace the reviewer skill ID:

```yaml
name: ContextRail Assess
on:
    pull_request_target:
        types: [labeled]
permissions: {}
concurrency:
    group: contextrail-assess-${{ github.repository }}-${{ github.event.pull_request.number }}
    cancel-in-progress: false
jobs:
    assess:
        # Only maintainers with triage or write access can add labels. Same-repository human PRs only.
        if: >-
            (github.event.label.name == 'contextrail-assess' ||
            github.event.label.name == 'contextrail-assess-extended') &&
            github.event.pull_request.head.repo.full_name == github.repository &&
            github.event.pull_request.user.type == 'User'
        runs-on: ubuntu-latest
        timeout-minutes: 35
        permissions:
            contents: read
            pull-requests: write
        env:
            EXTENDED: ${{ github.event.label.name == 'contextrail-assess-extended' }}
        steps:
            - name: Assess proposed changes
              uses: contextrail/assess/action@v1-alpha
              with:
                  pr-number: ${{ github.event.pull_request.number }}
                  reviewer: skill://engineering/your-reviewer
                  mcp-url: ${{ vars.CONTEXTRAIL_MCP_URL }}
                  mcp-org-id: ${{ vars.CONTEXTRAIL_MCP_ORG_ID }}
                  mcp-auth-token: ${{ secrets.CONTEXTRAIL_MCP_AUTH_TOKEN }}
                  provider: openai
                  model: ${{ vars.ASSESS_MODEL }}
                  openai-api-key: ${{ secrets.OPENAI_API_KEY }}
                  enforcement: advisory
                  post-comment: 'true'
                  speed: ${{ env.EXTENDED == 'true' && (vars.ASSESS_EXTENDED_SPEED || 'fast') || 'normal' }}
                  max-time-ms: ${{ env.EXTENDED == 'true' && (vars.ASSESS_EXTENDED_MAX_TIME_MS || '1500000') || '600000' }}
                  max-verify-calls: ${{ env.EXTENDED == 'true' && (vars.ASSESS_EXTENDED_MAX_VERIFY_CALLS || '30') || '' }}
```

The job never checks out or runs pull request code, which is what makes `pull_request_target`
safe to use with secrets here. Do not add steps that do.

To also review every pull request when it is opened, set `types: [opened, ready_for_review, labeled]`
and make the first part of `if` accept those events too. Each opened pull request then starts one paid run:

```yaml
if: >-
    (((github.event.action == 'opened' || github.event.action == 'ready_for_review') &&
    !github.event.pull_request.draft) ||
    github.event.label.name == 'contextrail-assess' ||
    github.event.label.name == 'contextrail-assess-extended') &&
    github.event.pull_request.head.repo.full_name == github.repository &&
    github.event.pull_request.user.type == 'User'
```

### 4. Run it

```sh
gh pr edit 123 --add-label contextrail-assess           # standard run
gh pr edit 123 --add-label contextrail-assess-extended  # after an incomplete run
```

In the GitHub UI: open the pull request and choose the label under **Labels** in the sidebar.
Each label addition starts a new paid run. To run again with the same label, remove it and add it
back. **Re-run jobs** replays the original event and is rejected if the pull request has changed since.

## Package and platform

Assess is an open-source execution tool for the ContextRail platform. Your organization maintains
and publishes guidance in ContextRail; this package retrieves it through MCP and assesses work in
your local or CI environment. The [documentation index](docs/README.md) routes to setup, reference
and architecture without requiring you to read the whole manual.

[Apache-2.0](LICENSE) covers the package, Action and documentation. ContextRail services and
retrieved organizational guidance have separate terms. The public [Assess repository](https://github.com/contextrail/assess)
is a distribution mirror; see [contributing and releases](docs/contributing.md).
