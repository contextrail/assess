# Assessment lifecycle and contracts

[Documentation index](README.md) · [Assess overview](../README.md)

For maintainers and agents changing the harness. Setup and usage are covered in [getting started](getting-started.md).

## Lifecycle

1. **Prepare:** resolve fixed commits, retrieve the published reviewer and governing contexts, and write an evidence pack.
2. **Observe:** one coherent assessment reads pinned source and records independently answerable observations, possible standards concerns, assumptions and decisive unknowns for every selected context.
3. **Validate concerns:** independently examine each nominated concern against its original governing publication and cited source. Confirm a violation only when both applicability and contradiction are established. Keep missing evidence and ambiguous guidance distinct from violations.
4. **Report:** code derives outcomes, consolidates equivalent same-duty corrections, applies policy, persists artifacts and delivers configured feedback. An optional final pass checks the reader change summary separately.

The selected reviewer skill and original pinned contexts retain authority. Reviewer instructions may
narrow the investigation, but this is standards adherence auditing, not unrestricted bug hunting.
Each additional observation cites the original passage and pinned source; code supplies identities
and quotations from selected evidence segments. Accepted context groups are immutable and remain
available when a sibling group needs repair. Checkpoints retain observations and concern decisions.
An older judgment-based checkpoint cannot be silently interpreted as an observation-based one.

A no-concern observation is **observed**, not independently validated compliance. Structural coverage
means each selected context has observations; it does not prove every obligation was discovered.
Verification counters describe nominated concerns, separately from context coverage. Only confirmed
artifact concerns become findings. Conditional applicability remains a question. Actual execution of external operations is outside the audit; source inspection assesses the
mechanisms that implement applicable operational requirements.

The assessment allows 60 provider turns and 50 source-tool calls per response. Each focused validation
and optional summary session allows 12 provider turns. Excess reads receive
retry feedback rather than discarding accepted work. Each source tool retains its own path/range/size
bounds. The configured whole-review deadline is shared, across assessment and validation.
Global caller turn/token/time limits still apply. Validators receive a focused packet for their
concern and can read supporting code for specific missing facts; they do not receive every other
standard's assessment. The default transport, model settings, request retries and diagnostics are
shared with the production CLI and Action.

## Choose the reviewer and comparison

`--reviewer` takes a published `skill://...` ID, not a display name. Its instructions
provide the review lens; explicit context and domain selections plus required
context prerequisites determine the expected scope. The CLI retrieves exact
publication versions and reports missing, inaccessible or unsupported prerequisites.
Changing publications affects future runs, not the versions already recorded.

The reviewer contract consists of skill identity/metadata, review instructions,
`content.reviewer.selections` (explicit context IDs and domain selections with
`includeDescendants`), and optional supporting resources. Instruction-only reviewers
use the same contract with no assessment selections. Empty scope stays instruction-only.

`--repo DIR` defaults to the current directory. `--base REF` and `--head REF` are
required and resolve once to fixed commit and tree IDs. The comparison is base
commit → head commit; it does not automatically choose a merge base. Use exact
commit SHAs for automation. Fetch both histories and their blobs before running;
partial clones can leave supporting source unavailable. Later branch movement,
working-tree edits and index changes do not alter the review. The source tools read
both snapshots and unchanged supporting files, with bounded responses and
continuations. They do not execute repository scripts, tests, hooks or model shell
commands. Binary files, submodule contents and conventional credential files have
explicit source-access limits; this is a text/source review, not runtime testing.

To check retrieval and scope without calling a model, replace `run` with
`prepare` and omit provider/model arguments. Inspect `state.json` and its gaps.
Preparation exit 0 means the scope was prepared; entries remain **not evaluated**.
Preparation exits 2 for invalid configuration or incomplete retrieval and never 1.

## Evidence and final corrections

The assessment boundary is the proposed artifact, not general operational assurance. Each applicable
check relates a changed behavior to a governing obligation. Missing evidence makes that artifact
judgment unresolved only when it is decisive for the claim under review. Source-visible defects and
contradictions remain findings without requiring runtime reproduction. The current PR author's process, CI status and execution of external operations are not assessment subjects.
Independent validation separates irrelevant operational questions from relevant external evidence
limitations. The latter become nonblocking follow-ups with their governing version and boundary evidence,
not compliance scores. An assessor's scope label alone cannot clear a concern. Verification challenges applicability and proportionality
as well as supporting evidence, including whether a proposed follow-up actually conceals a code defect.

For configurable code, judge the source-controlled selector, validation, defaults and authority over
inputs. An unknown deployed value alone is outside the audit. Unavailable external dependency internals
are a recorded external limitation. Missing or unread implementation within the pinned repository remains
an unresolved artifact question; source-visible violations still require correction. Prior reviewer requests
are reassessed against this boundary; they do not become additional governing requirements.

