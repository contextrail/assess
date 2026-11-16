# Results and next actions

[Documentation index](README.md) · [Assess overview](../README.md)

Start with the outcome, findings and open questions. A successful execution, a policy-permitted
exit and a fully resolved assessment are different things.

## What should I do with this result?

| What you see                     | What it means                                                                    | Your next action                                                                                                 |
| -------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Supported binding violation      | Validation found a contradiction of an applicable standard                       | Inspect the cited rule and source; fix the artifact or challenge the assessment with concrete evidence           |
| Guidance departure               | The artifact departs from selected guidance                                      | Consider the explanation and tradeoff; it is not a binding violation                                             |
| Unresolved                       | A decisive artifact fact is unavailable, or the applicable guidance is ambiguous | Supply the missing source/context, investigate the implementation, or ask the guidance owner to clarify the rule |
| Observed / no concern identified | The assessor recorded an observation without a confirmed finding                 | Use it as a bounded observation; it is not independently verified whole-standard compliance                      |
| Not evaluated / execution failed | The assessment could not finish usable work                                      | Inspect diagnostics and resolve the failure before relying on coverage                                           |

A context can have both confirmed findings and unresolved questions. The unresolved status does not
hide the findings or prevent a binding violation from blocking under your policy. A missing fact is
not automatically a violation.

If a finding is wrong, explain the applicable exception, missing implementation path or contrary
source evidence. With PR context enabled, a later run can use that explanation to focus inspection.
A comment, dismissal or resolved thread does not by itself waive the standard or prove a fix.

## What Assess judges

The subject is the proposed artifact: code, configuration, workflows and documentation. Supporting
source at the pinned revisions is available for inspection. The selected published standards define
what matters; a topic mentioned in a standard does not create a demand for exhaustive assurance.

For example, a workflow that bypasses a required gate is an artifact concern. Whether today's PR
checks are green is outside this assessment. A broken keyboard handler can contradict an interaction
standard; absence of a screenshot alone is not a defect. Runtime evidence may help establish an
artifact property, but Assess does not run your tests or certify deployment readiness.

Keep CI and deployment execution checks as their own gates. Findings and unresolved questions here
concern the proposed implementation, not proof that an operator performed a process.

## Understand coverage and validation

Each enumerated context has its own recorded outcome and exact publication version. An incomplete
scope remains incomplete; the tool does not silently claim that missing contexts were assessed.

The assessor records observations, applicability reasoning, source evidence and possible concerns.
Each nominated concern receives a focused independent validation. Thus **20 standards assessed** and
**four concerns checked** describe different work; the other 16 may contain observations without
independent validation. Neither count proves that every obligation in a standard was discovered.

The detailed report and PR ledger use the same assessment labels. A recorded observation is not
“unexamined.” Truly missing or unfinished assessment work remains visible instead of being counted
as acceptance.

Current assessments do not assign a numeric confidence score. Observed and unresolved outcomes leave
scores null deliberately; reports say **not scored under this method**. Confirmed violations can carry
derived adherence `0`; that is an outcome encoding, not a percentage. Genuinely missing results remain
unknown. Citations establish provenance, not that the model's interpretation is correct.

## Interpret judgments and exit codes

Choose `--enforcement advisory|required|strict`, or the Action's `enforcement` input. Default: `advisory`.

| Recorded outcome                                                     | advisory | required | strict |
| -------------------------------------------------------------------- | -------- | -------- | ------ |
| Supported binding violation                                          | 0        | 1        | 1      |
| Unresolved evidence, without a supported violation                   | 0        | 0        | 1      |
| No binding violations or unresolved evidence                         | 0        | 0        | 0      |
| Execution failed or the required usable report could not be produced | 2        | 2        | 2      |

Guidance departures remain suggestions. An observed entry is not an evidence gap merely because it
lacks independent compliance certification. A finished assessment can leave a substantive question
unresolved; a timeout, invalid handoff or unfinished assessment is an execution failure.

- **0:** policy permits continuation; findings or questions may still exist in advisory mode.
- **1:** the selected policy requires attention.
- **2:** execution failed; inspect retained partial results and diagnostics.

Use branch protection to require a `required` or `strict` job when that is your team's policy. Leave
advisory optional if you do not want a merge gate. No mode changes which standards are assessed or
what evidence is retained.

The effective policy is saved with the run. The local `decision.reviewExit` preserves the policy
judgment while `decision.exitCode` reflects process failure if one occurs. A ContextRail feedback
submission failure is reported separately and does not erase the local result or change its exit.
See [operations](operations.md) if execution or feedback failed.

## PR comments and inline corrections

Published packages display a 22px ContextRail symbol beside the heading, with light/dark variants
served from `assets/brand/` in the public Assess repository at the exact package release tag.
The exporter includes those assets before npm publication; no site login or alpha-site availability
is needed. Local monorepo builds keep the text heading because they have no corresponding public
release assets. Existing release tags must not be moved when changing the artwork.

