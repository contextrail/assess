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

## Package and platform

Assess is an open-source execution tool for the ContextRail platform. Your organization maintains
and publishes guidance in ContextRail; this package retrieves it through MCP and assesses work in
your local or CI environment. The [documentation index](docs/README.md) routes to setup, reference
and architecture without requiring you to read the whole manual.

[Apache-2.0](LICENSE) covers the package, Action and documentation. ContextRail services and
retrieved organizational guidance have separate terms. The public [Assess repository](https://github.com/contextrail/assess)
is a distribution mirror; see [contributing and releases](docs/contributing.md).
