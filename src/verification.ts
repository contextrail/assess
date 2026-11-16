import { z } from 'zod';
import { changeSummarySelectionSchema } from './change-summary.js';
import { citationSchema, selectionSchema, type Citation, type EvidenceLedger } from './evidence.js';
import { exactIds } from './planning.js';
import {
    assessmentSubmissionSchema,
    investigationSubmissionSchema,
    deriveAssessmentCitations,
    assessmentSelectionSchema,
    validateAssessmentSubmission,
    type AssessmentProposal,
} from './assessment.js';
import { resultSchema, validateResult, type AcceptedResult, type AssessmentEntry } from './results.js';
export const verificationSchema = z.strictObject({
    entries: z.array(
        z.strictObject({
            assessmentId: z.string(),
            disposition: z
                .enum(['accept', 'revise', 'reject', 'unresolved'])
                .describe(
                    'Whether the ASSESSMENT is supported, not whether the code is compliant. Accept a correct assessment even when it establishes violations. accept requires no missing checks and all finding claims supported; otherwise revise/reject/unresolved.',
                ),
            reason: z.string().min(1),
            citations: z.array(citationSchema),
            missingChecks: z.array(z.string()),
            resolution: resultSchema
                .nullable()
                .optional()
                .describe(
                    'Corrected final criterion judgment after independent inspection, or null. Use with revise/reject when the original conclusion is wrong but available evidence settles the correction. Missing decisive checks require unresolved. Never infer a clean result merely by rejecting findings.',
                ),
            amendment: assessmentSubmissionSchema.shape.assessments.element
                .nullable()
                .optional()
                .describe(
                    'Complete replacement criterion assessment with passage-backed checks and final findings. Use to add missed findings or correct classifications. Supersedes all original findings; include every still-supported finding. Cannot be combined with resolution.',
                ),
            findings: z.array(
                z.strictObject({
                    findingId: z.string(),
                    accepted: z
                        .boolean()
                        .describe(
                            'True means this finding is supported by governing criteria and source, including a real code violation. False means the finding claim needs rejection or revision; it is not a code-approval flag.',
                        ),
                    suggestionAccepted: z
                        .boolean()
                        .describe(
                            'False unless this exact finding has a non-null proposedReplacement object and independent source inspection supports that replacement. A textual correction alone is not a replacement. Requires accepted=true.',
                        ),
                    explanation: z.string().min(1),
                }),
            ),
        }),
    ),
});
/** Compact model decisions reference immutable proposals; canonical validation stays independent. */
const modelVerification = z.strictObject({
    assessmentId: z.string(),
    disposition: verificationSchema.shape.entries.element.shape.disposition,
    reason: z
        .string()
        .min(1)
        .nullable()
        .describe('Null records confirmation of the original assessment on acceptance only.'),
    citations: z.array(selectionSchema).describe('Empty reuses original assessment citations on acceptance only.'),
    missingChecks: z.array(z.string()),
    amendment: assessmentSelectionSchema.shape.assessments.element.nullable(),
    findings: z.array(
        z.strictObject({
            findingId: z.string(),
            decision: z.enum(['accept', 'accept_with_suggestion', 'reject']),
            explanation: z.string().min(1).nullable().describe('Null reuses a supported original finding explanation.'),
        }),
    ),
});
export const verificationSelectionSchema = z.strictObject({
    entries: z.array(modelVerification),
    changeSummary: z
        .union([changeSummarySelectionSchema, z.literal(false), z.null()])
        .describe(
            'A checked summary object replaces the narrative; null contributes no update in this batch; false explicitly withdraws an unsupported summary.',
        ),
});
/** Expand resolved model selections using known records before strict canonical validation. */
export function resolveVerificationAmendments(
    input: unknown,
    entries: AssessmentEntry[],
    proposals: AssessmentProposal[],
) {
    const parsed = z
        .strictObject({
            entries: z.array(
                modelVerification.extend({
                    citations: z.array(citationSchema),
                    amendment: investigationSubmissionSchema.shape.assessments.element.nullable(),
                }),
            ),
        })
        .parse(input);
    return {
        entries: parsed.entries.map((entry) => {
            const proposal = proposals.find((p) => p.result.assessmentId === entry.assessmentId);
            if (!proposal) throw new Error('foreign_assessment_id');
            if (entry.disposition !== 'accept' && (!entry.reason || !entry.citations.length))
                throw new Error('verification_correction_evidence_required');
            return {
                ...entry,
                reason:
                    entry.reason ??
                    'Independent verification confirmed the supplied assessment against the provided evidence.',
                citations: entry.citations.length
                    ? entry.citations
                    : proposal.result.citations.map(({ ref, quote, start, end }) => ({ ref, quote, start, end })),
                resolution: null,
                amendment: entry.amendment
                    ? deriveAssessmentCitations({ assessments: [entry.amendment] }, entries)
                    : null,
                findings: entry.findings.map((finding) => {
                    const original = proposal.findings.find((f) => f.findingId === finding.findingId);
                    if (!original) throw new Error('foreign_finding_id');
                    if (finding.decision === 'reject' && !finding.explanation)
                        throw new Error('verification_rejection_explanation_required');
                    return {
                        findingId: finding.findingId,
                        accepted: finding.decision !== 'reject',
                        suggestionAccepted: finding.decision === 'accept_with_suggestion',
                        explanation: finding.explanation ?? original.explanation,
                    };
                }),
            };
        }),
    };
}
export type VerificationEntry = Omit<
    z.infer<typeof verificationSchema>['entries'][number],
    'citations' | 'resolution' | 'amendment'
