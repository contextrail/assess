import { createHash } from 'node:crypto';
import { z } from 'zod';
import { digest, type GitIdentity } from './prepare.js';
import { validatePhaseRecord, type PhaseRecord } from './phases.js';
import { PROVIDER_FAILURE_CODES } from './providers.js';
import { phaseItems } from './change-summary.js';
import { assessLogoBaseUrl } from './version.js';

export const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const objects = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.map(object) : []);
export const string = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
type DeveloperRange = { identity: string; path: string; start: [number, number]; end: [number, number] };
function developerRanges(finding: Record<string, unknown>): DeveloperRange[] {
    return objects(finding.locationRefs).flatMap((citation) => {
        const provenance = object(citation.provenance),
            location = object(citation.location),
            quote = citation.quote;
        const line = location.line,
            column = location.column;
        if (
            provenance.kind !== 'source' ||
            !['head', 'base'].includes(string(provenance.side)) ||
            ![provenance.commit, provenance.path, provenance.object].every(
                (value) => typeof value === 'string' && value.length > 0,
            ) ||
            !Number.isSafeInteger(line) ||
            Number(line) < 1 ||
            !Number.isSafeInteger(column) ||
            Number(column) < 0 ||
            typeof quote !== 'string' ||
            !quote.length
        )
            return [];
        const lines = quote.split('\n');
        return [
            {
                identity: digest([provenance.side, provenance.commit, provenance.path, provenance.object]),
                path: string(provenance.path),
                start: [Number(line), Number(column)],
                end: [
                    Number(line) + lines.length - 1,
                    lines.length === 1 ? Number(column) + quote.length : lines.at(-1)!.length,
                ],
            },
        ];
    });
}
const beforePosition = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
export function developerFindingLocations(finding: Record<string, unknown>): string {
    return developerRanges(finding)
        .map((range) => `${range.path}:${range.start[0]}:${range.start[1]}–${range.end[0]}:${range.end[1]}`)
        .join(', ');
}
export function developerFindingGroupLabel(accounts: Record<string, unknown>[]): string {
    const keys = accounts.map((account) =>
        digest(
            developerRanges(account)
                .map((range) => [range.identity, range.start, range.end])
                .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
        ),
    );
    return keys.every((key) => key === keys[0]) ? 'the same source range' : 'overlapping source ranges';
}
/** Display connected overlapping pinned ranges; preserve every account without asserting semantic equivalence. */
export function groupDeveloperFindings(input: unknown): Record<string, unknown>[][] {
    const findings = objects(input).filter((finding) => finding.verified === true);
    const groups: Array<{ indices: number[]; ranges: DeveloperRange[] }> = [];
    for (const [index, finding] of findings.entries()) {
        const ranges = developerRanges(finding);
        const overlaps = groups.filter((group) =>
            group.ranges.some((other) =>
                ranges.some(
                    (range) =>
                        range.identity === other.identity &&
                        beforePosition(range.start, other.end) &&
                        beforePosition(other.start, range.end),
                ),
            ),
        );
        if (!overlaps.length) {
            groups.push({ indices: [index], ranges });
            continue;
        }
        const target = overlaps[0]!;
        target.indices.push(index);
        target.ranges.push(...ranges);
        for (const group of overlaps.slice(1)) {
            target.indices.push(...group.indices);
            target.ranges.push(...group.ranges);
            groups.splice(groups.indexOf(group), 1);
        }
        target.indices.sort((a, b) => a - b);
    }
    return groups.map((group) => group.indices.map((index) => findings[index]!));
}
export function markdownText(value: unknown, limit = 500): string {
    const flat = String(value ?? 'unavailable').replace(/\p{Cc}/gu, ' ');
    return (flat.length > limit ? flat.slice(0, limit) + '…' : flat)
        .replace(/[\\`*_{}[\]()#+.!|:]/g, '\\$&')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/@/g, '&#64;');
}
const clip = (v: unknown, n: number) =>
    String(v ?? '')
        .replace(/\p{Cc}/gu, ' ')
        .slice(0, n);
const small = (n: number) =>
    z
        .string()
        .max(n)
        .refine((v) => !/\p{Cc}/u.test(v));
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const nullableNumber = z.number().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const model = small(200).regex(/^[A-Za-z0-9._:/-]*$/);
const provider = z.enum(['openai', 'openrouter', 'unknown']);
const effort = z.enum(['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const disposition = z.enum(['evaluated', 'observed', 'unresolved', 'not_applicable', 'not_evaluated']);
const classification = z.enum(['none', 'binding_violation', 'behavioral_defect', 'guidance_departure']);
const phaseIdentity = z.object({ phase: small(40), provider, model, effort }).strict();
const runSchema = z
    .object({
        id: z.string().regex(/^[1-9][0-9]{0,19}$/),
        attempt: z.number().int().positive().max(1000000),
        cliRunId: z
            .string()
            .regex(/^[A-Za-z0-9_-]{1,200}$/)
            .nullable(),
        base: sha.nullable(),
        head: sha.nullable(),
        at: z.iso.datetime(),
        assessment: z.enum(['complete', 'incomplete', 'running', 'not_started', 'unknown']),
        execution: z.enum(['finished', 'failed', 'unknown']),
        exit: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable(),
        findings: z.number().int().nonnegative(),
        unresolved: z.number().int().nonnegative(),
        durationMs: nullableNumber,
        cost: nullableNumber,
        costComplete: z.boolean(),
        packageVersion: small(100),
        reviewerVersion: nullableNumber,
        provider,
        model,
        effort,
        phaseModels: z.array(phaseIdentity).max(10).optional(),
    })
    .strict();
const assessmentSchema = z
    .object({
        base: sha,
        head: sha,
        run: z.string().regex(/^[1-9][0-9]{0,19}$/),
        cliRunId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
        attempt: z.number().int().positive(),
        reviewerVersion: nullableNumber,
        scopeIdentity: small(150),
        provider,
        model,
        effort,
        entries: z
            .array(
                z
                    .object({
                        nodeId: small(500).regex(/^context:\/\/[A-Za-z0-9._/-]+$/),
                        version: z.number().int().positive(),
                        disposition,
                        finding: classification,
                        explanation: small(300),
                        correction: small(200),
                    })
                    .strict(),
            )
            .max(30),
        omitted: z.number().int().nonnegative(),
    })
    .strict();
const historySchema = z
    .object({
        version: z.union([z.literal(1), z.literal(2)]),
        repository: small(301).regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        pr: z.number().int().positive(),
        reviewer: small(500).startsWith('skill://'),
        runs: z.array(runSchema).max(10),
        omitted: z.number().int().nonnegative(),
        assessment: assessmentSchema.nullable(),
    })
    .strict();
export type HistoryConfiguration = { repository: string; pr: number; reviewer: string };
export type AssessmentHistory = z.infer<typeof historySchema>;
export type RunRecord = { row: z.infer<typeof runSchema>; assessment: z.infer<typeof assessmentSchema> | null };
export const assessmentMarker = (config: HistoryConfiguration | string) =>
    `<!-- contextrail-assess:${createHash('sha256')
        .update(typeof config === 'string' ? config : config.reviewer)
        .digest('hex')
        .slice(0, 24)} -->`;
export function readHistory(body: unknown, c: HistoryConfiguration): AssessmentHistory | null {
    if (typeof body !== 'string' || body.length > 65536) return null;
    const match = body.match(/\n<!-- contextrail-state:v([12]):([A-Za-z0-9+/=]{1,40000}) -->\n/);
    if (!match) return null;
    try {
        const bytes = Buffer.from(match[2]!, 'base64');
        if (bytes.length > 30000 || bytes.toString('base64') !== match[2]) return null;
        const parsed = historySchema.parse(JSON.parse(bytes.toString('utf8')));
        return parsed.version === Number(match[1]) &&
            parsed.repository === c.repository &&
            parsed.pr === c.pr &&
            parsed.reviewer === c.reviewer
            ? parsed
            : null;
    } catch {
        return null;
    }
}
export function summarizeUsage(state: unknown) {
    const execution = object(object(state).execution),
        calls = number(execution.calls) ? execution.calls : null;
    const wire = objects(execution.providerUsage);
    const records = wire.length ? wire : objects(execution.usage);
    const unique = new Map<number, Record<string, unknown>>();
    records.forEach((r, i) => {
        const call = wire.length ? r.call : i + 1;
        if (
            number(call) &&
            Number.isSafeInteger(call) &&
            call > 0 &&
            calls !== null &&
            call <= calls &&
            !unique.has(call)
        )
            unique.set(call, wire.length ? object(r.usage) : r);
    });
    const metric = (keys: string[]) => {
        const values = [...unique.values()]
            .map((u) => keys.map((k) => k.split('.').reduce<unknown>((v, part) => object(v)[part], u)).find(number))
            .filter(number);
        return {
            value: values.length ? values.reduce((a, b) => a + b, 0) : null,
            reported: values.length,
            complete: calls !== null && calls > 0 && values.length === calls,
        };
    };
    return {
        calls,
        cost: metric(['cost']),
        input: metric(['input_tokens', 'prompt_tokens', 'inputTokens']),
        output: metric(['output_tokens', 'completion_tokens', 'outputTokens']),
        total: metric(['total_tokens', 'totalTokens']),
        cached: metric([
            'input_tokens_details.cached_tokens',
            'prompt_tokens_details.cached_tokens',
            'cachedInputTokens',
        ]),
        reasoning: metric([
            'output_tokens_details.reasoning_tokens',
            'completion_tokens_details.reasoning_tokens',
            'reasoningTokens',
        ]),
    };
}
export type PresentationOptions = {
    artifactUrl?: string;
    runUrl?: string;
    packageVersion?: string;
    failedStage?: string;
    diagnostic?: string;
    comparisonStatus?: string;
    reviewExit?: number | null;
    artifactOutcome?: string;
    feedback?: string;
};
const duration = (v: unknown) =>
    number(v) ? `${Math.floor(v / 60000)}m ${((v % 60000) / 1000).toFixed(1)}s` : 'unavailable';
const isArtifactUrl = (url: unknown) =>
    typeof url === 'string' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+\/artifacts\/[0-9]+$/.test(url);
const runUrl = (url: unknown) =>
    typeof url === 'string' &&
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[0-9]+(?:\/attempts\/[0-9]+)?$/.test(url);
function metricText(
    m: { value: number | null; reported: number; complete: boolean },
    calls: number | null,
    money = false,
) {
    return `${m.value === null ? 'unavailable' : money ? `$${m.value.toFixed(6)} USD` : m.value.toLocaleString('en-US')} (${m.reported}/${calls ?? '?'} calls reported${m.value !== null && !m.complete ? '; partial' : ''})`;
}
type CoverageHandoffs = {
    historical: Set<string>;
    partial: Set<string>;
    current: Map<string, { ref: string; hash: string }>;
    verification: Map<string, string>;
};
function coveragePhase(
    raw: Record<string, unknown>,
    state: Record<string, unknown>,
    scope: Set<string>,
): PhaseRecord | null {
    if (!['assess', 'verify'].includes(string(raw.phase))) return null;
    const assigned = Array.isArray(raw.assessmentIds) ? raw.assessmentIds : [];
    if (!assigned.length || !assigned.every((id) => typeof id === 'string' && scope.has(id))) return null;
    try {
        return validatePhaseRecord(raw, {
            runId: string(state.runId),
            artifact: object(state.artifact) as GitIdentity,
            scopeIdentity: typeof state.scopeIdentity === 'string' ? state.scopeIdentity : null,
            assessmentIds: assigned as string[],
            requireComplete: false,
        });
    } catch {
        // Invalid or cross-run handoffs cannot establish progress.
        return null;
    }
}
function completeOutput(phase: PhaseRecord, ids: string[]): boolean {
    return (
        phase.status === 'complete' &&
        (Array.isArray(phase.output) ||
            Array.isArray(object(phase.output)[phase.phase === 'assess' ? 'assessments' : 'entries'])) &&
        ids.length === phase.assessmentIds.length &&
        new Set(ids).size === ids.length &&
        ids.every((id) => phase.assessmentIds.includes(id))
    );
}
function recordPartialAssessment(phase: PhaseRecord, handoffs: CoverageHandoffs) {
    if (phase.status === 'complete' || phase.configuration.kind !== 'partial_assessment_progress') return;
    const output = object(phase.output);
    if (!Array.isArray(output.assessments) || !Array.isArray(output.remaining)) return;
    const proposals = objects(output.assessments);
    const ids = proposals.map((p) => string(object(p.result).assessmentId));
    const partition = [...ids, ...output.remaining];
    if (
        proposals.length !== output.assessments.length ||
        partition.length !== phase.assessmentIds.length ||
        new Set(partition).size !== partition.length ||
        !partition.every((id) => phase.assessmentIds.includes(id)) ||
        proposals.some(
            (p) =>
                !['evaluated', 'observed', 'not_applicable', 'unresolved'].includes(
                    string(object(p.result).disposition),
                ),
        )
    )
        return;
    for (const id of ids) handoffs.partial.add(id);
}
function recordAssessment(phase: PhaseRecord, handoffs: CoverageHandoffs) {
    for (const id of phase.assessmentIds) {
        handoffs.partial.delete(id);
        handoffs.current.delete(id);
        handoffs.verification.delete(id);
    }
    recordPartialAssessment(phase, handoffs);
    const proposals = objects(phaseItems(phase.output, 'assessments'));
    const ids = proposals.map((p) => string(object(p.result).assessmentId));
    if (
        !completeOutput(phase, ids) ||
        proposals.some(
            (p) =>
                !['evaluated', 'observed', 'not_applicable', 'unresolved'].includes(
                    string(object(p.result).disposition),
                ),
        )
    )
        return;
    const origin = { ref: `phase:assess:${phase.workUnitId}:${phase.attempt}`, hash: digest(phase) };
    for (const id of ids) {
        handoffs.historical.add(id);
        handoffs.current.set(id, origin);
    }
}
function recordVerification(phase: PhaseRecord, handoffs: CoverageHandoffs) {
    for (const id of phase.assessmentIds) handoffs.verification.delete(id);
    const outcomes = objects(phaseItems(phase.output, 'entries'));
    if (
        !completeOutput(
            phase,
            outcomes.map((o) => string(o.assessmentId)),
        )
    )
        return;
    for (const outcome of outcomes) {
        const id = string(outcome.assessmentId),
            origin = handoffs.current.get(id);
        if (origin && phase.inputRefs.some((r) => r.ref === origin.ref && r.hash === origin.hash))
            handoffs.verification.set(
                id,
                object(outcome.resolution).assessmentId === id ? 'accept' : string(outcome.disposition),
            );
    }
}
function coverageStatus(entry: Record<string, unknown>, verified: number, handoffs: CoverageHandoffs): string {
    const id = string(entry.assessmentId),
        disposition = string(object(entry.result).disposition);
    if (handoffs.partial.has(id)) return 'saved_proposal';
    if (!handoffs.historical.has(id)) return 'unexamined';
    const verdict = handoffs.verification.get(id) ?? '';
    if (!handoffs.current.has(id) || ['reject', 'revise', 'unresolved'].includes(verdict)) return 'needs_reassessment';
    if (disposition === 'observed') return 'observed_unverified';
    if (
        verified > 0 &&
        ['evaluated', 'observed', 'not_applicable', 'unresolved'].includes(disposition) &&
        verdict === 'accept'
    )
        return disposition === 'unresolved' ? 'verified_unresolved' : 'verified';
    return 'awaiting_verification';
}
/** Candidate coverage counts processed context observations separately from checked concerns. */
function candidateCoverage(state: Record<string, unknown>, entries: Record<string, unknown>[]) {
    const observations = objects(state.observations);
    const decisions = objects(state.concernDecisions);
    const progress = entries.map((entry) => {
        const rows = observations.filter((row) => row.assessmentId === entry.assessmentId);
        const concerns = rows.filter((row) => object(row.concern).claim);
        const checked = concerns.filter((row) => decisions.some((decision) => decision.observationId === row.id));
        let status = 'unexamined';
        if (rows.length) {
            if (!concerns.length) status = 'observed_unverified';
            else if (checked.length < concerns.length) status = 'awaiting_verification';
            else status = object(entry.result).disposition === 'unresolved' ? 'verified_unresolved' : 'verified';
        }
        return { assessmentId: string(entry.assessmentId), status };
    });
    const assessed = progress.filter((entry) => entry.status !== 'unexamined').length;
    return {
        total: entries.length,
        assessed,
        currentAssessments: assessed,
        savedProposals: 0,
        verified: progress.filter((entry) => ['verified', 'verified_unresolved'].includes(entry.status)).length,
        awaitingVerification: progress.filter((entry) => entry.status === 'awaiting_verification').length,
        needsReassessment: 0,
        unexamined: progress.filter((entry) => entry.status === 'unexamined').length,
        entries: progress,
    };
}
/** Human progress from complete canonical assessment handoffs; never promotes proposals to verdicts. */
export function assessmentCoverage(input: unknown) {
    const state = object(input),
        entries = objects(state.entries);
    if (object(state.concernValidation).scope === 'nominated_concerns' && Array.isArray(state.observations))
        return candidateCoverage(state, entries);
    const ids = entries.map((e) => string(e.assessmentId)),
        scope = new Set(ids);
    const handoffs: CoverageHandoffs = {
        historical: new Set(),
        partial: new Set(),
        current: new Map(),
        verification: new Map(),
    };
    if (ids.every(Boolean) && scope.size === ids.length) {
        for (const raw of objects(state.phases)) {
            const phase = coveragePhase(raw, state, scope);
            if (!phase) continue;
            if (phase.phase === 'assess') recordAssessment(phase, handoffs);
            else recordVerification(phase, handoffs);
        }
    }
    const canonical = object(state.verification);
    const verified = number(canonical.verified)
        ? canonical.verified
        : entries.filter((e) => object(e.verification).status === 'accepted' || e.verified === true).length;
    const progress = entries.map((e) => ({
        assessmentId: string(e.assessmentId),
        status: coverageStatus(e, verified, handoffs),
    }));
    return {
        total: entries.length,
        assessed: handoffs.historical.size,
        currentAssessments: handoffs.current.size,
        savedProposals: handoffs.partial.size,
        verified,
        awaitingVerification: progress.filter((p) => p.status === 'awaiting_verification').length,
        needsReassessment: progress.filter((p) => p.status === 'needs_reassessment').length,
        unexamined: progress.filter((p) => p.status === 'unexamined').length,
        entries: progress,
    };
}
function countChanges(changes: Record<string, unknown>[]) {
    const counts = { added: 0, modified: 0, deleted: 0, renamed: 0, typeChanged: 0, unknown: 0 };
    const countKeys = new Map<string, keyof typeof counts>([
        ['addition', 'added'],
        ['modification', 'modified'],
        ['type_change', 'modified'],
        ['deletion', 'deleted'],
        ['rename', 'renamed'],
    ]);
    for (const change of changes) {
        counts[countKeys.get(string(change.kind)) ?? 'unknown']++;
        if (change.kind === 'type_change') counts.typeChanged++;
    }
    return counts;
}
function renderChangeCounts(counts: ReturnType<typeof countChanges>): string {
    const totals = `Added ${counts.added}; modified ${counts.modified}; deleted ${counts.deleted}; renamed ${counts.renamed}.`;
    const typeChanges = counts.typeChanged
        ? ` Modified includes ${counts.typeChanged} ${counts.typeChanged === 1 ? 'type change' : 'type changes'}.`
        : '';
    const unknown = counts.unknown ? ` ${counts.unknown} unclassified entries.` : '';
    return totals + typeChanges + unknown;
}
/** Human orientation is separate from the governed result and never controls enforcement. */
export function renderReaderGuidance(input: unknown): string {
    const state = object(input),
        summary = object(state.changeSummary),
        accepted = object(summary.accepted);
    const lines = ['#### Changes and reviewer focus'];
    if (summary.status === 'verified' && typeof accepted.overview === 'string') {
        lines.push(markdownText(accepted.overview, 2000));
        const focus = Array.isArray(accepted.reviewFocus)
            ? accepted.reviewFocus.filter((item): item is string => typeof item === 'string')
            : [];
        if (focus.length)
            lines.push(
                'Suggested review focus:\n\n' +
                    focus
                        .slice(0, 5)
                        .map((item) => `- ${markdownText(item, 1000)}`)
                        .join('\n'),
            );
        const locations = objects(accepted.sourceRefs)
            .map((citation) => `${string(object(citation.provenance).path)}:${object(citation.location).line ?? '?'}`)
            .filter((location) => !location.startsWith(':'))
            .join(', ');
        lines.push(
            'Source-grounded summary, independently checked; separate from adherence.' +
                (locations ? ` Sources: ${markdownText(locations, 1000)}.` : ''),
        );
    } else {
        lines.push(
            'No independently checked narrative summary is available. The prepared file inventory below still describes the comparison.',
        );
    }
    const followUps = objects(state.followUps).filter((item) => item.kind !== 'external_evidence');
    if (followUps.length) {
        lines.push(
            '#### Human and operational follow-ups',
            'These remain separate from artifact adherence. An assessment outcome does not establish that operational duties were completed.',
        );
        for (const item of followUps) {
            const kind = item.kind === 'operational_check' ? 'Operational check' : 'Human check';
            const status =
                item.verified === true
                    ? item.required === true
                        ? 'mandatory — pending'
                        : 'suggested'
                    : 'unverified proposal';
            const criterion = findingCriteria([{ assessmentIds: [item.assessmentId] }], objects(state.entries));
            const locations = objects(item.sourceRefs)
                .map(
                    (citation) =>
                        `${string(object(citation.provenance).path)}:${object(citation.location).line ?? '?'}`,
                )
                .join(', ');
            lines.push(
                `- **${kind}: ${status}.** ${markdownText(item.explanation, 1200)} **Next:** ${markdownText(item.action, 1200)} Criterion: ${criterion}. Source: ${markdownText(locations, 500)}.`,
            );
        }
    }
    const external = renderExternalFollowUps(state, false);
    if (external) lines.push(external);
    return lines.join('\n\n');
}
/** Group a shared external evidence boundary without merging the underlying assessment records. */
function renderExternalFollowUps(state: Record<string, unknown>, compact: boolean): string {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const item of objects(state.followUps)) {
        if (item.kind !== 'external_evidence' || item.verified !== true || item.required !== false) continue;
        const external = object(item.externalEvidence);
        const key = JSON.stringify([external.kind, string(external.subject).trim()]);
        groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    if (!groups.size) return '';
    const lines = [
        'Outside this source assessment; nonblocking in every enforcement mode. These are evidence limitations, not violations or proof of compliance.',
    ];
    for (const items of groups.values()) {
        const external = object(items[0]!.externalEvidence);
        const subject = markdownText(external.subject, 500);
        const kind = markdownText(string(external.kind).replaceAll('_', ' '));
        const criteria = findingCriteria(
            items.map((item) => ({ assessmentIds: [item.assessmentId] })),
            objects(state.entries),
        );
        lines.push(`- **${subject}.** ${kind}. Criteria: ${criteria}.`);
        const accounts = compact
            ? [...new Set(items.map((item) => string(item.action)))].map((action) => briefText(action, 1))
            : items.map(
                  (item) =>
                      `${markdownText(item.explanation, 1200)} **Follow-up:** ${markdownText(item.action, 1200)}${sourceLinks(item.sourceRefs, {})}`,
              );
        lines.push(...accounts.map((account) => `  ${account}`));
    }
    const heading = `External follow-ups (${groups.size})`;
    return compact
        ? `<details>\n<summary>${heading}</summary>\n\n${lines.join('\n\n')}\n\n</details>`
        : `#### ${heading}\n\n${lines.join('\n\n')}`;
}
function renderChangeSummary(input: unknown): string {
    const state = object(input),
        artifact = object(state.artifact),
        inventory = object(state.changes);
    const matches = (side: string) => {
        const snapshot = object(inventory[side]),
            fixed = object(artifact[side]);
        return (
            typeof fixed.commit === 'string' &&
            typeof fixed.tree === 'string' &&
            snapshot.commit === fixed.commit &&
            snapshot.tree === fixed.tree
        );
    };
    if (
        !Array.isArray(inventory.items) ||
        !['complete', 'truncated'].includes(string(inventory.status)) ||
        !matches('base') ||
        !matches('head')
    )
        return '#### Change summary\n\nPrepared change inventory is unavailable for this fixed comparison; no change counts are inferred from a diff prefix or working tree.';
    const changes = objects(inventory.items),
        counts = countChanges(changes);
    const complete = inventory.status === 'complete' && inventory.next === null && counts.unknown === 0;
    const paths = changes.map((c) => {
        const before = string(object(c.base).path),
            after = string(object(c.head).path);
        return c.kind === 'rename' && before && after
            ? `${before} → ${after}`
            : after || before || '(path unavailable)';
    });
    const excluded = Array.isArray(inventory.excludedPaths)
        ? new Set(inventory.excludedPaths.filter((p) => typeof p === 'string')).size
        : 0;
    return [
        '#### Change summary',
        `${complete ? 'Complete permitted' : 'Incomplete'} prepared inventory: ${changes.length} file changes recorded. ${renderChangeCounts(counts)}`,
        paths.length
            ? `Affected paths: ${paths
                  .slice(0, 8)
                  .map((p) => markdownText(p, 240))
                  .join(' · ')}.`
            : 'No permitted changed paths are recorded.',
        paths.length > 8
            ? `${paths.length - 8} additional file entries are omitted from this short path list; they remain in the prepared inventory.`
            : '',
        excluded ? `${excluded} credential-path entries were excluded from the permitted inventory.` : '',
        !complete ? 'Remaining changes may be omitted; captured counts are not full-comparison totals.' : '',
        'This is a factual file-change overview, not a semantic summary or evidence that every changed file was examined.',
    ]
        .filter(Boolean)
        .join('\n\n');
}
const verificationLabels: Record<string, string> = {
    observed_unverified: 'Observation only; not independently validated',
    verified: 'Checked',
    verified_unresolved: 'Checked; evidence needed',
    saved_proposal: 'Saved proposal',
    awaiting_verification: 'Awaiting verification',
    needs_reassessment: 'Needs reassessment',
    unexamined: 'Not checked',
};
export function assessmentProgressLabel(status: string, focused = false): string {
    if (focused && ['verified', 'verified_unresolved'].includes(status))
        return status === 'verified_unresolved'
            ? 'Nominated concerns checked; evidence needed'
            : 'Nominated concerns checked';
    return verificationLabels[status] ?? 'Not checked';
}
export function externalEvidenceAssessmentIds(input: unknown): Set<string> {
    return new Set(
        objects(object(input).followUps)
            .filter((item) => item.kind === 'external_evidence' && item.verified === true && item.required === false)
            .map((item) => string(item.assessmentId)),
    );
}
function criterionOutcome(result: Record<string, unknown>, accepted: boolean, externalEvidence: boolean): string {
    const disposition = string(result.disposition);
    if (disposition === 'observed')
        return externalEvidence ? 'Observed / external evidence limitation' : 'Observed / no concern identified';
    if (disposition === 'not_applicable') return accepted ? 'Not applicable' : 'Proposed not applicable';
    if (disposition === 'unresolved') return 'Unresolved';
    if (disposition === 'not_evaluated') return 'Not evaluated';
    if (disposition !== 'evaluated') return 'Outcome unavailable';
    const labels = new Map<string, [string, string]>([
        ['binding_violation', ['Binding violation', 'Unverified violation judgment']],
        ['behavioral_defect', ['Behavioral defect', 'Unverified defect judgment']],
        ['guidance_departure', ['Guidance departure', 'Unverified guidance judgment']],
    ]);
    const classification = labels.get(string(result.finding));
    if (classification) return classification[accepted ? 0 : 1];
    if (result.adherence === 2) return accepted ? 'Adherent within reviewed scope' : 'Unverified adherence judgment';
    return 'Evaluated judgment';
}
function criterionNote(result: Record<string, unknown>, status: string, accepted: boolean): string {
    const explanation = string(result.explanation),
        correction = string(result.correction);
    if (!accepted && ['binding_violation', 'behavioral_defect', 'guidance_departure'].includes(string(result.finding)))
        return `Unverified judgment: ${explanation}${correction ? ` Proposed correction: ${correction}` : ''}`;
    if (explanation) return explanation;
    if (status === 'saved_proposal')
        return 'Proposal saved; assessment handoff incomplete and independently unverified.';
    if (status === 'awaiting_verification') return 'Assessment recorded; independent verification pending.';
    if (status === 'needs_reassessment') return 'Previous assessment requires a new assessment.';
    return 'No assessment explanation recorded.';
}
function criterionRow(
    entry: Record<string, unknown>,
    progress: ReturnType<typeof assessmentCoverage>,
    verified: Record<string, unknown>[],
    focused = false,
    externalEvidence = false,
): string {
    const result = object(entry.result);
    const status = progress.entries.find((p) => p.assessmentId === entry.assessmentId)?.status ?? 'unexamined';
    const accepted = status === 'verified' || status === 'verified_unresolved';
    const linked = verified.filter(
        (f) => Array.isArray(f.assessmentIds) && f.assessmentIds.includes(entry.assessmentId),
    );
    const count = linked.length ? `[${linked.length}](#governed-findings)` : '0';
    const label = assessmentProgressLabel(status, focused);
    return `| ${markdownText(entry.nodeId, 500)} @ ${markdownText(entry.version, 20)} | ${criterionOutcome(result, accepted, externalEvidence)} | ${label} | ${count} | ${markdownText(criterionNote(result, status, accepted), 200)} |`;
}
function observationCounts(state: Record<string, unknown>, entries: Record<string, unknown>[]) {
    const externalIds = externalEvidenceAssessmentIds(state);
    const observed = entries.filter((entry) => object(entry.result).disposition === 'observed');
    const external = observed.filter((entry) => externalIds.has(string(entry.assessmentId))).length;
    return { externalIds, external, withoutConcern: observed.length - external };
}
function findingCriteria(accounts: Record<string, unknown>[], entries: Record<string, unknown>[]): string {
    const ids = [...new Set(accounts.flatMap((a) => (Array.isArray(a.assessmentIds) ? a.assessmentIds : [])))];
    return ids
        .map((id) => {
            const entry = entries.find((e) => e.assessmentId === id);
            return markdownText(entry ? `${entry.nodeId} @ ${entry.version}` : String(id), 600);
        })
        .join(', ');
}
function findingGroup(accounts: Record<string, unknown>[], entries: Record<string, unknown>[]): string {
    const finding = accounts[0]!;
    const criteria = findingCriteria(accounts, entries);
    const locations = objects(finding.locationRefs)
        .map((c) => `${string(object(c.provenance).path)}:${object(c.location).line ?? '?'}`)
        .filter(Boolean)
        .join(', ');
    if (accounts.length === 1)
        return `- **${markdownText(finding.classification)}:** ${markdownText(finding.explanation, 800)}\n  Criterion: ${criteria}. Location: ${markdownText(locations, 500)}. Consequence: ${markdownText(finding.consequence, 500)} Correction: ${markdownText(finding.correction, 600)}`;
    const details = accounts.map(
        (account, index) =>
            `  ${index + 1}. **${markdownText(account.classification)}:** ${markdownText(account.explanation, 800)} Consequence: ${markdownText(account.consequence, 500)} Correction: ${markdownText(account.correction, 600)} Criterion: ${findingCriteria([account], entries)}. Location: ${markdownText(developerFindingLocations(account), 1500)}. Account: ${markdownText(account.findingId, 150)}.`,
    );
    return `- **${accounts.length} verified accounts at ${developerFindingGroupLabel(accounts)}.** Location: ${markdownText(locations, 500)}. Criteria: ${criteria}.\n${details.join('\n')}`;
}
function renderGovernedFindings(
    entries: Record<string, unknown>[],
    verified: Record<string, unknown>[],
    progress: ReturnType<typeof assessmentCoverage>,
): string[] {
    if (!verified.length)
        return [
            progress.savedProposals || progress.awaitingVerification || progress.needsReassessment
                ? 'Independent verification is incomplete. Recorded assessment proposals are not accepted review findings; candidate findings remain unverified.'
                : 'No independently verified finding is recorded. Inspect each criterion and its verification before relying on this result.',
        ];
    const groups = groupDeveloperFindings(verified);
    const lines = ['#### Governed findings', ...groups.slice(0, 15).map((group) => findingGroup(group, entries))];
    if (groups.length > 15)
        lines.push(`${groups.length - 15} additional source-range accounts are in the full report.`);
    return lines;
}
function assessmentHeadline(
    execution: Record<string, unknown>,
    options: PresentationOptions,
    completion: string,
    reviewExit: unknown,
    enforcement: string,
): string {
    if (
        options.failedStage ||
        (reviewExit === 2 && enforcement !== 'legacy / unavailable') ||
        (execution.stopReason && execution.stopReason !== 'finished')
    )
        return 'Execution did not finish';
    if (reviewExit === 1)
        return 'Policy requires attention' + (completion !== 'complete' ? '; assessment incomplete' : '');
    return completion !== 'complete' ? 'Assessment incomplete' : 'Bounded assessment complete';
}

export function renderAssessmentReport(input: unknown, options: PresentationOptions = {}): string {
    const state = object(input),
        execution = object(state.execution),
        reviewer = object(state.reviewer),
        artifact = object(state.artifact),
        entries = objects(state.entries),
        decision = object(state.decision),
        usage = summarizeUsage(state);
    const progress = assessmentCoverage(state);
    const findings = objects(state.findings);
    const verified = findings.filter((f) => f.verified === true);
    const completion = string(state.assessmentStatus, 'unknown');
    const reviewExit = options.reviewExit ?? decision.exitCode ?? decision.reviewExit;
    const enforcement = string(object(execution.policy).enforcement, 'legacy / unavailable');
    const health = assessmentHeadline(execution, options, completion, reviewExit, enforcement);
    const lines = [
        '### ContextRail Assess',
        `**${health}.**`,
        `Enforcement: **${markdownText(enforcement)}** · Exit: ${markdownText(reviewExit ?? 'unavailable')}. Exit 0 means policy permits continuation; inspect findings and evidence gaps below.`,
        `${markdownText(reviewer.title ?? reviewer.nodeId)} @ ${markdownText(reviewer.version)} · Head ${markdownText(object(artifact.head).commit)}.`,
        `Run ID: ${markdownText(state.runId)}.`,
    ];
    if (options.failedStage)
        lines.push(`Action ${markdownText(options.failedStage)} failed; no successful review is implied.`);
    lines.push(renderReaderGuidance(state));
    lines.push(...renderGovernedFindings(entries, verified, progress));
    const count = (d: string) => entries.filter((e) => object(e.result).disposition === d).length;
    const observed = observationCounts(state, entries);
    const focusedCoverage = object(state.concernValidation).scope === 'nominated_concerns';
    const criterionRows = entries.map((entry) =>
        criterionRow(entry, progress, verified, focusedCoverage, observed.externalIds.has(string(entry.assessmentId))),
    );
    lines.push(
        '#### Assessment coverage',
        `Assessed ${progress.assessed}/${progress.total}; awaiting verification ${progress.awaitingVerification}; needs reassessment ${progress.needsReassessment}; ${focusedCoverage ? 'contexts with nominated concerns checked' : 'verified'} ${progress.verified}; unexamined ${progress.unexamined}. Final outcomes: evaluated ${count('evaluated')}, observed ${count('observed')} (${observed.withoutConcern} with no concern identified; ${observed.external} with external evidence limitations), not applicable ${count('not_applicable')}, unresolved ${count('unresolved')}, not evaluated ${count('not_evaluated')}.`,
        '| Criterion / version | Outcome | Verification | Verified findings | Note |\n| --- | --- | --- | --- | --- |\n' +
            (criterionRows.join('\n') ||
                '| No governed criteria recorded | Unavailable | Not checked | 0 | No assessment scope is available. |'),
        'Each original criterion is listed in its recorded order. Observed entries distinguish no concern identified from external evidence limitations; neither is independently verified compliance. Checked means independently reviewed, including confirmed evidence gaps; it does not mean the requirement is satisfied. Awaiting verification is not acceptance. Assessed counts use complete canonical assessment handoffs for this fixed comparison. Saved proposals are separate unfinished work, not unexamined criteria or verified outcomes; final outcome labels retain the canonical disposition.',
    );
    const concerns = object(state.concernValidation);
    if (concerns.scope === 'nominated_concerns' && number(concerns.expected) && number(concerns.validated))
        lines.push(
            `Concern validation: ${concerns.validated}/${concerns.expected} nominated concerns checked. This count does not certify every observation or every obligation in a standard.`,
        );
    if (progress.savedProposals)
        lines.push(
            `Saved proposals: ${progress.savedProposals}. Assessment handoff incomplete; these are not verified outcomes.`,
        );
    lines.push(renderChangeSummary(state));
    lines.push(renderRunDetails(execution, usage, options));
    return lines.join('\n\n') + '\n';
}
/** Compact developer view; the Action summary retains the complete audit explanation. */
export function renderAssessmentComment(input: unknown, options: PresentationOptions = {}): string {
    const state = object(input),
        entries = objects(state.entries),
        execution = object(state.execution);
    const progress = assessmentCoverage(state);
    const verified = objects(state.findings).filter((finding) => finding.verified === true);
    const questions = entries.filter((entry) => object(entry.result).disposition === 'unresolved');
    const count = (value: string) => entries.filter((entry) => object(entry.result).disposition === value).length;
    const observed = observationCounts(state, entries);
    const exit = options.reviewExit ?? object(state.decision).exitCode ?? object(state.decision).reviewExit;
    const failed = Boolean(
        options.failedStage || exit === 2 || (execution.stopReason && execution.stopReason !== 'finished'),
    );
    const violations = verified.filter((finding) => finding.classification === 'binding_violation').length;
    const outcome = violations
        ? `${violations} confirmed violation${violations === 1 ? '' : 's'}`
        : 'No confirmed violations';
    const pending = progress.awaitingVerification + progress.needsReassessment + progress.unexamined;
    const headline = failed
        ? 'Review could not finish'
        : pending || (state.assessmentStatus !== 'complete' && !questions.length)
          ? 'Assessment incomplete'
          : outcome;
    const policy = string(object(execution.policy).enforcement);
    const lines = [
        assessLogoBaseUrl
            ? `### <picture><source media="(prefers-color-scheme: dark)" srcset="${assessLogoBaseUrl}/icon-dark.png"><img src="${assessLogoBaseUrl}/icon-light.png" height="22" alt="ContextRail"></picture>&nbsp; ContextRail Assess`
            : '### ContextRail Assess',
        `**${headline}${questions.length ? ` · ${questions.length} question${questions.length === 1 ? '' : 's'} remain${questions.length === 1 ? 's' : ''}` : ''}**${policy ? ` · ${markdownText(policy)}` : ''}`,
    ];
    if (failed)
        lines.push(
            options.failedStage
                ? `Action ${markdownText(options.failedStage)} failed. Results below are partial; see run details.`
                : 'Results below are partial. See the workflow run for the failure and retry details.',
        );
    const summary = object(state.changeSummary),
        accepted = object(summary.accepted);
    if (summary.status === 'verified' && typeof accepted.overview === 'string')
        lines.push(
            markdownText(
                [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(accepted.overview)]
                    .slice(0, 2)
                    .map((part) => part.segment)
                    .join(''),
                600,
            ),
        );
    if (verified.length) {
        lines.push('#### Governed findings');
        for (const finding of verified) lines.push(compactFinding(finding, entries, options));
    }
    if (questions.length) {
        lines.push('#### Needs your attention');
        for (const entry of questions) {
            const result = object(entry.result),
                action = questionAction(state, entry);
            lines.push(
                `- **${criterionTitle(entry)}:** ${briefText(result.explanation, 2)}${action ? ` **Next:** ${briefText(action, 1)}` : ''}${sourceLinks(result.citations, options)}`,
            );
        }
    }
    const externalFollowUps = renderExternalFollowUps(state, true);
    if (externalFollowUps) lines.push(externalFollowUps);
    lines.push(
        `${progress.assessed}/${progress.total} standards assessed · ${observed.withoutConcern} with no concern identified${observed.external ? ` · ${observed.external} with external evidence limitations` : ''} · ${questions.length} unresolved${pending ? ` · ${pending} awaiting assessment or verification` : ''}${count('not_applicable') ? ` · ${count('not_applicable')} not applicable` : ''}`,
    );
    const rows = entries.map((entry) =>
        criterionRow(
            entry,
            progress,
            verified,
            object(state.concernValidation).scope === 'nominated_concerns',
            observed.externalIds.has(string(entry.assessmentId)),
        ),
    );
    lines.push(
        '<details>\n<summary>Standards and evidence</summary>\n\n' +
            'No concern identified is an observation, not independently verified compliance.\n\n' +
            '| Criterion / version | Outcome | Verification | Verified findings | Note |\n| --- | --- | --- | --- | --- |\n' +
            rows.join('\n') +
            '\n\n' +
            compactEvidence(state) +
            '\n\n</details>',
    );
    const details = renderRunDetails(execution, summarizeUsage(state), options);
    const identity = `Run ID: ${markdownText(state.runId)}. Reviewer: ${markdownText(object(state.reviewer).title ?? object(state.reviewer).nodeId)} @ ${markdownText(object(state.reviewer).version)}. Exit: ${markdownText(exit ?? 'unavailable')}.`;
    lines.push(details.replace('\n\n</details>', `\n\n${identity}\n\n</details>`));
    const links = [
        isArtifactUrl(options.artifactUrl) ? `[Full audit](${options.artifactUrl})` : '',
        runUrl(options.runUrl) ? `[Workflow run](${options.runUrl})` : '',
        object(object(state.artifact).head).commit
            ? `Reviewed ${markdownText(string(object(object(state.artifact).head).commit).slice(0, 7))}`
            : '',
    ].filter(Boolean);
    if (links.length) lines.push(links.join(' · '));
    return lines.join('\n\n') + '\n';
}
function briefText(value: unknown, sentences: number): string {
    const text = string(value);
    const parts = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text)];
    const excerpt = parts
        .slice(0, sentences)
        .map((part) => part.segment)
        .join('')
        .trim();
    return markdownText(excerpt, 650) + (parts.length > sentences ? ' …' : '');
}
function questionAction(state: Record<string, unknown>, entry: Record<string, unknown>): string {
    const ids = new Set(
        objects(state.observations)
            .filter((item) => item.assessmentId === entry.assessmentId)
            .map((item) => item.id),
    );
    const actions = objects(state.concernDecisions)
        .filter(
            (decision) =>
                ids.has(decision.observationId) &&
                ['missing_evidence', 'ambiguous_rule'].includes(string(decision.decision)),
        )
        .map((decision) => string(decision.correction))
        .filter(Boolean);
    return [...new Set(actions)].join(' ') || string(object(entry.result).correction);
}
function compactEvidence(state: Record<string, unknown>): string {
    const changeSummary = object(state.changeSummary);
    const summary = changeSummary.status === 'verified' ? object(changeSummary.accepted) : {};
    const focus = Array.isArray(summary.reviewFocus)
        ? summary.reviewFocus.filter((value) => typeof value === 'string')
        : [];
    const lines = focus.length
        ? ['Suggested review focus:', ...focus.map((value) => `- ${markdownText(value, 1000)}`)]
        : [];
    for (const entry of objects(state.entries).filter((entry) => object(entry.result).disposition === 'unresolved')) {
        const result = object(entry.result),
            action = questionAction(state, entry);
        lines.push(
            `**${criterionTitle(entry)}:** ${markdownText(result.explanation, 5000)}${action ? ` Next: ${markdownText(action, 5000)}` : ''}`,
        );
    }
    return lines.join('\n\n');
}
function sourceLinks(citations: unknown, options: PresentationOptions): string {
    const repository = runUrl(options.runUrl) ? options.runUrl!.split('/').slice(3, 5).join('/') : null;
    const sources = objects(citations).filter((citation) => object(citation.provenance).kind === 'source');
    const links = sources.slice(0, 2).map((citation) => {
        const provenance = object(citation.provenance),
            line = object(citation.location).line;
        const path = string(provenance.path),
            commit = string(provenance.commit);
        const label = markdownText(`${path}:${line ?? '?'}`, 200);
        if (!repository || !/^[a-f0-9]{40}$/.test(commit) || !Number.isSafeInteger(line) || Number(line) < 1)
            return label;
        const encoded = path
            .split('/')
            .map((part) =>
                encodeURIComponent(part).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16)}`),
            )
            .join('/');
        return `[${label}](https://github.com/${repository}/blob/${commit}/${encoded}#L${line})`;
    });
    return links.length ? ` · ${links.join(' · ')}` : '';
}
function criterionTitle(entry: Record<string, unknown>): string {
    return markdownText(
        entry.title ?? string(entry.nodeId).split('/').at(-1)?.replace(/-/g, ' ') ?? entry.assessmentId,
        160,
    );
}
function compactFinding(
    finding: Record<string, unknown>,
    entries: Record<string, unknown>[],
    options: PresentationOptions,
): string {
    const labels: Record<string, string> = {
        binding_violation: 'Violation',
        behavioral_defect: 'Defect',
        guidance_departure: 'Suggestion',
    };
    const ids = Array.isArray(finding.assessmentIds) ? finding.assessmentIds : [];
    const titles = entries
        .filter((entry) => ids.includes(entry.assessmentId))
        .map(criterionTitle)
        .join(', ');
    const location = sourceLinks(finding.locationRefs, options);
    return `- **${labels[string(finding.classification)] ?? 'Finding'} — ${titles}:** ${markdownText(finding.explanation, 650)} ${markdownText(finding.consequence, 350)} **Next:** ${markdownText(finding.correction, 450)}${location}`;
}
function providerFailures(execution: Record<string, unknown>) {
    const failureGroups = new Map<string, number>(),
        failureCalls = new Set<number>();
    for (const call of objects(execution.providerUsage)) {
        if (
            !number(call.call) ||
            !Number.isInteger(call.call) ||
            call.call < 1 ||
            !number(execution.calls) ||
            call.call > execution.calls ||
            failureCalls.has(call.call)
        )
            continue;
        if (
            !number(call.httpStatus) ||
            !Number.isInteger(call.httpStatus) ||
            call.httpStatus < 400 ||
            call.httpStatus > 599 ||
            !PROVIDER_FAILURE_CODES.some((code) => code === call.failureCode)
        )
            continue;
        failureCalls.add(call.call);
        const key = `${call.httpStatus} ${call.failureCode}`;
        failureGroups.set(key, (failureGroups.get(key) ?? 0) + 1);
    }
    return [...failureGroups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
function renderRunDetails(
    execution: Record<string, unknown>,
    usage: ReturnType<typeof summarizeUsage>,
    options: PresentationOptions,
): string {
    const failures = providerFailures(execution);
    const details = [
        `Duration: ${duration(execution.elapsedMs)}. Reported model cost: ${metricText(usage.cost, usage.calls, true)}.`,
        options.diagnostic ? `Diagnostic: ${markdownText(options.diagnostic, 1000)}` : '',
        `Execution stop: ${markdownText(execution.stopReason)}.${options.packageVersion ? ` Package: ${markdownText(options.packageVersion)}.` : ''}`,
        failures.length
            ? `Provider failures: ${failures
                  .slice(0, 8)
                  .map(([key, count]) => `${key} (${count} ${count === 1 ? 'call' : 'calls'})`)
                  .join('; ')}.${failures.length > 8 ? ` ${failures.length - 8} additional groups in the report.` : ''}`
            : '',
        runUrl(options.runUrl) ? `[Workflow run](${options.runUrl})` : '',
        isArtifactUrl(options.artifactUrl) ? `[Artifact bundle](${options.artifactUrl})` : '',
        'Cost is provider-reported, not a verified invoice; missing cost is not zero.',
    ].filter(Boolean);
    return `<details>\n<summary>Run details</summary>\n\n${details.join('\n\n')}\n\n</details>`;
}
export function renderActionSummary(input: unknown, options: PresentationOptions = {}): string {
    const state = object(input),
        e = object(state.execution),
        usage = summarizeUsage(state);
    const coverage = assessmentCoverage(state);
    const rows = [
        ['Execution stop', markdownText(e.stopReason)],
        [
            'Assessed / awaiting verification / needs reassessment / unexamined',
            `${coverage.assessed} / ${coverage.awaitingVerification} / ${coverage.needsReassessment} / ${coverage.unexamined}`,
        ],
        ['Saved proposals / incomplete assessment handoff', String(coverage.savedProposals)],
        ['Review duration', duration(e.elapsedMs)],
        ['Calls / completed SDK steps', `${usage.calls ?? 'unavailable'} / ${e.steps ?? 'unavailable'}`],
        ['Reported model cost', metricText(usage.cost, usage.calls, true)],
        ['Input tokens (cumulative across calls)', metricText(usage.input, usage.calls)],
        ['Output tokens (includes reasoning)', metricText(usage.output, usage.calls)],
        ['Total tokens', metricText(usage.total, usage.calls)],
        ['Cached input tokens', metricText(usage.cached, usage.calls)],
        ['Reasoning tokens (part of output)', metricText(usage.reasoning, usage.calls)],
        [
            'ContextRail reporting',
            markdownText(object(e.reporting).status) +
                (object(e.reporting).status === 'received' ? ' (ingestion receipt only)' : ''),
        ],
        ['Comparison', markdownText(options.comparisonStatus ?? 'Currency unknown; verify SHAs before use')],
    ];
    const phases = objects(state.phases ?? e.phases);
    const configurations = object(e.phaseModels);
    const phaseNames = [...new Set([...Object.keys(configurations), ...phases.map((p) => string(p.phase))])];
    const phaseRows = phaseNames.map((name) => {
        const matching = phases.filter((p) => p.phase === name),
            configuration = object(
                configurations[name] ?? matching[0]?.configuration ?? matching[0]?.effectiveConfiguration,
            );
        const records = objects(e.providerUsage).filter((r) => r.phase === name);
        const costs = records.map((r) => object(r.usage).cost).filter(number);
        const starts = matching.map((p) => Date.parse(string(p.startedAt))).filter(Number.isFinite),
            ends = matching.map((p) => Date.parse(string(p.finishedAt))).filter(Number.isFinite);
        return `| ${markdownText(name)} | ${markdownText(configuration.provider)}/${markdownText(configuration.model)} | ${matching.length ? matching.map((p) => markdownText(p.status)).join(', ') : 'not started'} | ${starts.length && ends.length ? duration(Math.max(...ends) - Math.min(...starts)) : 'unavailable'} | ${records.length} | ${costs.length ? '$' + costs.reduce((a, b) => a + b, 0).toFixed(6) + (costs.length === records.length ? '' : ' partial') : 'unavailable'} |`;
    });
    const phaseTable = phaseRows.length
        ? `\n#### Phase health\n\n| Phase | Effective model | Outcome | Elapsed window | Calls | Reported USD |\n| --- | --- | --- | --- | --- | --- |\n${phaseRows.join('\n')}\n`
        : '';
    const alerts = [
        options.feedback === 'send' && object(e.reporting).status !== 'received'
            ? 'ContextRail reporting receipt not confirmed'
            : '',
        options.artifactOutcome && options.artifactOutcome !== 'success' ? 'Evidence upload not confirmed' : '',
    ].filter(Boolean);
    return (
        renderAssessmentReport(state, options) +
        (alerts.length ? `\n**Operational alerts:** ${alerts.join('; ')}.\n` : '') +
        `\n#### Health / performance\n\n| Health / performance | Observed |\n| --- | --- |\n${rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}\n` +
        phaseTable
    );
}
function recordModelIdentity(execution: Record<string, unknown>, config: Record<string, unknown>) {
    const phases = Object.entries(object(execution.phaseModels)).map(([phase, configuration]) => {
        const c = object(configuration);
        return {
            phase: clip(phase, 40),
            provider: ['openai', 'openrouter'].includes(string(c.provider)) ? c.provider : 'unknown',
            model: clip(c.model, 200),
            effort: clip(c.effort, 20),
        };
    });
    if (!phases.length)
        return {
            provider: ['openai', 'openrouter'].includes(string(config.provider)) ? config.provider : 'unknown',
            model: clip(config.model, 200),
            effort: clip(config.effort, 20),
            phaseModels: phases,
        };
    const shared = (key: 'provider' | 'model' | 'effort', mixed: string) =>
        new Set(phases.map((p) => p[key])).size === 1 ? phases[0]![key] : mixed;
    return {
        provider: shared('provider', 'unknown'),
        model: shared('model', 'mixed'),
        effort: shared('effort', ''),
        phaseModels: phases,
    };
}
export function runRecord(
    config: HistoryConfiguration & Record<string, unknown>,
    fixed: unknown,
    input: unknown,
    exit: unknown,
    cost: unknown,
    costComplete: boolean,
): RunRecord {
    const state = object(input),
        execution = object(state.execution),
        f = object(fixed),
        entries = objects(state.entries),
        r = object(state.reviewer);
    const row = runSchema.parse({
        ...recordModelIdentity(execution, config),
        cliRunId: /^[A-Za-z0-9_-]{1,200}$/.test(string(state.runId)) ? state.runId : null,
        id: string(config.githubRun),
        attempt: config.githubAttempt,
        at: new Date().toISOString(),
        base: f.base ?? null,
        head: f.head ?? null,
        assessment: ['complete', 'incomplete', 'running', 'not_started'].includes(string(state.assessmentStatus))
            ? state.assessmentStatus
            : 'unknown',
        execution:
            execution.stopReason === 'finished'
                ? 'finished'
                : Object.keys(execution).length || exit === 2
                  ? 'failed'
                  : 'unknown',
        exit: [0, 1, 2].includes(exit as number) ? exit : null,
        findings: entries.filter((e) =>
            ['binding_violation', 'behavioral_defect', 'guidance_departure'].includes(string(object(e.result).finding)),
        ).length,
        unresolved: entries.filter((e) => object(e.result).disposition === 'unresolved').length,
        durationMs: number(execution.elapsedMs) ? execution.elapsedMs : null,
        cost: number(cost) ? cost : null,
        costComplete,
        packageVersion: clip(config.packageVersion, 100),
        reviewerVersion: number(r.version) ? r.version : null,
    });
    const assessment =
        execution.stopReason === 'finished' &&
        entries.length &&
        entries.every(
            (e) =>
                ['evaluated', 'observed', 'unresolved', 'not_applicable'].includes(
                    string(object(e.result).disposition),
                ) &&
                number(e.version) &&
                e.version > 0,
        )
            ? assessmentSchema.parse({
                  base: f.base,
                  head: f.head,
                  run: row.id,
                  cliRunId: row.cliRunId,
                  attempt: row.attempt,
                  reviewerVersion: row.reviewerVersion,
                  provider: row.provider,
                  model: row.model,
                  effort: row.effort,
                  scopeIdentity: clip(state.scopeIdentity, 150),
                  omitted: Math.max(0, entries.length - 30),
                  entries: entries.slice(0, 30).map((e) => ({
                      nodeId: e.nodeId,
                      version: e.version,
                      disposition: object(e.result).disposition,
                      finding: object(e.result).finding ?? 'none',
                      explanation: clip(object(e.result).explanation, 300),
                      correction: clip(object(e.result).correction, 200),
                  })),
              })
            : null;
    return { row, assessment };
}
function historyRow(r: AssessmentHistory['runs'][number], repository: string): string {
    const cost = r.cost === null ? 'unavailable' : '$' + r.cost.toFixed(6) + (r.costComplete ? '' : ' partial');
    return `| [${r.id}/${r.attempt}](https://github.com/${repository}/actions/runs/${r.id}/attempts/${r.attempt}) | ${r.head?.slice(0, 7) ?? 'unknown'} | ${r.execution} / ${r.assessment} | ${r.findings} | ${r.unresolved} | ${cost} |`;
}
function appendRunHistory(summary: string, table: string): string {
    const start = summary.indexOf('<summary>Run details</summary>');
    const end = start < 0 ? -1 : summary.indexOf('</details>', start);
    return end < 0
        ? `${summary}\n<details>\n<summary>Run details</summary>\n\n${table}\n</details>`
        : summary.slice(0, end) + table + '\n' + summary.slice(end);
}
function historyExceedsLimit(body: string, history: AssessmentHistory): boolean {
    return body.length > 60000 || Buffer.byteLength(JSON.stringify(history)) > 30000;
}
export function withHistory(
    summary: string,
    previous: { body?: unknown } | null,
    current: RunRecord,
    c: HistoryConfiguration,
): string {
    const old = readHistory(previous?.body, c);
    const runs = (old?.runs ?? []).filter(
        (r) => r.id !== current.row.id || r.attempt !== current.row.attempt || r.cliRunId !== current.row.cliRunId,
    );
    runs.push(current.row);
    runs.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : a.attempt - b.attempt));
    const history: AssessmentHistory = {
        version: 2,
        repository: c.repository,
        pr: c.pr,
        reviewer: c.reviewer,
        runs,
        omitted: old?.omitted ?? 0,
        assessment: current.assessment ?? old?.assessment ?? null,
    };
    while (history.runs.length > 10) {
        history.runs.shift();
        history.omitted++;
    }
    const render = () => {
        const rows = history.runs.slice(-3).map((r) => historyRow(r, c.repository));
        const table = `#### Review history\n\n| Run / attempt | Head | Execution / assessment | Findings | Unresolved | Reported USD |\n| --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\n${history.omitted + Math.max(0, history.runs.length - 3)} older rows not shown. Full retained history remains in the comment state.\n`;
        return `${assessmentMarker(c)}\n<!-- contextrail-run:${current.row.id}:${current.row.attempt} -->\n<!-- contextrail-state:v2:${Buffer.from(JSON.stringify(history)).toString('base64')} -->\n${appendRunHistory(summary, table)}`;
    };
    let body = render();
    while (historyExceedsLimit(body, history) && history.runs.length > 1) {
        history.runs.shift();
        history.omitted++;
        body = render();
    }
    if (historyExceedsLimit(body, history)) {
        history.assessment = null;
        body = render();
    }
    historySchema.parse(history);
    if (body.length > 60000) throw new Error('history_invalid');
    return body;
}
