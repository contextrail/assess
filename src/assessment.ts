import { z } from 'zod';
import { changeSummarySelectionSchema } from './change-summary.js';
import { citationSchema, selectionSchema, type Citation, type EvidenceLedger } from './evidence.js';
import { digest } from './prepare.js';
import {
    modelResultSchema,
    resultSchema,
    validateResult,
    type AcceptedResult,
    type AssessmentEntry,
} from './results.js';
import { exactIds, validatePlan, type PlanEntry } from './planning.js';
const checkSchema = z.strictObject({
    checkId: z.string(),
    disposition: z
        .enum(['evaluated', 'not_applicable', 'unresolved'])
        .describe(
            'Judgment of the pinned artifact implementation. Pending execution, deployment or rendered verification belongs in followUps. Unresolved requires a missing fact decisive for the source behavior being judged.',
        ),
    explanation: z.string().min(1),
    sourceRefs: z.array(citationSchema),
    contraryEvidence: z.string(),
    missingEvidence: z.string(),
});
/** Follow-ups are pending human work, not artifact findings or proof of readiness. */
const followUpSchema = z.strictObject({
    kind: z.enum(['human_check', 'operational_check']),
    required: z
        .boolean()
        .describe('True only for an explicit mandatory operational obligation in the cited publication.'),
    explanation: z.string().min(1),
    action: z.string().min(1),
    passage: citationSchema,
    sourceRefs: z.array(citationSchema),
});
const replacementSchema = z.strictObject({
    path: z.string(),
    blob: z.string(),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    before: z.string(),
    replacement: z.string(),
});
export const assessmentSchema = z.strictObject({
    assessments: z.array(
        z.strictObject({
            result: resultSchema,
            followUps: z.array(followUpSchema).default([]),
            checks: z.array(checkSchema),
            findings: z.array(
                z.strictObject({
                    classification: z.enum(['binding_violation', 'behavioral_defect', 'guidance_departure']),
                    checkIds: z.array(z.string()).min(1),
                    locationRefs: z.array(citationSchema).min(1),
                    explanation: z.string().min(1),
                    consequence: z.string().min(1),
                    correction: z.string().min(1),
                    limitations: z.array(z.string()),
                    proposedReplacement: replacementSchema.nullable(),
                }),
            ),
        }),
    ),
});
/** One investigation authors passage-backed checks together with each criterion judgment. */
export const assessmentSubmissionSchema = z.strictObject({
    assessments: z
        .array(
            z.strictObject({
                result: resultSchema,
                followUps: z.array(followUpSchema).default([]),
                checks: z
                    .array(
                        checkSchema
                            .omit({ checkId: true })
                            .extend({ passage: citationSchema, interpretation: z.string().min(1) }),
                    )
                    .min(1),
                findings: z.array(
                    assessmentSchema.shape.assessments.element.shape.findings.element
                        .omit({ checkIds: true })
                        .extend({ checkIndices: z.array(z.number().int().nonnegative()).min(1) }),
                ),
            }),
        )
        .min(1)
        .max(1),
});
export const investigationSubmissionSchema = assessmentSubmissionSchema.extend({
    assessments: z
        .array(
            assessmentSubmissionSchema.shape.assessments.element.extend({
                result: modelResultSchema(),
            }),
        )
        .min(1)
        .max(1),
});
const modelAssessment = investigationSubmissionSchema.shape.assessments.element.extend({
    followUps: z.array(followUpSchema.extend({ passage: selectionSchema, sourceRefs: z.array(selectionSchema) })),
    checks: z
        .array(
            assessmentSubmissionSchema.shape.assessments.element.shape.checks.element.extend({
                passage: selectionSchema,
                sourceRefs: z.array(selectionSchema),
            }),
        )
        .min(1),
    findings: z.array(
        assessmentSubmissionSchema.shape.assessments.element.shape.findings.element.extend({
            locationRefs: z.array(selectionSchema).min(1),
        }),
    ),
});
export const assessmentSelectionSchema = investigationSubmissionSchema.extend({
    changeSummary: changeSummarySelectionSchema.nullable(),
    assessments: z.array(modelAssessment),
});
export function validateAssessmentSubmission(
    input: unknown,
    entries: AssessmentEntry[],
    ledger: EvidenceLedger,
    structured: Record<string, Array<{ path: string; value: unknown }>> = {},
): AssessmentProposal {
    const candidate = assessmentSubmissionSchema.parse(input).assessments[0]!;
    const entry = entries.find((e) => e.assessmentId === candidate.result.assessmentId);
    if (!entry) throw new Error('foreign_assessment_id');
    const plan = validatePlan(
        {
            entries: [
                {
                    assessmentId: entry.assessmentId,
                    applicability:
                        candidate.result.disposition === 'not_applicable'
                            ? 'not_applicable'
                            : candidate.result.disposition === 'unresolved'
                              ? 'unresolved'
                              : 'applicable',
                    reason: candidate.result.explanation,
                    workUnit: 'all',
                    checks: candidate.checks.map((c) => ({ passage: c.passage, interpretation: c.interpretation })),
                    surfaces: [],
                    evidenceNeeds: [],
                },
            ],
        },
        [entry],
        ledger,
        structured,
    );
    return validateAssessments(
        {
            assessments: [
                {
                    result: candidate.result,
                    followUps: candidate.followUps,
                    checks: candidate.checks.map((c, i) => {
                        const { passage: _p, interpretation: _i, ...value } = c;
                        return { ...value, checkId: plan.entries[0]!.checks[i]!.checkId };
                    }),
                    findings: candidate.findings.map((f) => {
                        const { checkIndices, ...value } = f;
                        if (
                            new Set(checkIndices).size !== checkIndices.length ||
                            checkIndices.some((i) => i >= candidate.checks.length)
                        )
                            throw new Error('foreign_finding_check');
                        return { ...value, checkIds: checkIndices.map((i) => plan.entries[0]!.checks[i]!.checkId) };
                    }),
                },
            ],
        },
        plan.entries,
        [entry],
        ledger,
    )[0]!;
}
export function revalidateProposal(
    proposal: AssessmentProposal,
    entries: AssessmentEntry[],
    ledger: EvidenceLedger,
    structured: Record<string, Array<{ path: string; value: unknown }>> = {},
): AssessmentProposal {
    const quote = (c: Citation) => ({ ref: c.ref, quote: c.quote, start: c.start, end: c.end });
    const { revision: _revision, ...result } = proposal.result;
    const validated = validateAssessmentSubmission(
        {
            assessments: [
                {
                    result: { ...result, citations: proposal.result.citations.map(quote) },
                    followUps: (proposal.followUps ?? []).map(
                        ({ assessmentId: _id, verified: _verified, ...followUp }) => ({
                            ...followUp,
                            passage: quote(followUp.passage),
                            sourceRefs: followUp.sourceRefs.map(quote),
                        }),
                    ),
                    checks: proposal.checks.map((c) => ({
                        passage: quote(c.passageRef),
                        interpretation: c.interpretation,
                        disposition: c.disposition,
                        explanation: c.explanation,
                        sourceRefs: c.sourceRefs.map(quote),
                        contraryEvidence: c.contraryEvidence,
                        missingEvidence: c.missingEvidence,
                    })),
                    findings: proposal.findings.map((f) => ({
                        classification: f.classification,
                        checkIndices: f.checkIds.map((id) => proposal.checks.findIndex((c) => c.checkId === id)),
                        locationRefs: f.locationRefs.map(quote),
                        explanation: f.explanation,
                        consequence: f.consequence,
                        correction: f.correction,
                        limitations: f.limitations,
                        proposedReplacement: f.proposedReplacement
                            ? {
                                  path: f.proposedReplacement.path,
                                  blob: f.proposedReplacement.blob,
                                  startLine: f.proposedReplacement.startLine,
                                  endLine: f.proposedReplacement.endLine,
                                  before: f.proposedReplacement.before,
                                  replacement: f.proposedReplacement.replacement,
                              }
                            : null,
                    })),
                },
            ],
        },
        entries,
        ledger,
        structured,
    );
    if (digest(validated) !== digest(proposal)) throw new Error('resume_proposal_changed');
    return validated;
}
/** Canonical result evidence is the union of the checks the model actually authored. */
export function deriveAssessmentCitations(input: unknown, entries: AssessmentEntry[]) {
    const submitted = investigationSubmissionSchema.parse(input).assessments[0]!;
    const citations = [
        ...new Map(
            submitted.checks
                .flatMap((check) => [check.passage, ...check.sourceRefs])
                .map((citation) => [digest(citation), citation]),
        ).values(),
    ];
    const entry = entries.find((entry) => entry.assessmentId === submitted.result.assessmentId);
    if (!entry) throw new Error('foreign_assessment_id');
    const revisionOf = 'revision' in entry.result ? entry.result.revision : null;
    const classifications = submitted.findings.map((finding) => finding.classification);
    const knownFinding =
        (['binding_violation', 'behavioral_defect', 'guidance_departure'] as const).find((classification) =>
            classifications.includes(classification),
        ) ?? 'none';
    // A known evidence gap cannot become a pass through a conflicting aggregate label.
    const disposition = submitted.checks.some((check) => check.disposition === 'unresolved')
        ? 'unresolved'
        : submitted.result.disposition;
    const finding = disposition === 'unresolved' ? 'none' : knownFinding;
    const confidence = disposition === 'unresolved' ? null : submitted.result.confidence;
    const adherence = disposition === 'evaluated' ? (submitted.findings.length ? 0 : 2) : null;
    const aggregate = (field: 'consequence' | 'correction') =>
        [...new Set(submitted.findings.map((finding) => finding[field].trim()).filter(Boolean))].join('\n');
    const candidate = {
        ...submitted,
        result: {
            ...submitted.result,
            disposition,
            citations,
            revisionOf,
            confidence,
            adherence,
            finding,
            consequence: aggregate('consequence'),
            correction: [
                ...new Set(
                    [
                        ...submitted.findings.map((finding) => finding.correction.trim()),
                        ...(disposition === 'unresolved'
                            ? submitted.checks
                                  .filter((check) => check.disposition === 'unresolved')
                                  .map((check) => check.missingEvidence.trim())
                            : []),
                    ].filter(Boolean),
                ),
            ].join('\n'),
        },
    };
    return candidate;
}
export class AssessmentAccumulator {
    private readonly accepted = new Map<string, AssessmentProposal>();
    constructor(
        private readonly entries: AssessmentEntry[],
        private readonly ledger: EvidenceLedger,
        private readonly structured: Record<string, Array<{ path: string; value: unknown }>> = {},
        seed: AssessmentProposal[] = [],
    ) {
        for (const proposal of seed) {
            const validated = revalidateProposal(proposal, entries, ledger, structured);
            if (this.accepted.has(validated.result.assessmentId)) throw new Error('assessment_coverage_mismatch');
            this.accepted.set(validated.result.assessmentId, validated);
        }
    }
    submit(input: unknown): AssessmentProgress {
        const candidate = deriveAssessmentCitations(input, this.entries);
        const id = candidate.result.assessmentId;
        if (!this.entries.some((e) => e.assessmentId === id)) throw new Error('foreign_assessment_id');
        if (this.accepted.has(id))
            return {
                complete: this.remaining().length === 0,
                newlyAccepted: [],
                alreadyAccepted: [id],
                remaining: this.remaining(),
            };
        this.accepted.set(
            id,
            validateAssessmentSubmission({ assessments: [candidate] }, this.entries, this.ledger, this.structured),
        );
        return {
            complete: this.remaining().length === 0,
            newlyAccepted: [id],
            alreadyAccepted: [],
            remaining: this.remaining(),
        };
    }
    remaining() {
        return this.entries.filter((e) => !this.accepted.has(e.assessmentId)).map((e) => e.assessmentId);
    }
    snapshot(): AssessmentProposal[] {
        return this.entries.flatMap((e) => {
            const p = this.accepted.get(e.assessmentId);
            return p ? [structuredClone(p)] : [];
        });
    }
}
export type AssessmentProgress = {
    complete: boolean;
    newlyAccepted: string[];
    alreadyAccepted: string[];
    remaining: string[];
};
export type CheckAssessment = {
    checkId: string;
    assessmentId: string;
    passageRef: Citation;
    interpretation: string;
    disposition: 'evaluated' | 'not_applicable' | 'unresolved';
    sourceRefs: Citation[];
    explanation: string;
    contraryEvidence: string;
    missingEvidence: string;
    verified: boolean;
};
export type AssessmentFinding = {
    findingId: string;
    sourceFindingIds?: string[];
    assessmentIds: string[];
    checkIds: string[];
    classification: 'binding_violation' | 'behavioral_defect' | 'guidance_departure';
    locationRefs: Citation[];
    explanation: string;
    consequence: string;
    correction: string;
    limitations: string[];
    proposedReplacement?: z.infer<typeof replacementSchema> & { verified: boolean };
    verified: boolean;
};
export type AssessmentFollowUp = Omit<z.infer<typeof followUpSchema>, 'kind' | 'passage' | 'sourceRefs'> & {
    // Only independent concern projection creates external evidence follow-ups.
    kind: 'human_check' | 'operational_check' | 'external_evidence';
    externalEvidence?: {
        kind: 'external_dependency' | 'operational_state' | 'business_record';
        subject: string;
    };
    assessmentId: string;
    passage: Citation;
    sourceRefs: Citation[];
    verified: boolean;
};
export type AssessmentProposal = {
    observations?: import('./candidate.js').CandidateObservation[];
    result: AcceptedResult;
    checks: CheckAssessment[];
    findings: AssessmentFinding[];
    followUps?: AssessmentFollowUp[];
};
function validateFollowUps(
    input: z.infer<typeof followUpSchema>[],
    entry: AssessmentEntry,
    ledger: EvidenceLedger,
    prefix: Array<string | number>,
): AssessmentFollowUp[] {
    return input.map((followUp, index) => {
        if (followUp.required && followUp.kind !== 'operational_check')
            throw new Error('required_follow_up_must_be_operational');
        const path = [...prefix, 'followUps', index];
        const passage = ledger.cite(followUp.passage, [...path, 'passage']);
        const provenance = passage.provenance;
        if (
            provenance.kind !== 'publication' ||
            provenance.nodeId !== entry.nodeId ||
            provenance.version !== entry.version ||
            provenance.contentHash !== entry.contentHash
        )
            throw new Error('follow_up_governing_publication_required');
        const sourceRefs = followUp.sourceRefs.map((ref, i) => ledger.cite(ref, [...path, 'sourceRefs', i]));
        if (!sourceRefs.some((ref) => ref.provenance.kind === 'source'))
            throw new Error('follow_up_source_evidence_required');
        return { ...followUp, assessmentId: entry.assessmentId, passage, sourceRefs, verified: false };
    });
}
export function validateAssessments(
    input: unknown,
    plan: PlanEntry[],
    entries: AssessmentEntry[],
    ledger: EvidenceLedger,
): AssessmentProposal[] {
    const parsed = assessmentSchema.parse(input);
    exactIds(
        parsed.assessments.map((a) => a.result.assessmentId),
        plan.map((e) => e.assessmentId),
    );
    return parsed.assessments.map((a, assessmentIndex) => {
        const p = plan.find((p) => p.assessmentId === a.result.assessmentId)!;
        const prefix = ['assessments', assessmentIndex];
        const result = validateResult(a.result, entries, ledger, [...prefix, 'result']);
        exactIds(
            a.checks.map((c) => c.checkId),
            p.checks.map((c) => c.checkId),
        );
        const checks = a.checks.map((c, checkIndex) => {
            const original = p.checks.find((o) => o.checkId === c.checkId)!;
            const refs = c.sourceRefs.map((ref, refIndex) =>
                ledger.cite(ref, [...prefix, 'checks', checkIndex, 'sourceRefs', refIndex]),
            );
            if (c.disposition === 'evaluated' && !refs.some((r) => r.provenance.kind === 'source'))
                throw new Error('check_source_evidence_required');
            if (c.disposition === 'unresolved' && !c.missingEvidence.trim())
                throw new Error('missing_evidence_need_required');
            return { ...original, ...c, sourceRefs: refs, verified: false };
        });
        if (result.disposition !== 'unresolved' && checks.some((c) => c.disposition === 'unresolved'))
            throw new Error('unresolved_required_check');
        if (result.disposition === 'not_applicable' && checks.some((c) => c.disposition !== 'not_applicable'))
            throw new Error('nonapplicability_check_mismatch');
        if (result.finding !== 'none' && !a.findings.length) throw new Error('distinct_finding_required');
        if (result.disposition !== 'unresolved' && result.finding === 'none' && a.findings.length)
            throw new Error('finding_aggregate_mismatch');
        const blocks = (value: string) => value === 'binding_violation' || value === 'behavioral_defect';
        if (
            result.disposition !== 'unresolved' &&
            a.findings.some((f) => blocks(f.classification)) !== blocks(result.finding)
        )
            throw new Error('blocking_finding_aggregate_mismatch');
        const findings = a.findings.map((f, findingIndex) => {
            if (f.checkIds.some((id) => !p.checks.some((c) => c.checkId === id)))
                throw new Error('foreign_finding_check');
            const refs = f.locationRefs.map((ref, refIndex) =>
                ledger.cite(ref, [...prefix, 'findings', findingIndex, 'locationRefs', refIndex]),
            );
            if (!refs.some((r) => r.provenance.kind === 'source')) throw new Error('finding_source_required');
            const replacement = f.proposedReplacement;
            if (
                replacement &&
                (replacement.endLine < replacement.startLine || replacement.endLine - replacement.startLine >= 20)
            )
                throw new Error('invalid_replacement_range');
            return {
                ...f,
                findingId: `finding:${digest([
                    a.result.assessmentId,
                    [...f.checkIds].sort(),
                    refs
                        .map((r) => [r.ref, r.quote, r.start, r.end])
                        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
                    f.classification,
                    f.explanation.trim().replace(/\s+/gu, ' '),
                    f.consequence.trim().replace(/\s+/gu, ' '),
                    f.correction.trim().replace(/\s+/gu, ' '),
                    replacement,
                ]).slice(7)}`,
                assessmentIds: [a.result.assessmentId],
                locationRefs: refs,
                proposedReplacement: replacement ? { ...replacement, verified: false } : undefined,
                verified: false,
            };
        });
        const entry = entries.find((entry) => entry.assessmentId === result.assessmentId)!;
        const followUps = validateFollowUps(a.followUps, entry, ledger, prefix);
        return { result, checks, findings, ...(followUps.length ? { followUps } : {}) };
    });
}
/** Merge only exact supported issue accounts; no fuzzy semantic merge may erase a distinct issue. */
export function reconcileFindings(findings: AssessmentFinding[]): AssessmentFinding[] {
    const normalized = (text: string) => text.trim().replace(/\s+/gu, ' ');
    const groups = new Map<string, AssessmentFinding>();
    for (const finding of findings) {
        const locations = finding.locationRefs
            .map((c) => [
                c.provenance.side,
                c.provenance.commit,
                c.provenance.path,
                c.provenance.object,
                c.location?.line,
                c.location?.column,
                c.quote,
            ])
            .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
        const key = digest([
            finding.classification,
            finding.verified,
            locations,
            normalized(finding.explanation),
            normalized(finding.consequence),
            normalized(finding.correction),
            finding.proposedReplacement ?? null,
        ]);
        const previous = groups.get(key);
        if (!previous) {
            groups.set(key, structuredClone(finding));
            continue;
        }
        previous.assessmentIds = Array.from(new Set([...previous.assessmentIds, ...finding.assessmentIds])).sort();
        previous.checkIds = Array.from(new Set([...previous.checkIds, ...finding.checkIds])).sort();
        previous.limitations = Array.from(new Set([...previous.limitations, ...finding.limitations]));
        previous.sourceFindingIds = Array.from(
            new Set([
                ...(previous.sourceFindingIds ?? [previous.findingId]),
                ...(finding.sourceFindingIds ?? [finding.findingId]),
            ]),
        ).sort();
        previous.findingId = previous.sourceFindingIds[0]!;
        const citations = new Map(
            [...previous.locationRefs, ...finding.locationRefs].map((c) => [
                digest([c.ref, c.quote, c.start, c.end]),
                c,
            ]),
        );
        previous.locationRefs = Array.from(citations.values());
    }
    return Array.from(groups.values());
}