> & {
    citations: Citation[];
    resolution?: AcceptedResult | null;
    amendment?: AssessmentProposal | null;
};
export function validateVerification(
    input: unknown,
    proposals: AssessmentProposal[],
    ledger: EvidenceLedger,
    entries: AssessmentEntry[] = [],
    structured: Record<string, Array<{ path: string; value: unknown }>> = {},
): VerificationEntry[] {
    const parsed = verificationSchema.parse(input);
    exactIds(
        parsed.entries.map((e) => e.assessmentId),
        proposals.map((p) => p.result.assessmentId),
    );
    return parsed.entries.map((e, entryIndex) => {
        const p = proposals.find((p) => p.result.assessmentId === e.assessmentId)!;
        exactIds(
            e.findings.map((f) => f.findingId),
            p.findings.map((f) => f.findingId),
        );
        const citations = e.citations.map((c, citationIndex) =>
            ledger.cite(c, ['entries', entryIndex, 'citations', citationIndex]),
        );
        if (
            !citations.some(
                (c) =>
                    c.provenance.kind === 'publication' &&
                    p.result.citations.some(
                        (o) =>
                            o.provenance.kind === 'publication' &&
                            o.provenance.nodeId === c.provenance.nodeId &&
                            o.provenance.version === c.provenance.version &&
                            o.provenance.contentHash === c.provenance.contentHash,
                    ),
            )
        )
            throw new Error('verification_governing_evidence_required');
        if (e.disposition === 'accept' && (e.missingChecks.length || e.findings.some((f) => !f.accepted)))
            throw new Error('verification_acceptance_inconsistent');
        if (
            ((e.disposition === 'accept' && p.result.disposition === 'evaluated') ||
                e.findings.some((finding) => finding.accepted)) &&
            !citations.some((c) => c.provenance.kind === 'source')
        )
            throw new Error('verification_source_required');
        if (
            e.findings.some(
                (f) =>
                    f.suggestionAccepted &&
                    (!f.accepted || !p.findings.find((o) => o.findingId === f.findingId)?.proposedReplacement),
            )
        )
            throw new Error('unproposed_suggestion_acceptance');
        const resolution = e.resolution ? validateResolution(e, p, entries, ledger) : null;
        const amendment = e.amendment ? validateAmendment(e, entries, ledger, structured) : null;
        return { ...e, citations, resolution: amendment?.result ?? resolution, amendment };
    });
}
function validateAmendment(
    verdict: z.infer<typeof verificationSchema>['entries'][number],
    entries: AssessmentEntry[],
    ledger: EvidenceLedger,
    structured: Record<string, Array<{ path: string; value: unknown }>>,
): AssessmentProposal {
    const input = verdict.amendment!;
    if (
        verdict.disposition === 'accept' ||
        verdict.resolution ||
        input.result.assessmentId !== verdict.assessmentId ||
        verdict.findings.some((f) => f.accepted || f.suggestionAccepted)
    )
        throw new Error('verification_amendment_inconsistent');
    if (input.findings.some((f) => f.proposedReplacement !== null))
        throw new Error('verification_amendment_suggestion_unchecked');
    const amendment = validateAssessmentSubmission({ assessments: [input] }, entries, ledger, structured);
    if (verdict.missingChecks.length && amendment.result.disposition !== 'unresolved')
        throw new Error('verification_resolution_missing_checks');
    return {
        ...amendment,
        checks: amendment.checks.map((check) => ({ ...check, verified: true })),
        findings: amendment.findings.map((finding) => ({ ...finding, verified: true })),
        ...(amendment.followUps
            ? { followUps: amendment.followUps.map((followUp) => ({ ...followUp, verified: true })) }
            : {}),
    };
}
function validateResolution(
    verdict: z.infer<typeof verificationSchema>['entries'][number],
    proposal: AssessmentProposal,
    entries: AssessmentEntry[],
    ledger: EvidenceLedger,
): AcceptedResult {
    const input = verdict.resolution!;
    if (verdict.disposition === 'accept' || input.assessmentId !== verdict.assessmentId)
        throw new Error('verification_resolution_inconsistent');
    const result = validateResult(input, entries, ledger, ['resolution']);
    const accepted = proposal.findings.filter((finding) =>
        verdict.findings.some((f) => f.findingId === finding.findingId && f.accepted),
    );
    if (verdict.missingChecks.length && result.disposition !== 'unresolved')
        throw new Error('verification_resolution_missing_checks');
    if (result.disposition !== 'unresolved') {
        const classifications = accepted.map((finding) => finding.classification);
        const classification =
            ['binding_violation', 'behavioral_defect', 'guidance_departure'].find((value) =>
                classifications.includes(value as (typeof classifications)[number]),
            ) ?? 'none';
        if (result.finding !== classification || (accepted.length > 0 && result.disposition !== 'evaluated'))
            throw new Error('verification_resolution_findings_mismatch');
    }
    return result;
}
