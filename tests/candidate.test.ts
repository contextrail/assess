import { describe, expect, it } from 'vitest';
import { EvidenceLedger } from '../src/evidence.js';
import {
    CandidateAccumulator,
    candidateProposal,
    revalidateCandidate,
    validateConcern,
    projectCandidates,
} from '../src/candidate.js';
import { decideExit, type AssessmentEntry } from '../src/results.js';
import type { AssessmentProposal } from '../src/assessment.js';
function fixture() {
    const ledger = new EvidenceLedger();
    const passage = ledger.add('Validate size before persisting input.', {
        kind: 'publication',
        nodeId: 'context://input',
        version: 1,
        path: '/content/body',
    });
    const source = ledger.add('store(input);', {
        kind: 'source',
        path: 'input.ts',
        side: 'head',
        commit: 'head',
        object: 'blob',
    });
    const entries: AssessmentEntry[] = [
        {
            assessmentId: 'a',
            nodeId: 'context://input',
            version: 1,
            subtype: 'standard',
            contentHash: 'hash',
            reasons: ['selected'],
            material: 'publications.json',
            result: { disposition: 'not_evaluated', adherence: null, confidence: null },
        },
    ];
    const row = {
        proposedReplacement: null,
        passage: { ref: passage.ref, quote: passage.text },
        question: 'Is size bounded before storage?',
        observation: 'Input is persisted without a size check.',
        unknowns: [] as string[],
        assumptions: [] as string[],
        applicabilityReasoning: 'Changed input is persisted.',
        sourceRefs: [{ ref: source.ref, quote: source.text }],
        concern: { claim: 'Required size bound is absent.', evidenceScope: 'implementation' as const },
    };
    const input = { assessmentId: 'a', observations: [row] };
    const state = {
        entries,
        checks: [] as AssessmentProposal['checks'],
        findings: [] as AssessmentProposal['findings'],
        followUps: [] as NonNullable<AssessmentProposal['followUps']>,
    };
    return { ledger, passage, source, entries, row, input, state };
}
describe('candidate observations and focused validation', () => {
    it('retains accepted groups, rejects changed replay and revalidates persisted evidence', () => {
        const f = fixture(),
            a = new CandidateAccumulator(f.entries, f.ledger);
        expect(a.submit({ assessments: [f.input] }).complete).toBe(true);
        expect(a.submit({ assessments: [f.input] }).alreadyAccepted).toEqual(['a']);
        expect(() =>
            a.submit({ assessments: [{ ...f.input, observations: [{ ...f.row, observation: 'changed' }] }] }),
        ).toThrow('immutable');
        expect(revalidateCandidate(a.snapshot()[0]!, f.entries, f.ledger)).toEqual(a.snapshot()[0]);
        expect(a.snapshot()[0]!.findings).toEqual([]);
        expect(a.snapshot()[0]!.result.disposition).toBe('observed');
    });
    it('normalizes redundant governing citations without replacing required source support', () => {
        const f = fixture();
        const original = candidateProposal(f.input, f.entries, f.ledger);
        const governing = { ref: f.passage.ref, quote: f.passage.text };
        const withRefs = (sourceRefs: typeof f.row.sourceRefs) =>
            candidateProposal({ ...f.input, observations: [{ ...f.row, sourceRefs }] }, f.entries, f.ledger);
        expect(withRefs([...f.row.sourceRefs, governing])).toEqual(original);
        expect(() => withRefs([governing])).toThrow('observation_evidence');
        const foreign = f.ledger.add('Other rule.', { ...f.passage.provenance, nodeId: 'context://other' });
        expect(() => withRefs([...f.row.sourceRefs, { ref: foreign.ref, quote: foreign.text }])).toThrow(
            'unrelated_publication',
        );
    });
    it('does not promote absent concerns into verified compliance', () => {
        const f = fixture(),
            p = candidateProposal({ ...f.input, observations: [{ ...f.row, concern: null }] }, f.entries, f.ledger);
        projectCandidates(f.state, [p], []);
        expect(f.state.entries[0]!.result).toMatchObject({
            disposition: 'observed',
            adherence: null,
            confidence: null,
            finding: 'none',
        });
        expect(f.state.checks[0]!.verified).toBe(false);
    });
    it('requires independent validation of decisive unknowns while preserving already accepted contexts', () => {
        const f = fixture();
        f.entries.push({ ...f.entries[0]!, assessmentId: 'b' });
        const accumulator = new CandidateAccumulator(f.entries, f.ledger);
        accumulator.submit({ assessments: [f.input] });
        const row = {
            ...f.row,
            observation: '',
            sourceRefs: [],
            unknowns: ['Receiving input path unavailable.'],
            concern: null,
        };
        expect(() => accumulator.submit({ assessments: [{ assessmentId: 'b', observations: [row] }] })).toThrow(
            'decisive_unknown_requires_concern',
        );
        expect(accumulator.remaining()).toEqual(['b']);
        expect(accumulator.snapshot().map((proposal) => proposal.result.assessmentId)).toEqual(['a']);
        accumulator.submit({
            assessments: [
                {
                    assessmentId: 'b',
                    observations: [
                        {
                            ...row,
                            concern: {
                                claim: 'Cannot establish the changed receiving path size check without its source.',
                                evidenceScope: 'implementation',
                            },
                        },
                    ],
                },
            ],
        });
        expect(accumulator.remaining()).toEqual([]);
        const proposal = accumulator.snapshot()[1]!;
        projectCandidates(f.state, [proposal], []);
        expect(f.state.entries[1]!.result.disposition).toBe('unresolved');
    });
    it('retains conservative projection of internal observations with unvalidated unknowns', () => {
        const f = fixture();
        const proposal = candidateProposal(f.input, f.entries, f.ledger);
        proposal.observations![0]!.concern = null;
        proposal.observations![0]!.unknowns = ['Receiving path unavailable.'];
        projectCandidates(f.state, [proposal], []);
        expect(f.state.entries[0]!.result.disposition).toBe('unresolved');
    });
    it('requires source support and correction before publishing a binding finding', () => {
        const f = fixture(),
            p = candidateProposal(f.input, f.entries, f.ledger),
            o = p.observations![0]!;
        const input = {
            decision: 'supported_violation',
            applicability: 'applicable',
            suggestionAccepted: false,
            duty: 'binding',
            reason: 'The trusted storage call receives unchecked input.',
            consequence: 'Oversized values can be persisted.',
            correction: 'Enforce the size constraint before storing.',
            sourceRefs: [{ ref: f.source.ref, quote: f.source.text }],
        };
        expect(() => validateConcern({ ...input, sourceRefs: [] }, o, f.ledger)).toThrow('requires_evidence');
        expect(
            validateConcern(
                { ...input, sourceRefs: [...input.sourceRefs, { ref: f.passage.ref, quote: f.passage.text }] },
                o,
                f.ledger,
            ).sourceRefs,
        ).toHaveLength(1);
        expect(() =>
            validateConcern({ ...input, sourceRefs: [{ ref: f.passage.ref, quote: f.passage.text }] }, o, f.ledger),
        ).toThrow('requires_evidence');
        const unrelated = f.ledger.add('Different rule.', { ...f.passage.provenance, nodeId: 'context://unrelated' });
        expect(() =>
            validateConcern(
                { ...input, sourceRefs: [...input.sourceRefs, { ref: unrelated.ref, quote: unrelated.text }] },
                o,
                f.ledger,
            ),
        ).toThrow('unrelated_publication');
        projectCandidates(f.state, [p], [validateConcern(input, o, f.ledger)]);
        expect(f.state.findings[0]).toMatchObject({ classification: 'binding_violation', verified: true });
        expect(f.state.entries[0]!.result).toMatchObject({ disposition: 'evaluated', adherence: 0, confidence: null });
        // A violation is only a violation of an obligation that applies.
        expect(() => validateConcern({ ...input, applicability: 'uncertain' }, o, f.ledger)).toThrow(
            'violation_applicability_required',
        );
    });
    it('merges the same finding at the same location and keeps differently classified findings apart', () => {
        const f = fixture(),
            p = candidateProposal(f.input, f.entries, f.ledger),
            o = p.observations![0]!;
        const input = {
            decision: 'supported_violation',
            applicability: 'applicable',
            suggestionAccepted: false,
            duty: 'binding',
            reason: 'The trusted storage call receives unchecked input.',
            consequence: 'Oversized values can be persisted.',
            correction: 'Enforce the size constraint before storing.',
            sourceRefs: [{ ref: f.source.ref, quote: f.source.text }],
        };
        const second = { ...o, id: `${o.id}-second` };
        const third = { ...o, id: `${o.id}-third` };
        projectCandidates(
            f.state,
            [p, { ...p, observations: [second] }, { ...p, observations: [third] }],
            [
                validateConcern(input, o, f.ledger),
                validateConcern(input, second, f.ledger),
                validateConcern({ ...input, duty: 'guidance' }, third, f.ledger),
            ],
        );
        expect(f.state.findings).toHaveLength(2);
        expect(f.state.findings[0]).toMatchObject({ classification: 'binding_violation', checkIds: [o.id, second.id] });
        expect(f.state.findings[0]!.sourceFindingIds).toHaveLength(2);
        expect(f.state.findings[1]).toMatchObject({ classification: 'guidance_departure', checkIds: [third.id] });
    });
    it.each([
        ['refuted', 'evaluated'],
        ['not_applicable', 'not_applicable'],
        ['supported_violation', 'evaluated'],
        ['missing_evidence', 'unresolved'],
        ['ambiguous_rule', 'unresolved'],
    ] as const)('projects %s into final check %s without rewriting the assessor record', (decision, disposition) => {
        const f = fixture();
        const proposal = candidateProposal(
            { ...f.input, observations: [{ ...f.row, unknowns: ['Receiving path is unclear.'] }] },
            f.entries,
            f.ledger,
        );
        const original = structuredClone(proposal);
        const judgment = validateConcern(
            {
                decision,
                applicability: decision === 'not_applicable' ? 'not_applicable' : 'applicable',
                suggestionAccepted: false,
                duty: 'binding',
                reason: 'Independent assessment of the receiving path.',
                consequence: 'The input boundary needs to enforce the size limit.',
                correction: 'Inspect the referenced receiving path.',
                sourceRefs: [{ ref: f.source.ref, quote: f.source.text }],
            },
            proposal.observations![0]!,
            f.ledger,
        );
        projectCandidates(f.state, [proposal], [judgment]);
        expect(f.state.checks[0]).toMatchObject({
            disposition,
            explanation: judgment.reason,
            missingEvidence: disposition === 'unresolved' ? judgment.correction : '',
            verified: true,
        });
        expect(f.state.checks[0]!.sourceRefs).toContainEqual(judgment.sourceRefs[0]);
        expect(proposal).toEqual(original);
        projectCandidates(f.state, [proposal], []);
        expect(f.state.checks[0]).toMatchObject({
            disposition: 'unresolved',
            missingEvidence: 'Receiving path is unclear.',
            verified: false,
        });
    });
    it('keeps unsupported applicability as a gap rather than a violation', () => {
        const f = fixture(),
            p = candidateProposal(f.input, f.entries, f.ledger),
            o = p.observations![0]!;
        projectCandidates(
            f.state,
            [p],
            [
                validateConcern(
                    {
                        decision: 'missing_evidence',
                        applicability: 'uncertain',
                        suggestionAccepted: false,
                        duty: 'binding',
                        reason: 'Accessor input reachability is not established.',
                        consequence: '',
                        correction: 'Establish accepted input type.',
                        sourceRefs: [],
                    },
                    o,
                    f.ledger,
                ),
            ],
        );
        expect(f.state.findings).toEqual([]);
        expect(f.state.entries[0]!.result.disposition).toBe('unresolved');
    });
    it.each(['supported_violation', 'missing_evidence', 'ambiguous_rule'] as const)(
        'does not let an assessor operational label override independent %s',
        (decision) => {
            const f = fixture(),
                p = candidateProposal(
                    {
                        ...f.input,
                        observations: [
                            {
                                ...f.row,
                                concern: { claim: 'Deletion execution unknown.', evidenceScope: 'operational_outcome' },
                            },
                        ],
                    },
                    f.entries,
                    f.ledger,
                ),
                o = p.observations![0]!;
            projectCandidates(
                f.state,
                [p],
                [
                    validateConcern(
                        {
                            decision,
                            applicability: 'applicable',
                            suggestionAccepted: false,
                            duty: 'binding',
                            reason: 'Explicit operational step remains required.',
                            consequence: 'Operation remains pending.',
                            correction: 'Perform and record the operation.',
                            sourceRefs: [{ ref: f.source.ref, quote: f.source.text }],
                        },
                        o,
                        f.ledger,
                    ),
                ],
            );
            expect(f.state.findings).toHaveLength(decision === 'supported_violation' ? 1 : 0);
            expect(f.state.entries[0]!.result.disposition).toBe(
                decision === 'supported_violation' ? 'evaluated' : 'unresolved',
            );
            expect(
                decideExit(f.state.entries, { enforcement: 'strict' }, false, false, f.state.findings).exitCode,
            ).toBe(1);
        },
    );
    it('keeps implementation uncertainty when the same context has an out-of-scope operational concern', () => {
        const f = fixture();
        const proposal = candidateProposal(
            {
                ...f.input,
                observations: [
                    {
                        ...f.row,
                        concern: { claim: 'The current check has not finished.', evidenceScope: 'operational_outcome' },
                        unknowns: ['Current run result unavailable.'],
                    },
                    {
                        ...f.row,
                        question: 'Does the release workflow prevent bypass?',
                        observation: '',
                        sourceRefs: [],
                        concern: {
                            claim: 'Cannot establish release gate enforcement without the referenced workflow.',
                            evidenceScope: 'implementation',
                        },
                        unknowns: ['The referenced release workflow is unavailable.'],
                    },
                ],
            },
            f.entries,
            f.ledger,
        );
        projectCandidates(f.state, [proposal], []);
        expect(f.state.entries[0]!.result.disposition).toBe('unresolved');
        expect(f.state.followUps).toEqual([]);
        expect(decideExit(f.state.entries, { enforcement: 'strict' }, false, false, f.state.findings).exitCode).toBe(1);
    });
    it('requires independent validation before excluding an assessor-labeled operational concern', () => {
        const f = fixture();
        const proposal = candidateProposal(
            {
                ...f.input,
                observations: [
                    {
                        ...f.row,
                        concern: { claim: 'The current check has not finished.', evidenceScope: 'operational_outcome' },
                        unknowns: ['Current run result unavailable.'],
                    },
                ],
            },
            f.entries,
            f.ledger,
        );
        projectCandidates(f.state, [proposal], []);
        expect(f.state.entries[0]!.result.disposition).toBe('unresolved');
        expect(f.state.checks[0]).toMatchObject({ disposition: 'unresolved', verified: false });
        expect(f.state.followUps).toEqual([]);
        const decision = validateConcern(
            {
                decision: 'not_applicable',
                applicability: 'not_applicable',
                duty: 'binding',
                suggestionAccepted: false,
                reason: 'Current execution receipts are outside artifact assessment.',
                consequence: '',
                correction: '',
                sourceRefs: [],
            },
            proposal.observations![0]!,
            f.ledger,
        );
        projectCandidates(f.state, [proposal], [decision]);
        expect(f.state.entries[0]!.result).toMatchObject({ disposition: 'observed', adherence: null });
        expect(decideExit(f.state.entries, { enforcement: 'strict' }).exitCode).toBe(0);
    });
    it('keeps a confirmed violation when another obligation has a decisive evidence gap', () => {
        const f = fixture();
        const p = candidateProposal(
            {
                ...f.input,
                observations: [
                    f.row,
                    {
                        ...f.row,
                        question: 'Is the receiving path known?',
                        observation: '',
                        sourceRefs: [],
                        unknowns: ['The receiving path is unavailable.'],
                        concern: {
                            claim: 'Cannot establish whether the receiving path enforces the bound.',
                            evidenceScope: 'implementation',
                        },
                    },
                ],
            },
            f.entries,
            f.ledger,
        );
        const d = validateConcern(
            {
                decision: 'supported_violation',
                applicability: 'applicable',
                suggestionAccepted: false,
                duty: 'binding',
                reason: 'The bound is absent.',
                consequence: 'Oversized values persist.',
                correction: 'Validate the bound.',
                sourceRefs: [{ ref: f.source.ref, quote: f.source.text }],
            },
            p.observations![0]!,
            f.ledger,
        );
        projectCandidates(f.state, [p], [d]);
        expect(f.state.entries[0]!.result).toMatchObject({
            disposition: 'unresolved',
            adherence: null,
            finding: 'binding_violation',
        });
        expect(decideExit(f.state.entries, { enforcement: 'required' }, false, false, f.state.findings).exitCode).toBe(
            1,
        );
    });
});

