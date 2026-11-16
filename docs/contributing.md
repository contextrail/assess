# Contributing and releases

[Documentation index](README.md) · [Assess overview](../README.md)

ContextRail maintains Assess. Development and release selection happen upstream; the public repository is a one-way distribution mirror.

## Where to make changes

Propose changes for upstream incorporation. Direct edits in the public mirror can block the next
export. The package, CLI, Action and documentation are maintained together.

The package root `README.md` is the canonical overview and is exported as the public README.
The shared `docs/` directory is the detailed documentation source. Keep task links and
examples valid in the exported repository and installed package. Public docs must not depend
on private repository paths, services, working notes or uncommitted plans.

## Validate a public checkout

```sh
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build
npm pack --dry-run
```

In the upstream monorepo, follow its `AGENTS.md` and run `pnpm -w check`.
That gate includes export checks. Package-local builds remain available for normal development.
A built tarball or passing fixture does not prove that a version was published or that a live
provider integration works.

## Export and publication

Upstream semantic-release selects the public version. The development manifest's version is
not a registry release. Export uses an explicit file inventory; new public docs must be listed
there. The npm package's `files` list also includes docs so installed README links remain usable.
`release.json` binds the selected version and channel to the upstream commit; the public Action
commit is a separate immutable identity.

After publication, a separate job with Contents write permission waits for npm metadata and the
tarball, then advances `v<major>-alpha` or stable `v<major>`. It never moves a channel backward
when an older release is retried. These are lightweight tags, not GitHub Releases; exact version
tags remain immutable. Failed or pending publication leaves the channel unchanged.

If promotion times out while npm validates the upload, rerun the failed promotion job after the
package becomes available; do not republish an existing npm version. Publication jobs are serialized.
Tag rules must permit the intended floating channels while protecting exact release tags.
Consumers following a channel need no variable update. Exact tag/SHA consumers opt into each upgrade.
The README badges track npm's `latest` and `alpha` dist-tags, not the Git major channels.

See [Action qualification](github-actions.md#qualify-and-operate-a-consumer) for the live
integration check and [architecture](architecture.md) before changing the harness.