The PR comment leads with the assessment outcome and enforcement mode, followed by a short
source-grounded change summary. Confirmed findings and unresolved artifact questions stay visible,
with corrections and pinned source links where available. A finished assessment with questions is distinct
from an execution failure; failures retain partial findings without presenting them as a complete assessment.

A compact coverage line stays visible. “No concern identified” describes an observation, not verified
compliance. **Standards and evidence** expands the per-criterion ledger, full unresolved explanations,
and additional human review focus. **Run details** holds cost, timing, identities and recent history.
The Action summary and artifact bundle retain the detailed assessment and operational diagnostics.
The comment omits the duplicate file inventory and does not infer resolved findings between runs.

The summary is reader orientation, separate from adherence and enforcement. Only an accepted,
source-checked narrative is displayed; its opening two sentences appear in the main comment.
Historical reports can retain human and operational follow-ups in the full report. Current
artifact-only reviews retain out-of-scope operational nominations in raw audit records without
turning them into developer action items.

Only verified binding violations are produced as eligible inline findings by this method; guidance remains in the summary. Historical reports may retain the older behavioral-defect category. The current assessor does not conduct unrelated bug hunting.

Set `inline-comments: 'true'` alongside `post-comment: 'true'` to publish verified
findings on exact diff lines. Eligible corrections include GitHub suggestion blocks that
the developer can apply. Suggestions require independently accepted correction evidence,
an exact matching head range and valid diff anchor; source inspection is not test execution.
Uncertain, overlapping, deletion-only or multifile corrections remain explanatory findings.
Nothing applies patches or commits automatically.

Inline publication uses COMMENT reviews, retains existing threads and deduplicates matching
findings. It does not approve, request changes, resolve threads or treat a human resolution
as proof of a fix. Incomplete duplicate lookup stops new inline writes. Unanchorable findings,
rejected batches and items beyond the bounded inline batch remain in the main report.
A superseded comparison is attributed to its reviewed commit, not claimed as current.

Reusable CLI adapters are `contextrail-assess github prepare` and `github publish`;
see `--help` for required paths/options. `github publish --dry-run` creates inspectable
payloads without network writes. Provider credentials do not reach these adapter commands,
and GitHub write tools are never exposed to models.

The full change inventory remains in the audit report rather than the PR comment.

## Review history and conversational context

The bot comment keeps a versioned, bounded state record in an HTML comment and a visible
history table showing the latest three runs in collapsed run details. The hidden state retains ten reported runs with GitHub run/attempt links, unique CLI run IDs, exact work
revisions, requested model, package/reviewer versions, execution/completion, finding/unresolved
counts, duration and reported cost. Rerunning the same attempt replaces its row; later attempts
add rows. A failed provider run does not erase the last finished assessment. That snapshot
retains up to 30 criterion identities/publication versions and short findings/unresolved reasons.
Older rows, skipped/comment-write failures and runs before adoption may be absent; the table
links to GitHub's full workflow history. This is a convenience cache, not an exhaustive ledger.

Hidden comments are readable, mutable PR content, not private storage, a signature or proof
that a review passed. The Action reads only the matching bot-owned record, validates its
version/repository/PR/reviewer and bounds its contents. Unsupported or corrupt state is treated
as unavailable rather than trusted. PR comments persist independently of artifact retention.

With `pr-context: 'true'`, a trusted read-only step collects recent 20 issue comments, 10 submitted
reviews (including dismissed states), 10 dismissal events with reasons, and 10 native review threads with five replies each,
including resolution/outdated state and authorship. At most 80 excerpts are supplied, with bodies capped at 1000 characters.
The matching CLI's `--pr-context PATH` reads a schema-validated file capped at 200 KiB, bound to
the current base/head/reviewer and reported GitHub repository. Prior assessment/head identities,
criterion versions and up to 100 changed paths since that head are included when available.
Missing history, pagination/truncation, inaccessible revisions and non-forward/force-push
comparisons are explicit. There is no whole-repository snapshot mode or automatic new review trigger.

Context is passed as a separate untrusted data field, never as caller purpose or governing
instructions. Native approval, dismissal or thread resolution does not waive a Standard or
prove a fix. The reviewer still accounts for every current criterion using current pinned
source/publications; historical outcomes never pre-populate current results or change exit policy.
Developer feedback can focus inspection and explain an addressed finding only with fresh evidence.
Work, guidance and model revisions remain distinct; changed judgment alone does not establish drift.
No tools for changing code, resolving threads or approving a PR are added.

Opting in sends these PR excerpts and historical judgments to the selected model. GitHub tokens
stay in trusted Action steps; known credentials are redacted before the model handoff. The raw
collector file is not uploaded. A validated/redacted context snapshot and hash accompany the
local run/audit; conversation bodies are excluded from the minimal ContextRail report projection.
The health summary identifies supplied discussion/history coverage. Keep the Action SHA and package version qualified together when upgrading.

For timing, cost, logs and evidence files, see [operations](operations.md).