describe('external evidence boundary', () => {
    function external(f: ReturnType<typeof fixture>, observation: Parameters<typeof validateConcern>[1]) {
        return validateConcern(
            {
                decision: 'external_follow_up',
                externalEvidence: { kind: 'external_dependency', subject: 'storage-provider@1' },
                applicability: 'applicable',
                duty: 'binding',
                suggestionAccepted: false,
                reason: 'The external storage implementation is not included in the pinned repository.',
                consequence: '',
                correction: 'Inspect storage-provider@1 separately if assurance is needed.',
                sourceRefs: f.row.sourceRefs,
            },
            observation,
            f.ledger,
        );
    }
    function proposal(f: ReturnType<typeof fixture>) {
        return candidateProposal(
            {
                ...f.input,
                observations: [
                    {
                        ...f.row,
                        observation: 'Input is passed to the storage provider.',
                        unknowns: ['The external provider implementation is unavailable.'],
                    },
                ],
            },
            f.entries,
            f.ledger,
        );
    }
    it('requires independent boundary validation and never certifies external adherence', () => {
        const f = fixture(),
            p = proposal(f);
        projectCandidates(f.state, [p], []);
        expect(decideExit(f.state.entries, { enforcement: 'strict' }).exitCode).toBe(1);
        const d = external(f, p.observations![0]!);
        projectCandidates(f.state, [p], [d]);
        expect(f.state.entries[0]!.result).toMatchObject({
            disposition: 'observed',
            adherence: null,
            confidence: null,
            finding: 'none',
        });
        expect(f.state.entries[0]!.result.limitations).toContain(
            'Outside artifact evidence boundary: storage-provider@1. Not assessed; no compliance conclusion.',
        );
        expect(f.state.followUps).toMatchObject([
            {
                kind: 'external_evidence',
                required: false,
                verified: true,
                externalEvidence: { subject: 'storage-provider@1' },
            },
        ]);
        expect(decideExit(f.state.entries, { enforcement: 'strict' })).toMatchObject({ exitCode: 0, complete: true });
        expect(decideExit(f.state.entries, { enforcement: 'strict' }, false, true).exitCode).toBe(2);
        const restored = revalidateCandidate(p, f.entries, f.ledger);
        const { observationId: _id, ...saved } = d;
        const wire = {
            ...saved,
            sourceRefs: saved.sourceRefs.map(({ ref, quote, start, end }) => ({ ref, quote, start, end })),
        };
        expect(validateConcern(JSON.parse(JSON.stringify(wire)), restored.observations![0]!, f.ledger)).toEqual(d);
    });
    it.each(['supported_violation', 'missing_evidence', 'ambiguous_rule'] as const)(
        'does not suppress a separate %s in the same standard',
        (decision) => {
            const f = fixture();
            const combined = candidateProposal(
                {
                    ...f.input,
                    observations: [
                        { ...f.row, question: 'External provider?', unknowns: ['Provider internals unavailable.'] },
                        f.row,
                    ],
                },
                f.entries,
                f.ledger,
            );
            const d = external(f, combined.observations![0]!);
            const local = validateConcern(
                {
                    decision,
                    applicability: 'applicable',
                    duty: 'binding',
                    suggestionAccepted: false,
                    reason: 'The repository storage path lacks the required size check.',
                    consequence: 'Oversized input is persisted.',
                    correction: 'Inspect and enforce the local size bound.',
                    sourceRefs: f.row.sourceRefs,
                },
                combined.observations![1]!,
                f.ledger,
            );
            projectCandidates(f.state, [combined], [d, local]);
            expect(f.state.followUps).toHaveLength(1);
            expect(
                decideExit(f.state.entries, { enforcement: 'strict' }, false, false, f.state.findings).exitCode,
            ).toBe(1);
            if (decision === 'supported_violation') expect(f.state.findings).toHaveLength(1);
            else expect(f.state.entries[0]!.result.disposition).toBe('unresolved');
        },
    );
    it('rejects boundary decisions without source, subject, action or relevant applicability', () => {
        const f = fixture(),
            p = proposal(f),
            o = p.observations![0]!;
        const { observationId: _id, ...valid } = external(f, o);
        const wire = { ...valid, sourceRefs: f.row.sourceRefs };
        expect(() => validateConcern(wire, o, f.ledger)).not.toThrow();
        for (const patch of [
            { externalEvidence: null },
            { sourceRefs: [] },
            { correction: '' },
            { externalEvidence: { kind: 'external_dependency', subject: ' ' } },
            { applicability: 'not_applicable' },
            { suggestionAccepted: true },
            { decision: 'missing_evidence' },
        ])
            expect(() => validateConcern({ ...wire, ...patch }, o, f.ledger)).toThrow();
    });
});
