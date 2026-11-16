# Set up the standards to assess

[Documentation index](README.md) · [Assess overview](../README.md)

Use this guide with the subject-matter expert who owns your guidance and the maintainer connecting
Assess. These contexts belong to your organization’s shared guidance: connected tools can also
retrieve them while people create work. The reviewer skill selects which guidance Assess should
consider for a proposed change. Installing the package alone does not create an assessment scope.

## Prepare the ContextRail inputs

1. **Publish the guidance you want applied.** In ContextRail, contexts describe your organization's
   Standards and Guidance. The owner maintains their meaning and publishes a version. An unpublished
   draft is not the version Assess uses.
2. **Publish a reviewer skill that selects those contexts.** A reviewer skill supplies assessment
   instructions and an explicit context/domain selection. Its required context prerequisites are
   also resolved. An instruction-only skill has no assessable context set for this package.
3. **Give the maintainer the published skill ID.** Use its `skill://…` identifier, not its title or a
   run ID. The package option remains `--reviewer` because it selects this platform skill.
4. **Provide authorized MCP access.** Your ContextRail administrator supplies the endpoint, organization
   ID and a token authorized to read the selected skill and contexts. Feedback submission also needs
   the corresponding access when enabled. Transfer the token through your secret manager, not a PR.
5. **Run `prepare` before the first paid assessment.** Confirm the enumerated contexts and versions in
   `preparation.md`. Missing or inaccessible guidance makes preparation incomplete rather than silently
   reducing the scope.

[The first-assessment guide](getting-started.md) has the commands. [GitHub setup](github-actions.md)
shows where to store the connection values for CI.

## Write guidance that can be applied to an artifact

A useful standard identifies the behavior it governs, the requirement, and meaningful conditions
or permitted exceptions. Examples help the assessor distinguish an actual contradiction from a
preferred implementation.

For example:

> Release workflows must require the maintained quality gate before deployment. Emergency release
> paths must preserve the documented authorization and recovery requirements.

For a proposed workflow change, Assess can inspect dependencies, conditions and the emergency path.
“Make sure today's checks passed” asks about a run rather than the proposed artifact. Keep execution
checks in CI; use guidance to describe what those checks and delivery mechanisms must enforce.

Avoid making the reviewer skill a second source of company requirements. Put the governing rules in
selected contexts. The skill can focus investigation, but its instructions do not expand this package
into a general operational audit or unrelated bug hunt.

## Keep ownership after publication

Assess pins the published skill and context versions for each run. Later publications affect later
runs, not the meaning of an existing record. The platform's context/version reference lets your team
return to the publication it used.

A finding is a proposed judgment about the artifact, not an automatic change to your standard.
Ambiguous guidance can remain unresolved. Use that evidence and the structured feedback in ContextRail
to decide whether the code, the guidance or the assessment needs correction. Experts retain publication
authority; developer inaction does not automatically retire a standard.

Every enumerated context receives a status, including unfinished work. That accounting is not a claim
that every obligation in a long standard was discovered or independently verified. See
[how to interpret results](review-results.md).
