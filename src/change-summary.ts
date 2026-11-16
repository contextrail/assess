import { z } from 'zod';
import { citationSchema, selectionSchema, type Citation, type EvidenceLedger } from './evidence.js';

/** Reader orientation, independent of governed assessment outcomes and enforcement. */
export const changeSummarySchema = z.strictObject({
    overview: z.string().min(1).max(2000),
    reviewFocus: z.array(z.string().min(1).max(1000)).max(5),
    sourceRefs: z.array(citationSchema).min(1).max(12),
});
export const changeSummarySelectionSchema = changeSummarySchema.extend({
    sourceRefs: z.array(selectionSchema).min(1).max(12),
});
export type ChangeSummary = Omit<z.infer<typeof changeSummarySchema>, 'sourceRefs'> & { sourceRefs: Citation[] };
export type ChangeSummaryState = {
    candidate: ChangeSummary | null;
    accepted: ChangeSummary | null;
    status: 'pending' | 'verified' | 'rejected';
};
export function validateChangeSummary(value: unknown, ledger: EvidenceLedger): ChangeSummary {
    const parsed = changeSummarySchema.parse(value);
    const sourceRefs = parsed.sourceRefs.map((citation) => ledger.cite(citation));
    if (sourceRefs.some((citation) => citation.provenance.kind !== 'source'))
        throw new Error('change_summary_source_required');
    return { ...parsed, sourceRefs };
}

/** Older handoffs are arrays; summaries are bound into newer handoff output hashes. */
export function phaseItems<T>(output: unknown, field: 'assessments' | 'entries'): T[] {
    if (Array.isArray(output)) return output as T[];
    if (output && typeof output === 'object' && field in output) return (output as Record<string, T[]>)[field] ?? [];
    return [];
}
