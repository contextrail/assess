# ContextRail Assess documentation

[Product overview](../README.md)

For teams adopting Assess, start with the setup path that matches your work. ContextRail maintains
these docs alongside the package and Action; the same pages ship in the public repository and npm package.

| What you need to do                        | Read                                          |
| ------------------------------------------ | --------------------------------------------- |
| Choose and publish the standards to assess | [Standards setup](standards.md)               |
| Get your first local result                | [First assessment](getting-started.md)        |
| Connect GitHub pull requests               | [GitHub Actions](github-actions.md)           |
| Act on findings, questions or a failure    | [Results and next actions](review-results.md) |
| Evaluate data handling and access          | [Security and data handling](security.md)     |
| Configure models, effort and limits        | [CLI configuration](configuration.md)         |
| Look up Action inputs and outputs          | [Action reference](action-reference.md)       |
| Diagnose, resume or inspect a run          | [Operations](operations.md)                   |
| Understand or change the harness           | [Architecture](architecture.md)               |
| Develop or publish the package             | [Contributing](contributing.md)               |

For coding agents: load the page for the current task, then follow the links needed to resolve a
specific question. The CLI's `--help` and [Action metadata](https://github.com/contextrail/assess/blob/main/action/action.yml)
define the executable interface. Published reviewer skills and contexts define the assessment
criteria; documentation and PR discussion do not override them.