Assessment produces observations and nominates concerns against the original pinned standards.
A focused validation session checks each nominated concern: its governing obligation, applicability,
source evidence and proposed correction. A decisive unknown must nominate a concern; it cannot
bypass validation by appearing only in an unknowns list. Final check records reflect the validator
decision while original proposals remain available for audit. Up to two concerns run concurrently. No-concern observations
remain observed; they are not independently certified as compliant. Missing decisive evidence remains
unresolved, without suppressing a separately supported violation in the same standard.

The assessment receives the evidence pack and can read permitted files in either pinned snapshot.
Current CI check status and the reviewer runtime identity are omitted from assessment and concern
validation inputs; the original PR context remains in the run audit. PR intent, discussion and
history remain available as context, not additional governing authority.
Each verifier receives the governing publication, reviewer constraints, nominated observation and cited
source fragments. It can read additional supporting code. Repository text cannot waive governing requirements.
Code extracts exact citations, generates identities and derives policy outcomes. Decisions and observations
remain in sealed local artifacts; metadata feedback identifies this method as `candidate-adherence-v3`.

If assessment supplies a change summary, a separate bounded summary session checks its evidence.
An unavailable or unsupported summary is omitted without invalidating completed standards results.
The summary explains changed behavior and review focus; it creates no additional requirements.

Model citations select `{ref, startSegment, endSegment}` from numbered evidence segments,
using inclusive indices relative to that evidence record. Code extracts the exact quotation,
character offsets and source location; models do not supply quotation text. An explicit range
also identifies an occurrence when text repeats. Canonical reports retain quotations and provenance.
Within each model session, short `context_N` and `evidence_N` handles identify the assigned
contexts and available evidence. Exact lookup restores canonical identities before validation;
unknown handles remain invalid. Audit artifacts retain canonical identities. Assessment result
citations are derived from the checks' governing passages and source references, so the model
does not have to repeat the same evidence in a separate result field.
Model inputs carry citation references and source/publication locations rather than repeated report
quotations; original evidence is supplied separately and remains available through the read tools. Code supplies revision
metadata from the current context state. The assessor supplies observations and nominated concerns. A focused verifier supplies the concern decision, applicability, duty strength and any accepted correction. Code derives aggregate outcomes without inventing confidence or treating absent concerns as compliance.
Canonical validators still check evidence, authority and consistency with findings.
Code also supplies actual package/Node/model identities and fixed comparison SHAs. When GitHub
context is collected, exact-head check/status receipts distinguish observed results from unavailable
API access. Neither runtime identity nor passing check metadata proves package safety, deployment
readiness or compliance with every governed requirement. Repository authority remains the pinned
repository's declared authority, not mutable PR discussion.
Selection failures identify the precise field and safe evidence identity in correction feedback
and diagnostics. Source bodies stay out of routine diagnostics. Selection bounds, exact text,
governing authority and independent verification remain enforced without extra correction rounds.

## Recovery and validation

The assessment can submit multiple ready context observation groups in one tool call. The advertised
schema describes the full contract; server-side validation handles each group independently so an
invalid group does not discard valid siblings. Accepted groups are immutable; identical replay is
acknowledged, while changed replay is rejected. Only remaining groups need correction. Retained
partial progress is evidence of an incomplete phase, not a verified assessment.

Each nominated concern has an independent focused validation record, with two workers sharing the
overall budget. A failure does not erase completed sibling decisions. Completion requires a decision
for every nominated concern. Resume verifies immutable source, publication and phase identities and
reuses accepted concern decisions; it never silently upgrades old judgment-based checkpoints.

Invalid submissions share a correction round; three invalid rounds without newly accepted work
stop the session. Accepted progress resets the allowance. Reads and duplicate submissions do not.
Every attempt still consumes the configured execution budget. Use one exact committed file for
scoped literal search, or omit the path for bounded whole-tree navigation.

Provider recovery allows at most two additional attempts per failed request, with 250ms then 500ms
backoff, for transport failures marked retryable by the SDK, HTTP 408/429/5xx and response
parsing/validation failures. It repeats only the failed model request with the existing conversation;
completed tools and accepted assessments are not replayed. A successful response resets the retry
allowance for the next request. Each request consumes the original
call/time/token budget, and cancellation interrupts the backoff. Authentication, credit-limit and
configuration failures stop immediately. Recovery is separate from submission correction and
unfinished-assessment continuation. `provider_retry`, `provider_recovered` and
`provider_retry_exhausted` events appear at info/debug verbosity. See [diagnostics](operations.md#health-logging-and-cost).
The observed token cutoff can overshoot by one call and is not a dollar ceiling.
Execution completion, assessment coverage, verification coverage and policy acceptance
are separate fields. Schema validity and exact citations do not prove a judgment correct.

Each phase persists input/output identities and evidence references. [Artifacts and resume](operations.md#inspect-evidence-and-resume) describes how these records support recovery.

The package exports `prepareAssessment`, `runAssessment`, `FixedSnapshotSource`, `McpPublishedReader`, provider constructors and policy helpers. Shipped type declarations describe their arguments; these APIs use the CLI's fixed-publication and source boundaries.
