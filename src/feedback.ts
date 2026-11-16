import { packageVersion } from './version.js';
import { reviewReportInputSchema, type ReviewReportInput, type ReviewReportReceipt } from './report-contract.js';
import { reportedUsage } from './providers.js';
import type { AssessmentState } from './assess.js';

export type ReportingStatus =
    | { status: 'pending' | 'off' }
    | { status: 'received'; receipt: ReviewReportReceipt }
    | {
          status: 'failed';
          code:
              | 'projection_invalid'
              | 'sender_unavailable'
              | 'submission_failed'
              | 'receipt_invalid'
              | 'local_status_write_failed'
              | 'finalization_unavailable';
      };
export interface AssessmentFeedbackSender {
    submitReport(report: ReviewReportInput): Promise<unknown>;
}

/** An unresolved criterion can still have independently verified, actionable finding accounts. */
function reportedFinding(state: AssessmentState, entry: AssessmentState['entries'][number]) {
    if (entry.result.disposition !== 'unresolved') return 'finding' in entry.result ? entry.result.finding : 'none';
    const classes = state.findings
        .filter((finding) => finding.verified && finding.assessmentIds.includes(entry.assessmentId))
        .map((finding) => finding.classification);
    return (
        (['binding_violation', 'behavioral_defect', 'guidance_departure'] as const).find((classification) =>
            classes.includes(classification),
        ) ?? 'none'
    );
}
function externalEvidenceCounts(state: AssessmentState, assessmentId: string) {
    const counts = { external_dependency: 0, operational_state: 0, business_record: 0 };
    for (const item of state.followUps ?? []) {
        if (
            item.assessmentId !== assessmentId ||
            item.kind !== 'external_evidence' ||
            !item.verified ||
            item.required ||
            !item.externalEvidence
        )
            continue;
        counts[item.externalEvidence.kind]++;
    }
    return Object.values(counts).some((count) => count > 0) ? { externalEvidence: counts } : {};
}
/** Construct from the allowlist. Never serialize local state then remove fields. */
export function projectAssessmentReport(state: AssessmentState, repositoryAttribution = false): ReviewReportInput {
    if (!state.reviewer || !state.decision || state.assessmentStatus === 'running')
        throw new Error('assessment_not_finalized');
    const e = state.execution;
    const phaseProviders = Object.values(e.phaseModels ?? { shared: e.requested });
    const providers = new Set(phaseProviders.map((profile) => profile.provider));
    const models = new Set(phaseProviders.map((profile) => profile.model));
    const stop: Record<string, ReviewReportInput['stopReason']> = {
        finished: 'finished',
        preparation_incomplete: 'preparation_incomplete',
        cancelled: 'cancelled',
        max_time_ms: 'timeout',
        max_turns: 'max_turns',
        model_call_limit: 'max_turns',
        max_total_tokens: 'max_total_tokens',
        usage_unavailable: 'usage_unavailable',
        provider_error: 'provider_error',
        execution_error: 'execution_error',
        report_delivery_failed: 'report_delivery_failed',
        per_call_output_limit: 'output_limit',
        model_stopped: 'model_stopped',
        total_token_limit_unmeasurable: 'usage_unavailable',
    };
    const repository = state.artifact.repositoryEnvironment;
    return reviewReportInputSchema.parse({
        kind: 'review_report',
        contractVersion: 1,
        runId: state.runId,
        origin: 'npm',
        packageVersion,
        methodVersion: state.concernValidation ? 'candidate-adherence-v3' : 'artifact-review-v1',
        reviewer: { nodeId: state.reviewer.nodeId, version: state.reviewer.version },
        repository: repositoryAttribution
            ? repository.status === 'reported'
                ? { status: 'reported', provider: repository.provider, owner: repository.owner, name: repository.name }
                : { status: 'unavailable', reason: repository.reason }
            : { status: 'unavailable', reason: 'withheld' },
        scope: {
            enumeration: state.preparationStatus === 'prepared' ? 'complete' : 'incomplete',
            expectedCount: state.expectedContextCount,
            expected: state.entries.map((entry) => ({
                entryId: entry.assessmentId,
                context: { nodeId: entry.nodeId, version: entry.version },
            })),
        },
        outcomes: state.entries.map((entry) => ({
            entryId: entry.assessmentId,
            disposition: entry.result.disposition,
            adherence: entry.result.adherence,
            confidence: entry.result.confidence,
            finding: reportedFinding(state, entry),
            blocking: state.decision!.reasons.some(
                (reason) => reason.assessmentId === entry.assessmentId && reason.blocking,
            ),
            ...externalEvidenceCounts(state, entry.assessmentId),
        })),
        runner: {
            policy: {
                enforcement: e.policy.enforcement,
            },
            reviewExit: state.decision.reviewExit,
            exitCode: state.decision.exitCode,
        },
        completion: state.assessmentStatus,
        ...(state.concernValidation ? { concernValidation: state.concernValidation } : {}),
        stopReason: stop[e.stopReason ?? ''] ?? 'execution_error',
        telemetry: {
            durationMs: e.elapsedMs,
            provider: providers.size === 1 ? phaseProviders[0]!.provider : null,
            model: providers.size === 1 && models.size === 1 ? phaseProviders[0]!.model : null,
            harness: 'contextrail-assess',
            returned: e.returnedIdentities.map((id) => ({ provider: id.provider, model: id.model })),
            calls: e.calls,
            usage: Array.from({ length: e.calls }, (_, i) => {
                const call = e.providerUsage.find((u) => u.call === i + 1);
                const u = reportedUsage(call?.provider ?? e.requested.provider, call?.usage);
                return {
                    call: i + 1,
                    inputTokens: u.inputTokens,
                    outputTokens: u.outputTokens,
                    totalTokens: u.totalTokens,
                    cachedInputTokens: u.cachedInputTokens,
                    reasoningTokens: u.reasoningTokens,
                };
            }),
        },
    });
}
export async function sendAssessmentReport(
    state: AssessmentState,
    options: { mode?: 'send' | 'off'; repositoryAttribution?: boolean; sender?: AssessmentFeedbackSender },
): Promise<ReportingStatus> {
    if (options.mode === 'off') return { status: 'off' };
    let report: ReviewReportInput;
    try {
        report = projectAssessmentReport(state, options.repositoryAttribution);
    } catch {
        return { status: 'failed', code: 'projection_invalid' };
    }
    if (!options.sender) return { status: 'failed', code: 'sender_unavailable' };
    try {
        const raw = await options.sender.submitReport(report);
        if (!raw || typeof raw !== 'object') return { status: 'failed', code: 'receipt_invalid' };
        const receipt = raw as ReviewReportReceipt;
        // A hostile response must never become an arbitrary local reporting metadata bag.
        if (
            receipt.runId !== state.runId ||
            typeof receipt.duplicate !== 'boolean' ||
            typeof receipt.eventId !== 'string' ||
            !/^effectiveness:\/\/[A-Za-z0-9_/-]+$/u.test(receipt.eventId) ||
            receipt.eventId.length > 500 ||
            typeof receipt.receivedAt !== 'string' ||
            !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u.test(receipt.receivedAt) ||
            !Number.isFinite(Date.parse(receipt.receivedAt))
        )
            return { status: 'failed', code: 'receipt_invalid' };
        return {
            status: 'received',
            receipt: {
                runId: receipt.runId,
                eventId: receipt.eventId,
                receivedAt: receipt.receivedAt,
                duplicate: receipt.duplicate,
            },
        };
    } catch {
        // No provider bodies, upstream error strings or unknown keys reach diagnostics.
        return { status: 'failed', code: 'submission_failed' };
    }
}
