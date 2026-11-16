# Run your first assessment

[Documentation index](README.md) · [Assess overview](../README.md)

This guide takes a Git comparison to a local report. Use [GitHub Actions](github-actions.md) if you
want PR comments and CI integration.

## Before you start

Have these ready:

- Node >=22.18.0 and Git >=2.45.
- A Git repository with both commits and their supporting objects available locally.
- Your organization's ContextRail MCP endpoint, organization ID and authorized token.
- A published reviewer skill ID such as `skill://engineering/your-reviewer` that selects published contexts.
- An OpenAI or OpenRouter API key and a tool-capable model available to that account.

If you do not yet have the ContextRail inputs, follow [standards setup](standards.md).

## Install an exact published version

Inspect available releases, choose a version, then replace `EXACT_VERSION` below:

```sh
npm view @contextrail/assess dist-tags
npm install --ignore-scripts @contextrail/assess@EXACT_VERSION
./node_modules/.bin/contextrail-assess --help
```

Pin the version in your dependency lockfile. The badges show npm channels; they do not select a
version for your project. A source checkout's manifest can contain a development version rather
than a registry release. Public exports include `release.json` with the selected release and source commit.

## Check your guidance connection

Supply `CONTEXTRAIL_MCP_AUTH_TOKEN` securely through your secret manager or process environment.
The CLI does not load `.env` files. Set the nonsecret connection values and replace the remaining placeholders:

```sh
export CONTEXTRAIL_MCP_URL='https://YOUR_CONTEXTRAIL_HOST/mcp'
export CONTEXTRAIL_MCP_ORG_ID='YOUR_ORGANIZATION_ID'

./node_modules/.bin/contextrail-assess prepare \
  --reviewer skill://engineering/your-reviewer \
  --repo /path/to/repository \
  --base BASE_COMMIT_SHA --head HEAD_COMMIT_SHA
```

Preparation retrieves guidance and captures the comparison without a model call. Open the returned
run directory's `preparation.md`: confirm the commits, selected standards and any missing material.
A prepared scope is ready to assess; it is not a passing assessment.

The comparison is exactly base → head. The local CLI does not choose a merge base or include
uncommitted edits. For a PR comparison, use its merge base and head, or use the GitHub Action,
which prepares that comparison for you.

## Run the assessment

Supply `OPENAI_API_KEY` securely and choose a provider-native model ID:

```sh
./node_modules/.bin/contextrail-assess run \
  --reviewer skill://engineering/your-reviewer \
  --repo /path/to/repository \
  --base BASE_COMMIT_SHA --head HEAD_COMMIT_SHA \
  --provider openai --model YOUR_OPENAI_MODEL_ID \
  --enforcement advisory --max-time-ms 600000
```

For OpenRouter, supply `OPENROUTER_API_KEY` and use
`--provider openrouter --model YOUR_OPENROUTER_MODEL_ID`. One model serves assessment and
validation by default. [Configuration](configuration.md) covers optional effort and phase overrides.

The deadline bounds model execution, not preparation or total process time. It is not a dollar cap.
Standard `info` logging shows progress on stderr; stdout remains machine-readable JSON.

## Read the result

The final JSON identifies the run directory and decision. Open
`.contextrail/assess/<run-id>/report.md` in the reviewed repository.

- Act on supported findings and their suggested corrections.
- Inspect unresolved questions for a specific missing implementation fact or ambiguous standard.
- Check completion and execution status before relying on the result.
- Keep the bundle if you need the exact work versions, guidance versions and cited evidence later.

Advisory exit 0 permits continuation; it does not mean every standard was satisfied. See
[results and next actions](review-results.md) for the outcome and exit-code table.

By default, structured assessment metadata is reported to ContextRail after local finalization.
Use `--feedback off` to disable that submission. Either way, source and guidance needed for the
assessment go to your model provider. Read [security and data handling](security.md) before sharing artifacts.
