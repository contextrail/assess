# Security and data handling

[Documentation index](README.md) · [Assess overview](../README.md)

For maintainers and security reviewers deciding where Assess may run and which services may receive
its inputs. Assess runs in your local or CI environment, but assessment requires requests to your
selected model provider.

## Where data goes

| Destination                         | Material                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ContextRail MCP                     | Guidance retrieval requests, organization scope and authorized authentication; optional repository attribution                                       |
| Selected OpenAI/OpenRouter provider | Guidance, source excerpts and other assessment inputs; optional PR discussion/history when enabled                                                   |
| Local run directory                 | Pinned comparison, guidance, citations, observations, decisions, reports and bounded diagnostics                                                     |
| GitHub, when enabled                | PR summary/inline comments and uploaded evidence artifacts, under the consumer's permissions and retention settings                                  |
| ContextRail assessment feedback     | Allowlisted run/standard identities and versions, structured outcomes, policy/completion and known telemetry—not source, quotations or conversations |

“No detailed evidence upload to ContextRail” does not mean “no third-party processing.” Choose a
provider account and data-handling arrangement appropriate for your source and guidance. A provider's
reported token usage or cost is not a verified invoice.

`--feedback send` is the default; `--feedback off` disables assessment-metadata submission.
Ordinary MCP retrieval still produces delivery events. Repository identity is withheld by default;
`--repository-attribution` includes the Git-derived host, owner namespace and repository name, not a
remote URL. An ingestion receipt confirms receipt, not correctness or compliance.

## What source the model can inspect

The package fixes the base/head commits and reads source through bounded tools. Supporting unchanged
files at those snapshots are available when needed. It does not execute project scripts, install
project dependencies, run tests, initialize submodules or give the model a shell.

Conventional credential paths are excluded, and binary/submodule contents have explicit limits.
These protections are not a guarantee that arbitrary secrets embedded in ordinary source will be
detected. Review the repository's suitability before sending it to a provider.

PR text and prior comments are untrusted context, not governing instructions. Opting into PR history
sends bounded excerpts to the selected provider. See [PR context](review-results.md#review-history-and-conversational-context).

## Credentials and execution trust

Use process environment or a secret manager locally, and named GitHub secrets in CI. Do not put keys
in CLI arguments, source, PR discussion or retained artifacts. The CLI does not load `.env` files.

The Action isolates installation, GitHub reads and model execution credentials between steps, but a
composite Action shares its caller's job. Never execute untrusted contribution code in that credentialed
job. Pin a reviewed Action commit and an exact qualified npm version; disabling install scripts does
not make an untrusted runtime package safe. The [GitHub guide](github-actions.md#triggers-permissions-and-trust)
explains the caller's responsibilities.

## Retention and interpretation

The consumer controls local artifacts and GitHub access/retention. Action artifacts default to seven
days; choose an appropriate retention period rather than assuming a PR comment is a permanent audit
store. Comments can outlive artifacts and their hidden history is mutable convenience data.

The bundle records exact work/guidance identities and evidence. It is not independently signed
assurance, and no finding-free result certifies comprehensive compliance. Publication attribution can
be looked up in ContextRail using the recorded context/version; the package does not add an approval
workflow or currently embed publisher metadata in the evidence bundle.

See [operations](operations.md#data-handling-and-feedback) for the precise feedback boundary and
[Action reference](action-reference.md) for artifact delivery, cancellation and access behavior.
