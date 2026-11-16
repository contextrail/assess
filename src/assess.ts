import {
    CandidateAccumulator,
    candidateSelectionSchema,
    candidateInstructions,
    concernInstructions,
    concernDecisionSchema,
    validateConcern,
    revalidateCandidate,
    projectCandidates,
    type CandidateObservation,
    type ConcernDecision,
} from './candidate.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { generateText, tool, jsonSchema, zodSchema } from 'ai';
import { z } from 'zod';
import { assessmentCoverage, assessmentProgressLabel, renderReaderGuidance } from './presentation.js';
import {
    validateChangeSummary,
    changeSummarySelectionSchema,
    phaseItems,
    type ChangeSummaryState,
} from './change-summary.js';
import { parsePrContext, type PrContext } from './pr-context.js';
import { sendAssessmentReport, type ReportingStatus, type AssessmentFeedbackSender } from './feedback.js';
import { atomicJson, digest, type PreparedState } from './prepare.js';
import {
    CitationError,
    EvidenceLedger,
    ModelIdentifiers,
    modelEvidence,
    resolveCitationSelections,
} from './evidence.js';
import {
    DEFAULT_POLICY,
    assessmentPolicySchema,
    decideExit,
    type AssessmentEntry,
    type AssessmentPolicy,
} from './results.js';
import {
    assessmentModel,
    ProviderAccountingError,
    recoverProviderCalls,
    reportedUsage,
    providerFailureDiagnostics,
    providerResponseDiagnostics,
    providerRequestDiagnostics,
    providerTransportDiagnostics,
    type ProviderConfiguration,
    type AssessmentProvider,
    type ProviderFailureCode,
} from './providers.js';
import { FixedSnapshotSource, SourceAccessError, type SourceLimits } from './source.js';
import { publicationSchema, type Publication } from './contracts.js';
import { createPhaseRecord, validatePhaseRecord, type PhaseRecord } from './phases.js';
import {
    AssessmentBudget,
    BudgetStop,
    DEFAULT_EXECUTION_LIMITS,
    type ExecutionLimits,
    type ModelPhase,
} from './budget.js';
import {
    Diagnostics,
    sanitizeRecord,
    systemFailureDiagnostics,
    submissionDiagnostics,
    submissionToolDiagnostics,
    type LogLevel,
} from './diagnostics.js';
import { exactIds, PlanCitationError } from './planning.js';
import { loadAssessmentCheckpoint, type AssessmentCheckpoint } from './resume.js';
import {
    prepareEvidencePack,
    writeEvidencePack,
    readPackPublication,
    modelPackEvidence,
    modelDiffEvidence,
    repositoryInstructionsEvidence,
    modelSourceEvidence,
} from './pack.js';
import { type AssessmentProposal, type CheckAssessment, type AssessmentFinding } from './assessment.js';
import { type VerificationEntry } from './verification.js';
export { DEFAULT_EXECUTION_LIMITS, type ExecutionLimits };
export type AssessmentState = Omit<PreparedState, 'schemaVersion' | 'entries' | 'assessmentStatus'> & {
    schemaVersion: 2;
    observations?: CandidateObservation[];
    concernDecisions?: ConcernDecision[];
    concernValidation?: { expected: number; validated: number; complete: boolean; scope: 'nominated_concerns' };
    entries: AssessmentEntry[];
    assessmentStatus: 'running' | 'complete' | 'incomplete';
    phases: PhaseRecord[];
    checks: CheckAssessment[];
    findings: AssessmentFinding[];
    followUps?: NonNullable<AssessmentProposal['followUps']>;
    changeSummary?: ChangeSummaryState;
    verification: { expected: number; verified: number; complete: boolean };
    execution: {
        requested: ProviderConfiguration;
        phaseModels: Record<ModelPhase, ProviderConfiguration>;
        limits: ExecutionLimits;
        sourceLimits: Readonly<SourceLimits>;
        policy: AssessmentPolicy;
        rubric: { adherence: 'adherence-v1'; confidence: 'model-confidence-v1' };
        purpose: string | null;
        prContext: {
            hash: string;
            capturedAt: string;
            discussion: string;
            historyRuns: number;
            previousHead: string | null;
        } | null;
        scope: string | null;
        startedAt: string;
        elapsedMs: number;
        calls: number;
        steps: number;
        stopReason: string | null;
        usage: Array<Record<string, unknown>>;
        providerUsage: Array<{
            call: number;
            provider: AssessmentProvider;
            phase: ModelPhase;
            workUnitId: string;
            usage: unknown;
            missing: boolean;
            httpStatus?: number;
            failureCode?: ProviderFailureCode;
        }>;
        returnedIdentities: Array<{ provider: string | null; model: string | null }>;
        reporting: ReportingStatus;
        capture: string;
        logLevel: LogLevel;
    };
    decision: ReturnType<typeof decideExit> | null;
};
const phaseOverridesSchema = z.strictObject({
    assess: z.unknown().optional(),
    verify: z.unknown().optional(),
});
const providerSchema = z.strictObject({
    provider: z.enum(['openai', 'openrouter']),
    model: z.string().min(1),
    effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']).optional(),
});
function phaseConfiguration(defaults: ProviderConfiguration, overrides: unknown = {}) {
    const base = providerSchema.parse(defaults),
        parsed = phaseOverridesSchema.parse(overrides);
    return Object.fromEntries(
        (['assess', 'verify'] as const).map((p) => [
            p,
            parsed[p] === undefined ? base : providerSchema.parse(parsed[p]),
        ]),
    ) as Record<ModelPhase, ProviderConfiguration>;
}
const sourceSide = z.enum(['base', 'head']);
const integer = z.number().int().nonnegative().optional();
const sensitivePath = (path: string) =>
    path
        .split('/')
        .some((part) => /^\.env(?:\.|$)|^(?:credentials|secrets)(?:\.|$)|\.(?:pem|key|p12|pfx)$/iu.test(part));
const phaseFilename = (phase: string, unit: string, attempt: number) => `${phase}-${unit}-${attempt}.json`;
const requireRuntime = createRequire(import.meta.url);
const runtimeVersion = (name: string) => {
    try {
        return (
            JSON.parse(readFileSync(join(dirname(requireRuntime.resolve(name)), '..', 'package.json'), 'utf8')) as {
                version: string;
            }
        ).version;
    } catch {
        return 'unavailable';
    }
};
const cleanIdentity = (value: unknown) =>
    typeof value === 'string' && /^[A-Za-z0-9._:/+-]{1,200}$/u.test(value) ? value : null;
function normalizedWireUsage(raw: unknown) {
    if (!raw || typeof raw !== 'object') return null;
    const allow = [
        'input_tokens',
        'output_tokens',
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
        'cost',
        'input_tokens_details',
        'output_tokens_details',
        'prompt_tokens_details',
        'completion_tokens_details',
    ];
    return Object.fromEntries(
        Object.entries(raw)
            .filter(([key]) => allow.includes(key))
            .map(([key, value]) => [
                key,
                value && typeof value === 'object'
                    ? Object.fromEntries(
                          Object.entries(value).filter(
                              ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
                          ),
                      )
                    : typeof value === 'number' && Number.isFinite(value) && value >= 0
                      ? value
                      : null,
            ]),
    );
}
type AssessmentOptions = {
    prepared: { state: PreparedState; statePath: string; materialPath: string; manifestPath?: string };
    provider: ProviderConfiguration;
    phaseModels?: Partial<Record<ModelPhase, ProviderConfiguration>>;
    logLevel?: LogLevel;
    policy?: Partial<AssessmentPolicy>;
    limits?: Partial<ExecutionLimits>;
    sourceLimits?: Partial<SourceLimits>;
    purpose?: string;
    prContext?: PrContext;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    feedback?: 'send' | 'off';
    feedbackSender?: AssessmentFeedbackSender;
    repositoryAttribution?: boolean;
    resume?: AssessmentCheckpoint;
};
function initialAssessmentState(
    options: AssessmentOptions,
    source: FixedSnapshotSource,
    budget: AssessmentBudget,
    prContext: PrContext | null,
    settings: {
        models: Record<ModelPhase, ProviderConfiguration>;
        logLevel: LogLevel;
        limits: ExecutionLimits;
    },
): AssessmentState {
    const { prepared } = options,
        { models, logLevel, limits } = settings;
    return {
        ...structuredClone(prepared.state),
        schemaVersion: 2,
        entries: structuredClone(prepared.state.entries),
        assessmentStatus: 'running',
        phases: [],
        checks: [],
        findings: [],
        concernValidation: { expected: 0, validated: 0, complete: false, scope: 'nominated_concerns' },
        verification: { expected: prepared.state.entries.length, verified: 0, complete: false },
        decision: null,
        limitations: prepared.state.limitations
            .filter((v) => !v.startsWith('Prepared means'))
            .concat(
                'No runtime code was executed. Exact citations and accounting do not prove interpretation correctness or exhaustive review.',
            ),
        execution: {
            requested: options.provider,
            phaseModels: models,
            limits,
            sourceLimits: source.limits,
            policy: assessmentPolicySchema.parse({ ...DEFAULT_POLICY, ...options.policy }),
            rubric: { adherence: 'adherence-v1', confidence: 'model-confidence-v1' },
            purpose: options.purpose ?? null,
            prContext: prContext
                ? {
                      hash: digest(sanitizeRecord(prContext)),
                      capturedAt: prContext.capturedAt,
                      discussion: prContext.discussion.status,
                      historyRuns: prContext.history.runs.length,
                      previousHead: prContext.history.assessment?.head ?? null,
                  }
                : null,
            scope: null,
            startedAt: new Date().toISOString(),
            elapsedMs: 0,
            calls: 0,
            steps: 0,
            stopReason: null,
            usage: [],
            providerUsage: [],
            returnedIdentities: [],
            reporting: { status: 'pending' },
            capture:
                'Bounded phase assessment artifacts and safe diagnostic metadata. No raw prompt/response conversations, headers, error bodies or hidden reasoning. Caller-managed access and retention.',
            logLevel,
        },
    };
}
function restoreCheckpoint(
    options: AssessmentOptions,
    directory: string,
    state: AssessmentState,
    ledger: EvidenceLedger,
) {
    const { prepared } = options;
    if (options.resume) {
        const loaded = loadAssessmentCheckpoint(directory, {
            artifact: prepared.state.artifact,
            reviewerId: prepared.state.requestedReviewerId,
        });
        if (
            digest(loaded.checkpoint) !== digest(options.resume) ||
            digest(loaded.prepared.state) !== digest(prepared.state)
        )
            throw new Error('resume_checkpoint_changed');
        const old = options.resume.state;
        if (
            old.phases.some((p) => p.phase === 'assess' && p.configuration.promptVersion !== 'candidate-observation-v2')
        )
            throw Error('resume_method_changed_start_new_assessment');
        if (
            old.runId !== state.runId ||
            digest(old.artifact) !== digest(state.artifact) ||
            old.scopeIdentity !== state.scopeIdentity ||
            digest(old.execution.phaseModels) !== digest(state.execution.phaseModels) ||
            digest(old.execution.sourceLimits) !== digest(state.execution.sourceLimits) ||
            digest(old.execution.policy) !== digest(state.execution.policy) ||
            old.execution.purpose !== state.execution.purpose ||
            old.execution.prContext?.hash !== state.execution.prContext?.hash
        )
            throw new Error('resume_configuration_changed');
        state.phases = structuredClone(old.phases);
        state.execution.usage = structuredClone(old.execution.usage);
        state.execution.providerUsage = structuredClone(old.execution.providerUsage);
        state.execution.returnedIdentities = structuredClone(old.execution.returnedIdentities);
        state.execution.calls = old.execution.calls;
        state.execution.steps = old.execution.steps;
        for (const record of Object.values(options.resume.evidence))
            ledger.add(record.text, record.provenance, record.fragments);
    }
}
async function restorePreparationManifest(
    options: AssessmentOptions,
    state: AssessmentState,
    directory: string,
    _material: Record<string, Publication>,
    ledger: EvidenceLedger,
    preparedManifest: unknown,
) {
    if (options.resume) {
        const latest = state.phases.filter((p) => p.phase === 'assess' && p.workUnitId === 'all').at(-1);
        if (latest?.status === 'complete')
            for (const p of phaseItems<AssessmentProposal>(latest.output, 'assessments'))
                revalidateCandidate(p, state.entries, ledger);
        else if (latest) {
            const partial = JSON.parse(
                await readFile(join(directory, 'phases', `partial-assess-all-${latest.attempt}.json`), 'utf8').catch(
                    () => 'null',
                ),
            );
            if (partial)
                for (const p of (partial.output as { assessments: AssessmentProposal[] }).assessments)
                    revalidateCandidate(p, state.entries, ledger);
        }
        await atomicJson(join(directory, 'manifest.json'), preparedManifest);
    }
}
async function createAssessmentRuntime(options: AssessmentOptions) {
    const { prepared } = options,
        directory = dirname(prepared.statePath),
        source = new FixedSnapshotSource(prepared.state.artifact, options.sourceLimits);
    const models = phaseConfiguration(options.provider, options.phaseModels),
        logLevel = options.logLevel ?? 'info';
    if (!['quiet', 'info', 'debug'].includes(logLevel)) throw new Error('invalid_log_level');
    const limits = { ...DEFAULT_EXECUTION_LIMITS, ...options.limits },
        budget = new AssessmentBudget(limits);
    const prContext = options.prContext
        ? parsePrContext(
              options.prContext,
              prepared.state.artifact,
              prepared.state.reviewer?.nodeId ?? options.prContext.reviewer,
          )
        : null;
    const state = initialAssessmentState(options, source, budget, prContext, { models, logLevel, limits });
    const diagnostics = new Diagnostics(directory, state.runId, logLevel),
        ledger = new EvidenceLedger();
    restoreCheckpoint(options, directory, state, ledger);
    const invocationPhaseIndex = state.phases.length;
    const previousCalls = state.execution.calls,
        previousElapsed = options.resume?.state.execution.elapsedMs ?? 0;

    await mkdir(join(directory, 'phases'), { recursive: true, mode: 0o700 });
    let writes = Promise.resolve();
    const persist = () => {
        const next = writes.then(async () => {
            await atomicJson(join(directory, 'evidence.json'), sanitizeRecord(ledger.records));
            await atomicJson(prepared.statePath, sanitizeRecord(state));
        });
        writes = next.catch(() => undefined);
        return next;
    };
    const material = JSON.parse(await readFile(prepared.materialPath, 'utf8')) as Record<string, Publication>;
    const preparedManifest =
        options.resume?.preparationManifest ?? JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    await restorePreparationManifest(options, state, directory, material, ledger, preparedManifest);
    const manifestHash = digest(preparedManifest),
        materialHash = digest(material);
    return {
        options,
        prepared,
        prContext,
        directory,
        source,
        models,
        limits,
        budget,
        state,
        ledger,
        diagnostics,
        persist,
        material,
        preparedManifest,
        manifestHash,
        materialHash,
        repositoryInstructions: undefined as Awaited<ReturnType<typeof repositoryInstructionsEvidence>> | undefined,
        modelDiff: undefined as Awaited<ReturnType<typeof modelDiffEvidence>> | undefined,
        invocationPhaseIndex,
        previousCalls,
        previousElapsed,
        evidencePack: undefined as ReturnType<typeof prepareEvidencePack> | undefined,
        retainedProposals: [] as AssessmentProposal[],
    };
}
type AssessmentRuntime = Awaited<ReturnType<typeof createAssessmentRuntime>>;
type PhaseRuntime<T> = {
    run: AssessmentRuntime;
    phase: 'assess' | 'verify';
    workUnitId: string;
    assigned: AssessmentEntry[];
    payload: unknown;
    schema: z.ZodType;
    validate: (value: unknown) => T;
    attempt: number;
    startedAt: string;
    inputRefs: PhaseRecord['inputRefs'];
    phaseCalls: number[];
    timer: ReturnType<typeof setTimeout> | null;
    signal: AbortSignal;
    instructions: string;
    assessmentAccumulator: CandidateAccumulator | null;
    output: T | undefined;
    sdkStop: string | null;
    rejected: number;
    toolsThisStep: number;
    stepRejected: boolean;
    summaryFailures: number;
    summaryFallbackOutput: T | undefined;
    summaryCorrection: { code: string; correction: unknown } | null;
    remainingAtLastStep: number;
    assessmentWrites: Promise<void>;
    identifiers: ModelIdentifiers;
    verifications: Map<string, { input: unknown; result: VerificationEntry }> | null;
};
const correctionRounds = <T>(session: PhaseRuntime<T>) =>
    remainingContexts(session).length < session.remainingAtLastStep
        ? 0
        : session.rejected + Number(session.stepRejected);
async function createPhaseRuntime<T>(
    run: AssessmentRuntime,
    phase: 'assess' | 'verify',
    workUnitId: string,
    assigned: AssessmentEntry[],
    payload: unknown,
    schema: z.ZodType,
    validate: (value: unknown) => T,
    attempt = 1,
): Promise<PhaseRuntime<T>> {
    const { state, directory, budget, ledger, options, manifestHash, materialHash, retainedProposals, prepared } = run;

    const startedAt = new Date().toISOString(),
        inputRefs = [
            { ref: 'manifest.json', hash: manifestHash },
            { ref: 'publications.json', hash: materialHash },
            ...state.phases
                .filter((p) => p.status === 'complete')
                .map((p) => ({ ref: `phase:${p.phase}:${p.workUnitId}:${p.attempt}`, hash: digest(p) })),
            { ref: `input:${phase}:${workUnitId}:${attempt}`, hash: digest(sanitizeRecord(payload)) },
        ],
        phaseCalls: number[] = [];
    if (
        digest(JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'))) !== manifestHash ||
        digest(JSON.parse(await readFile(prepared.materialPath, 'utf8'))) !== materialHash
    )
        throw new Error('upstream_artifact_changed');
    for (const p of state.phases.filter((p) => p.status === 'complete')) {
        const name = phaseFilename(p.phase, p.workUnitId, p.attempt);
        if (digest(JSON.parse(await readFile(join(directory, 'phases', name), 'utf8'))) !== digest(p))
            throw new Error('upstream_phase_changed');
    }
    const remaining = budget.remainingMs(phase),
        controller = new AbortController();
    if (remaining !== null && remaining <= 0) throw new BudgetStop(phase === 'verify' ? 'max_time_ms' : 'max_time_ms');
    const timer = remaining === null ? null : setTimeout(() => controller.abort(), Math.max(1, remaining));
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    let output: T | undefined;
    const instructions =
        workUnitId === 'change-summary'
            ? 'Check the supplied change summary against pinned source and diff. Return a concise accurate overview and useful human review focus, with source references. This is reader orientation for the proposed artifacts, not additional governing rules or compliance assurance. Do not request proof that the current PR checks passed or that an operation ran; those are outside the artifact audit. Keep review focus on specific changed implementation properties. Return summary null if the evidence cannot support a useful summary. Use submit_verification.'
            : {
                  assess: candidateInstructions,
                  verify: concernInstructions,
              }[phase] +
              '\nUse the supplied context_N and evidence_N handles verbatim in identifier fields. These are exact handles, not hashes to calculate. Evidence text and line/segment numbers are unchanged.';
    const assessmentAccumulator =
        phase === 'assess' ? new CandidateAccumulator(assigned, ledger, retainedProposals) : null;
    if (assessmentAccumulator?.remaining().length === 0) output = assessmentAccumulator.snapshot() as T;
    return {
        run,
        phase,
        workUnitId,
        assigned,
        payload,
        schema,
        validate,
        attempt,
        startedAt,
        inputRefs,
        phaseCalls,
        timer,
        signal,
        instructions,
        assessmentAccumulator,
        output,
        sdkStop: null,
        rejected: 0,
        toolsThisStep: 0,
        stepRejected: false,
        summaryFailures: 0,
        summaryFallbackOutput: undefined,
        summaryCorrection: null,
        remainingAtLastStep: assessmentAccumulator?.remaining().length ?? assigned.length,
        assessmentWrites: Promise.resolve(),
        verifications: null,
        identifiers: new ModelIdentifiers(
            assigned.map((entry) => entry.assessmentId),
            ledger.records,
        ),
    };
}
async function persistPartialAssessment<T>(session: PhaseRuntime<T>, progress: { remaining: string[] }) {
    const {
        run,
        workUnitId,
        assigned,
        attempt,
        startedAt,
        inputRefs,
        phaseCalls,
        instructions,
        assessmentAccumulator,
    } = session;
    const { state, directory, ledger, models } = run;

    if (!assessmentAccumulator) return;
    const record = createPhaseRecord({
        runId: state.runId,
        phase: 'assess',
        workUnitId,
        attempt,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: 'incomplete',
        inputRefs,
        artifact: state.artifact,
        scopeIdentity: state.scopeIdentity,
        assessmentIds: assigned.map((entry) => entry.assessmentId),
        evidenceRefs: Object.keys(ledger.records),
        limitations: [
            'Retained proposals are not final judgments; complete group handoff and independent verification remain required.',
        ],
        stopReason: progress.remaining.length ? 'awaiting_assessment_entries' : 'awaiting_assessment_handoff',
        configuration: {
            provider: models.assess.provider,
            model: models.assess.model,
            promptHash: digest(instructions),
            kind: 'partial_assessment_progress',
            promptVersion: 'candidate-observation-v2',
        },
        usageRefs: phaseCalls.map((call) => `call:${call}`),
        output: {
            assessments: assessmentAccumulator.snapshot(),
            remaining: progress.remaining,
            ...(state.changeSummary ? { changeSummary: state.changeSummary.candidate } : {}),
        },
    });
    const operation = session.assessmentWrites.then(() =>
        atomicJson(join(directory, 'phases', `partial-assess-${workUnitId}-${attempt}.json`), sanitizeRecord(record)),
    );
    session.assessmentWrites = operation.catch(() => undefined);
    await operation;
}
async function invokeTool<T, ToolResult>(session: PhaseRuntime<T>, name: string, body: () => Promise<ToolResult>) {
    const { run, phase, workUnitId, attempt, signal } = session;
    const { diagnostics } = run;
    const started = performance.now();

    await diagnostics.event('tool_started', { phase, workUnitId, attempt, tool: name });
    try {
        signal.throwIfAborted();
        if (++session.toolsThisStep > 50)
            return {
                error: 'tool_batch_limit',
                correction:
                    'Fifty tool calls were processed in this response. Request remaining reads in the next response.',
            };
        const result = await body();
        await diagnostics.event('tool_completed', {
            phase,
            workUnitId,
            attempt,
            tool: name,
            elapsedMs: performance.now() - started,
        });
        return session.identifiers.toModel(result);
    } catch (error) {
        await diagnostics.event('tool_failed', {
            phase,
            workUnitId,
            attempt,
            tool: name,
            code:
                error instanceof SourceAccessError
                    ? error.code
                    : signal.aborted
                      ? 'cancelled'
                      : 'tool_execution_failed',
            elapsedMs: performance.now() - started,
            details: { ...providerFailureDiagnostics(error), ...systemFailureDiagnostics(error) },
        });
        if (error instanceof SourceAccessError) {
            return {
                error: error.code,
                correction:
                    name === 'search_source'
                        ? 'path must name one exact committed file, not a directory or glob. Locate it with changedFiles/list_source, or omit path for a bounded tree search. Use the exact returned cursor for continuation. No complete evidence returned.'
                        : 'Check pinned path/side/range and use exact returned continuation. No complete evidence returned.',
            };
        }
        throw error;
    }
}
function submissionCorrection(error: unknown, code: string) {
    const planCorrection =
        error instanceof PlanCitationError
            ? {
                  message:
                      'Correct every listed governing citation in one resubmission. Use an exact allowed ref only for its canonical assessment/context/version, and select a valid inclusive numbered segment range from that original governing material. Do not substitute another context, invent a ref, or alter governing scope.',
                  invalidCitations: error.corrections,
                  omittedCount: error.omittedCount,
              }
            : null;
    return (
        (error instanceof CitationError
            ? {
                  message: error.message,
                  path: error.path,
                  ref: error.ref,
                  refHash: error.refHash,
                  instruction:
                      'Correct this exact citation field. Use the ref returned with the relevant pinned guidance or source read and choose valid displayed startSegment/endSegment indices, inclusive and relative to that evidence record. Read a narrower source range if needed. Code extracts the quotation. Do not invent a reference, provide quote text, or change the assessment to evade validation.',
              }
            : planCorrection) ??
        (code === 'verification_acceptance_inconsistent'
            ? 'Accept means the assessment is supported, including an assessment proving code violations. Supported findings need decision=accept (or accept_with_suggestion for an independently checked proposed patch). If any finding is unsupported or missingChecks is nonempty, use revise/reject/unresolved for the context instead of accept; otherwise missingChecks must be empty.'
            : code === 'unproposed_suggestion_acceptance'
              ? 'Use decision=accept_with_suggestion only when this exact finding contains a non-null proposedReplacement object that you independently checked. Use decision=accept for a supported finding without an accepted patch.'
              : error instanceof z.ZodError
                ? error.issues.map((i) => ({
                      code: i.code,
                      path: i.path.map((p) => (typeof p === 'number' ? p : '[field]')),
                  }))
                : error instanceof Error
                  ? error.message
                  : 'Invalid submission')
    );
}
function remainingContexts<T>(session: PhaseRuntime<T>) {
    if (session.output !== undefined) return [];
    return (
        session.assessmentAccumulator?.remaining() ??
        session.assigned
            .filter((entry) => !session.verifications?.has(entry.assessmentId))
            .map((entry) => entry.assessmentId)
    );
}

async function rejectSubmission<T>(session: PhaseRuntime<T>, rawInput: unknown, error: unknown) {
    const { run, phase, workUnitId, attempt } = session;
    const { diagnostics } = run;

    session.stepRejected = true;
    const { code: diagnosticCode, details } = submissionDiagnostics(error);
    const code = error instanceof PlanCitationError ? error.code : diagnosticCode;
    await diagnostics.event('submission_rejected', {
        phase,
        workUnitId,
        attempt,
        code,
        details,
        remaining: remainingContexts(session),
        ...(error instanceof PlanCitationError
            ? {
                  corrections: error.corrections.map((c) => ({
                      assessmentId: c.assessmentId,
                      entryIndex: c.entryIndex,
                      checkIndex: c.checkIndex,
                      code: c.code,
                      rejectedRefHash: c.rejectedRefHash,
                      allowedRefCount: c.allowedRefs.length,
                  })),
                  omittedCount: error.omittedCount,
              }
            : {}),
        outputHash: digest(rawInput ?? null),
        count: correctionRounds(session),
    });
    return {
        accepted: false,
        code,
        remaining: remainingContexts(session),
        instruction:
            session.phase === 'verify'
                ? 'Resubmit this concern decision using submit_verification. sourceRefs select source fragments only; governing publication evidence is already pinned. Do not submit assessment groups.'
                : 'Submit only remaining context handles; accepted results are retained and cannot be overwritten.',
        correction: submissionCorrection(error, code),
        remainingCorrections: Math.max(0, 3 - correctionRounds(session)),
    };
}
function revalidateSummary(value: unknown, ledger: EvidenceLedger) {
    const summary = value as { sourceRefs: Array<{ ref: string; quote: string; start: number; end: number }> };
    return validateChangeSummary(
        {
            ...summary,
            sourceRefs: summary.sourceRefs.map(({ ref, quote, start, end }) => ({ ref, quote, start, end })),
        },
        ledger,
    );
}
async function captureChangeSummary<T>(session: PhaseRuntime<T>, value: unknown) {
    if (value === undefined || value === null) {
        // An omitted summary contributes no update; after feedback it explicitly abandons correction.
        session.summaryCorrection = null;
        if (value === undefined || session.phase === 'assess' || session.run.state.changeSummary?.status === 'verified')
            return;
    } else session.summaryCorrection = null;
    const { state, ledger, diagnostics } = session.run;
    if (session.phase === 'verify' && value === false) {
        state.changeSummary = { candidate: state.changeSummary?.candidate ?? null, accepted: null, status: 'rejected' };
        await diagnostics.event('change_summary_withdrawn', { phase: session.phase });
        return;
    }
    // Correction batches need not repeat an already checked summary.
    if (value === null && state.changeSummary?.status === 'verified') return;
    try {
        const summary = value === null ? null : validateChangeSummary(resolveCitationSelections(value, ledger), ledger);
        if (session.phase === 'assess') {
            if (summary) state.changeSummary = { candidate: summary, accepted: null, status: 'pending' };
        } else {
            const accepted = state.changeSummary?.candidate ? summary : null;
            state.changeSummary = {
                candidate: state.changeSummary?.candidate ?? null,
                accepted,
                status: accepted ? 'verified' : 'rejected',
            };
        }
    } catch (error) {
        session.summaryFailures++;
        const { code, details } = submissionDiagnostics(error);
        session.summaryCorrection = {
            code: error instanceof Error && error.message === 'change_summary_source_required' ? error.message : code,
            correction: submissionCorrection(error, code),
        };
        if (session.phase === 'verify' && state.changeSummary?.status !== 'verified')
            state.changeSummary = {
                candidate: state.changeSummary?.candidate ?? null,
                accepted: null,
                status: 'rejected',
            };
        await diagnostics.event('change_summary_rejected', {
            phase: session.phase,
            ...session.summaryCorrection,
            details,
            attempt: session.summaryFailures,
            retryable: session.summaryFailures < 2,
        });
    }
}
function summarySubmissionFeedback<T>(session: PhaseRuntime<T>) {
    const rejected = session.summaryCorrection;
    if (!rejected) return {};
    const retryable = session.summaryFailures < 2;
    if (retryable) {
        session.summaryFallbackOutput = session.output;
        session.output = undefined;
    }
    return {
        changeSummary: {
            accepted: false,
            ...rejected,
            retryable,
            instruction: retryable
                ? 'Correct only changeSummary using source evidence, not publication references. Accepted criteria are retained; submit an empty assessments/entries array if none remain. Use null to omit the narrative if it cannot be supported.'
                : 'Summary correction allowance exhausted; the invalid narrative is omitted. Continue only unfinished criteria.',
        },
    };
}
async function submitPhaseOutput<T>(session: PhaseRuntime<T>, rawInput: unknown) {
    if (!session.assessmentAccumulator) return submitSinglePhaseOutput(session, rawInput);
    let batch: { assessments: unknown[]; changeSummary?: unknown };
    try {
        batch = z
            .strictObject({ assessments: z.array(z.unknown()), changeSummary: z.unknown().optional() })
            .parse(rawInput);
    } catch (error) {
        return rejectSubmission(session, rawInput, error);
    }
    await captureChangeSummary(session, batch.changeSummary);
    const replies = [];
    for (const [entryIndex, candidate] of batch.assessments.entries()) {
        const reply = await submitSinglePhaseOutput(session, { assessments: [candidate], changeSummary: null });
        replies.push({ ...reply, entryIndex });
    }
    const corrections = replies.filter((reply) => !reply.accepted);
    if (remainingContexts(session).length === 0) session.output = session.assessmentAccumulator.snapshot() as T;
    const summaryFeedback = summarySubmissionFeedback(session);
    return {
        ...(corrections[0] ?? {}),
        accepted: corrections.length === 0,
        complete: remainingContexts(session).length === 0 && session.output !== undefined,
        ...summaryFeedback,
        newlyAccepted: replies.flatMap((reply) => ('newlyAccepted' in reply ? reply.newlyAccepted : [])),
        alreadyAccepted: replies.flatMap((reply) => ('alreadyAccepted' in reply ? reply.alreadyAccepted : [])),
        remaining: remainingContexts(session),
        corrections,
        remainingCorrections: Math.max(0, 3 - correctionRounds(session)),
    };
}

async function submitSinglePhaseOutput<T>(session: PhaseRuntime<T>, rawInput: unknown) {
    const { run, phase, workUnitId, assigned, schema, validate, attempt, signal, assessmentAccumulator } = session;
    const { diagnostics, ledger } = run;
    try {
        signal.throwIfAborted();

        const selectedInput = schema.parse(rawInput) as Record<string, unknown>;
        delete selectedInput.changeSummary;
        if (session.output !== undefined && !assessmentAccumulator) throw new Error('phase_already_submitted');
        const input = resolveCitationSelections(selectedInput, ledger);
        if (assessmentAccumulator) {
            const progress = assessmentAccumulator.submit(input);
            await persistPartialAssessment(session, progress);
            if (progress.complete) {
                const proposals = assessmentAccumulator.snapshot();
                exactIds(
                    proposals.map((p) => p.result.assessmentId),
                    assigned.map((entry) => entry.assessmentId),
                );
                session.output = proposals as T;
            }
            await diagnostics.event('assessment_progress', {
                phase,
                workUnitId,
                attempt,
                newlyAccepted: progress.newlyAccepted,
                alreadyAccepted: progress.alreadyAccepted,
                remaining: progress.remaining,
            });
            if (progress.complete)
                await diagnostics.event('submission_accepted', {
                    phase,
                    workUnitId,
                    attempt,
                    outputHash: digest(session.output),
                });
            return {
                accepted: true,
                ...progress,
                remainingCorrections: Math.max(0, 3 - correctionRounds(session)),
            };
        }
        session.output = validate(input);
        await diagnostics.event('submission_accepted', {
            phase,
            workUnitId,
            attempt,
            outputHash: digest(session.output),
        });
        return { accepted: true };
    } catch (error) {
        return rejectSubmission(session, rawInput, error);
    }
}
function sourceTools<T>(session: PhaseRuntime<T>) {
    const { run, phase, workUnitId, attempt, signal } = session;
    const { source, ledger, persist, diagnostics } = run;
    const invoke = <R>(name: string, body: () => Promise<R>) => invokeTool(session, name, body);
    return {
        changes: tool({
            strict: false,
            description:
                'Changed-file metadata only, not patch text or assessment proof. The prepared changedFiles inventory is complete when labelled complete. Each item.offset opens that file directly with diff({offset, patchLineOffset:0}); metadata paths alone do not establish applicability.',
            inputSchema: z.object({ offset: integer, detectRenames: z.boolean().optional() }),
            execute: (input) => invoke('changes', () => source.changes(input, { signal })),
        }),
        diff: tool({
            strict: false,
            description:
                'Ordinary unified diff text with fixed file identities and continuations. Start at an item.offset from changedFiles/changes to inspect a selected file. Follow next when present; source-side reads provide citation evidence.',
            inputSchema: z.object({
                offset: integer,
                patchLineOffset: integer,
                detectRenames: z.boolean().optional(),
            }),
            execute: (input) => invoke('diff', () => source.diff(input, { signal })),
        }),
        list_source: tool({
            strict: false,
            description: 'List fixed snapshot source paths. Supporting unchanged source is available.',
            inputSchema: z.object({ side: sourceSide, offset: integer }),
            execute: (input) => invoke('list_source', () => source.list(input, { signal })),
        }),
        search_source: tool({
            strict: false,
            description:
                'Literal source navigation. Optional path is one exact committed file, never a directory or glob; locate it with changedFiles/list_source, or omit path for a bounded tree search. Use exact returned cursor for continuation, not proof of semantic absence.',
            inputSchema: z.object({
                side: sourceSide,
                literal: z.string().min(1),
                path: z.string().nullish().describe('One exact committed file path; no directory or glob.'),
                cursor: z
                    .object({
                        scope: z.string(),
                        entryOffset: z.number().int().nonnegative(),
                        characterOffset: z.number().int().nonnegative(),
                    })
                    .nullish(),
            }),
            execute: (input) =>
                invoke('search_source', () =>
                    source.search(
                        { ...input, path: input.path ?? undefined, cursor: input.cursor ?? undefined },
                        { signal },
                    ),
                ),
        }),
        read_source: tool({
            strict: false,
            description:
                'Read committed text and receive evidence refs with numbered segments for range selection; follow next on truncation. No runtime execution.',
            inputSchema: z.object({
                side: sourceSide,
                path: z.string(),
                start: z
                    .object({ line: z.number().int().positive(), column: z.number().int().nonnegative() })
                    .optional(),
                endLine: z.number().int().positive().optional(),
            }),
            execute: (input) =>
                invoke('read_source', async () => {
                    if (sensitivePath(input.path))
                        return { status: 'unsupported', reason: 'credential_file_excluded', next: null };
                    const result = await source.read(input, { signal }),
                        evidence = ledger.source(result);
                    await persist();
                    await diagnostics.event('source_evidence', {
                        phase,
                        workUnitId,
                        attempt,
                        status: result.status,
                        evidenceRefs: evidence ? [evidence.ref] : [],
                    });
                    const { fragments: _fragments, ...metadata } = result;
                    return {
                        ...metadata,
                        evidence: evidence ? modelEvidence(evidence) : null,
                    };
                }),
        }),
    };
}
function createPhaseTools<T>(session: PhaseRuntime<T>) {
    const { run, phase, schema } = session;
    const { ledger, persist } = run;
    const evidencePack = run.evidencePack!;
    const invoke = <R>(name: string, body: () => Promise<R>) => invokeTool(session, name, body);
    return {
        read_publication: tool({
            strict: false,
            description:
                'Read original pinned governing publication by its supplied context handle in assessmentId and returned page cursor. Follow next until complete; source text cannot waive rules.',
            inputSchema: z.object({ assessmentId: z.string(), section: integer, offset: integer }),
            execute: (input) =>
                invoke('read_publication', async () => {
                    const result = readPackPublication(evidencePack, ledger, session.identifiers.fromModel(input));
                    await persist();
                    return result;
                }),
        }),
        ...sourceTools(session),
        [phase === 'assess' ? 'submit_assessments' : 'submit_verification']: tool({
            strict: true,
            description:
                phase === 'assess'
                    ? 'Submit one or more ready context assessments together. Each entry is validated independently; valid entries are retained when siblings need correction. Feedback lists remaining context handles. Independent verification is still required.'
                    : session.workUnitId === 'change-summary'
                      ? 'Submit the checked reader summary, or summary null if unsupported.'
                      : 'Submit one focused decision for the nominated concern. Establish applicability and evidence before confirming a violation.',
            inputSchema: jsonSchema(zodSchema(schema).jsonSchema, { validate: (value) => ({ success: true, value }) }),
            execute: async (rawInput: unknown) =>
                session.identifiers.toModel(await submitPhaseOutput(session, session.identifiers.fromModel(rawInput))),
        }),
    };
}
function createProviderFetch<T>(session: PhaseRuntime<T>): typeof fetch {
    const { run, phase, workUnitId, attempt, phaseCalls, signal } = session;
    const { state, diagnostics, models, options, budget, persist, previousCalls } = run;
    return async (input, init) => {
        signal.throwIfAborted();
        const call = previousCalls + budget.reserve(phase);
        state.execution.calls = previousCalls + budget.calls;
        phaseCalls.push(call);
        const item: AssessmentState['execution']['providerUsage'][number] = {
            call,
            provider: models[phase].provider,
            phase,
            workUnitId,
            usage: null as unknown,
            missing: true,
        };
        state.execution.providerUsage.push(item);
        const started = Date.now();
        const request = providerRequestDiagnostics(init?.body);
        const context = { phase, workUnitId, attempt, call, request };
        await diagnostics
            .event('provider_started', {
                ...context,
                provider: models[phase].provider,
                model: models[phase].model,
            })
            .catch((error: unknown) => {
                throw new ProviderAccountingError(error);
            });
        let recorded = false;
        try {
            const response = await (options.fetch ?? fetch)(input, init);
            if (!response.ok) {
                budget.record(null);
                recorded = true;
                const details = await providerResponseDiagnostics(response);
                item.httpStatus = response.status;
                item.failureCode = details.code;
                await diagnostics.event('provider_failed', {
                    phase,
                    workUnitId,
                    attempt,
                    call,
                    status: response.status,
                    code: item.failureCode,
                    request,
                    details,
                    elapsedMs: Date.now() - started,
                });
                await persist();
                return response;
            }
            const body = (await response.clone().json()) as Record<string, unknown>;
            item.usage = normalizedWireUsage(body.usage);
            item.missing = item.usage === null;
            const usage = reportedUsage(models[phase].provider, item.usage);
            budget.record(usage.totalTokens);
            recorded = true;
            state.execution.usage.push({
                call,
                phase,
                provider: models[phase].provider,
                ...Object.fromEntries(Object.entries(usage).filter(([key]) => key !== 'raw')),
            });
            state.execution.returnedIdentities.push({
                provider: cleanIdentity(body.provider),
                model: cleanIdentity(body.model),
            });
            await diagnostics.event('provider_completed', {
                phase,
                workUnitId,
                attempt,
                call,
                status: response.status,
                request,
                elapsedMs: Date.now() - started,
                usage: Object.fromEntries(Object.entries(usage).filter(([key]) => key !== 'raw')),
            });
            await persist();
            return response;
        } catch (error) {
            if (!recorded) budget.record(null);
            await diagnostics
                .event(recorded ? 'provider_accounting_failed' : 'provider_failed', {
                    ...context,
                    elapsedMs: Date.now() - started,
                    details: {
                        ...providerFailureDiagnostics(error),
                        ...providerTransportDiagnostics(error),
                        ...systemFailureDiagnostics(error),
                    },
                    code: signal.aborted
                        ? 'cancelled'
                        : recorded
                          ? 'provider_accounting_failed'
                          : 'transport_or_response_invalid',
                })
                .catch(() => undefined);
            throw recorded ? new ProviderAccountingError(error) : error;
        }
    };
}
async function runPhaseModel<T>(session: PhaseRuntime<T>) {
    const { run, phase, workUnitId, payload, attempt, signal, instructions } = session;
    const { state, diagnostics, models, limits } = run;
    const tools: import('ai').ToolSet = createPhaseTools(session),
        wire = createProviderFetch(session);
    const configured = assessmentModel(models[phase], wire);
    const model = recoverProviderCalls(configured.model, signal, (event, count, error) =>
        diagnostics.event(event, {
            phase,
            workUnitId,
            attempt,
            count,
            call: state.execution.calls,
            retryScope: 'request',
            backoffMs: event === 'provider_retry' ? 250 * 2 ** (count - 1) : 0,
            ...providerFailureDiagnostics(error),
        }),
    );
    signal.throwIfAborted();
    let continuation = 0;
    let messages: import('ai').ModelMessage[] = [
        { role: 'user', content: JSON.stringify(session.identifiers.toModel(sanitizeRecord(payload))) },
    ];
    for (; session.output === undefined;) {
        const generated = await generateText({
            ...configured,
            model,
            system: instructions,
            messages,
            tools,
            maxRetries: 0,
            abortSignal: signal,
            ...(limits.maxOutputTokens === null ? {} : { maxOutputTokens: limits.maxOutputTokens }),
            stopWhen: () =>
                session.output !== undefined ||
                session.rejected >= 3 ||
                session.sdkStop !== null ||
                session.phaseCalls.length >= (phase === 'assess' ? 60 : 12),
            prepareStep: () => {
                session.toolsThisStep = 0;
                return phase === 'assess' && session.phaseCalls.length >= 58
                    ? { activeTools: ['submit_assessments'] }
                    : {};
            },
            onStepEnd: async (step) => {
                state.execution.steps++;
                await diagnostics.event('sdk_step', {
                    phase,
                    workUnitId,
                    attempt,
                    finishReason: step.finishReason,
                });
                for (const item of step.content)
                    if (item.type === 'tool-error' && item.toolName.startsWith('submit_')) {
                        session.stepRejected = true;
                        await diagnostics.event('submission_rejected', {
                            phase,
                            workUnitId,
                            attempt,
                            ...submissionToolDiagnostics(item, step.toolCalls),
                            remaining: remainingContexts(session),
                            tool: Object.prototype.hasOwnProperty.call(tools, item.toolName)
                                ? item.toolName
                                : 'unknown_tool',
                            outputHash: digest(item.input ?? null),
                            count: correctionRounds(session),
                        });
                    }
                // Stop stalled corrections, not a larger review making validated progress.
                // Reads and repeated accepted IDs do not reset the allowance.
                session.rejected = correctionRounds(session);
                session.remainingAtLastStep = remainingContexts(session).length;
                session.stepRejected = false;
                if (step.finishReason === 'length') session.sdkStop = 'per_call_output_limit';
                if (step.warnings?.some((w) => w.type === 'unsupported'))
                    session.sdkStop = 'provider_setting_unsupported';
            },
        });
        if (
            session.output !== undefined ||
            session.rejected >= 3 ||
            session.sdkStop !== null ||
            session.phaseCalls.length >= (phase === 'assess' ? 60 : 12) ||
            continuation >= 2
        )
            break;
        continuation++;
        messages = [
            ...messages,
            ...generated.response.messages,
            {
                role: 'user',
                content: JSON.stringify({
                    instruction:
                        'Continue the same investigation. Submit only unfinished context handles; accepted judgments are immutable. Do not repeat completed work.',
                    remaining: session.identifiers.toModel({ remaining: remainingContexts(session) }).remaining,
                }),
            },
        ];
        await diagnostics.event(phase === 'assess' ? 'assessment_continuation' : 'verification_continuation', {
            phase,
            workUnitId,
            attempt,
            count: continuation,
            remaining: remainingContexts(session),
        });
    }
    signal.throwIfAborted();
    if (session.sdkStop !== null) throw new BudgetStop(session.sdkStop);
    if (session.output === undefined)
        throw new BudgetStop(
            session.phaseCalls.length >= (phase === 'assess' ? 60 : 12)
                ? 'model_call_limit'
                : session.rejected >= 3
                  ? 'phase_corrections_exhausted'
                  : 'model_stopped',
        );
}
function knownExecutionFailure(error: unknown) {
    const codes = [
        'provider_credential_missing',
        'provider_selection_invalid',
        'provider_model_missing',
        'provider_setting_unsupported',
        'upstream_artifact_changed',
        'upstream_phase_changed',
        'pinned_material_changed',
    ];
    return error instanceof Error && codes.includes(error.message) ? error.message : 'provider_or_execution_failed';
}
function phaseStopReason<T>(session: PhaseRuntime<T>, failure: unknown) {
    if (!failure) return null;
    if (failure instanceof BudgetStop) return failure.code;
    if (session.signal.aborted) {
        if (session.run.options.signal?.aborted) return 'cancelled';
        return session.phase === 'verify' ? 'max_time_ms' : 'max_time_ms';
    }
    return knownExecutionFailure(failure);
}
async function persistPhaseResult<T>(session: PhaseRuntime<T>, failure: unknown): Promise<T> {
    const { run, phase, workUnitId, assigned, attempt, startedAt, inputRefs, phaseCalls, signal, instructions } =
        session;
    const { state, directory, ledger, diagnostics, models, persist } = run;
    const partial =
        failure && phase === 'assess' && session.assessmentAccumulator?.snapshot().length
            ? {
                  assessments: session.assessmentAccumulator.snapshot(),
                  remaining: session.assessmentAccumulator.remaining(),
              }
            : failure && session.verifications?.size
              ? {
                    verifications: [...session.verifications.values()].map((entry) => entry.result),
                    remaining: remainingContexts(session),
                }
              : null;
    if (failure && phase === 'verify' && state.changeSummary) {
        state.changeSummary.accepted = null;
        state.changeSummary.status = 'pending';
    }
    const record = createPhaseRecord({
        runId: state.runId,
        phase,
        workUnitId,
        attempt,
        startedAt,
        finishedAt: new Date().toISOString(),
        status: failure ? (signal.aborted ? 'cancelled' : 'failed') : 'complete',
        inputRefs,
        artifact: state.artifact,
        scopeIdentity: state.scopeIdentity,
        assessmentIds: assigned.map((e) => e.assessmentId),
        evidenceRefs: Object.keys(ledger.records),
        limitations: [],
        stopReason: phaseStopReason(session, failure),
        configuration: {
            provider: models[phase].provider,
            model: models[phase].model,
            effort: models[phase].effort ?? null,
            ...(partial
                ? { kind: phase === 'assess' ? 'partial_assessment_progress' : 'partial_verification_progress' }
                : {}),
            modelIdentifiers: session.identifiers.snapshot(),
            promptVersion: 'candidate-observation-v2',
            maxPhaseCalls: phase === 'assess' ? 60 : 12,
            maxSourceToolsPerResponse: 50,
            validationConcurrency: 2,
            promptHash: digest(instructions),
            sdkVersion: runtimeVersion('ai'),
            adapter: '@ai-sdk/openai',
            adapterVersion: runtimeVersion('@ai-sdk/openai'),
        },
        usageRefs: phaseCalls.map((c) => `call:${c}`),
        output: run.state.changeSummary
            ? {
                  ...(partial ?? { [phase === 'assess' ? 'assessments' : 'entries']: session.output ?? [] }),
                  changeSummary:
                      phase === 'assess' ? run.state.changeSummary.candidate : run.state.changeSummary.accepted,
              }
            : (partial ?? session.output ?? null),
    });
    const filename = phaseFilename(phase, workUnitId, attempt);
    await atomicJson(join(directory, 'phases', filename), sanitizeRecord(record));
    state.phases.push(record);
    await persist();
    if (failure) throw failure;
    const persisted = JSON.parse(await readFile(join(directory, 'phases', filename), 'utf8'));
    validatePhaseRecord(persisted, {
        runId: state.runId,
        artifact: state.artifact,
        scopeIdentity: state.scopeIdentity,
        assessmentIds: assigned.map((e) => e.assessmentId),
        inputRefs,
        phase,
        workUnitId,
        attempt,
    });
    await diagnostics.event('phase_completed', {
        phase,
        workUnitId,
        attempt,
        outputHash: record.outputHash,
        elapsedMs: Date.now() - Date.parse(startedAt),
    });
    // Reconciliation works on a copy; persisted handoffs remain immutable.
    return structuredClone(session.output!);
}
async function recoverSummaryOnlyFailure<T>(session: PhaseRuntime<T>, error: unknown) {
    if (
        session.summaryFallbackOutput === undefined ||
        remainingContexts(session).length ||
        session.run.options.signal?.aborted ||
        error instanceof ProviderAccountingError ||
        knownExecutionFailure(error) !== 'provider_or_execution_failed'
    )
        return false;
    session.output = session.summaryFallbackOutput;
    const summary = session.run.state.changeSummary;
    if (summary && summary.status !== 'verified') {
        summary.accepted = null;
        summary.status = 'rejected';
    }
    await session.run.diagnostics.event('change_summary_correction_failed', {
        phase: session.phase,
        code: phaseStopReason(session, error),
        criteriaPreserved: true,
        ...providerFailureDiagnostics(error),
    });
    return true;
}
async function invokePhase<T>(
    run: AssessmentRuntime,
    phase: 'assess' | 'verify',
    workUnitId: string,
    assigned: AssessmentEntry[],
    payload: unknown,
    schema: z.ZodType,
    validate: (value: unknown) => T,
    attempt = 1,
): Promise<T> {
    const session = await createPhaseRuntime(run, phase, workUnitId, assigned, payload, schema, validate, attempt);
    await run.diagnostics.event('phase_started', { phase, workUnitId, attempt, inputHash: session.inputRefs[0]!.hash });
    let failure: unknown;
    try {
        await runPhaseModel(session);
    } catch (error) {
        if (!(await recoverSummaryOnlyFailure(session, error))) {
            failure = session.signal.aborted ? new BudgetStop(phaseStopReason(session, error)!) : error;
            await run.diagnostics.event('phase_failed', {
                elapsedMs: Date.now() - Date.parse(session.startedAt),
                phase,
                workUnitId,
                attempt,
                code:
                    error instanceof BudgetStop
                        ? error.code
                        : session.signal.aborted
                          ? 'phase_deadline_or_cancelled'
                          : 'provider_or_execution_failed',
                details: { ...providerFailureDiagnostics(error), ...systemFailureDiagnostics(error) },
            });
        }
    } finally {
        if (session.timer !== null) clearTimeout(session.timer);
    }
    try {
        return await persistPhaseResult(session, failure);
    } catch (error) {
        // persistPhaseResult rethrows the model failure after saving its handoff.
        // Only a different failure here means the handoff itself could not be persisted or validated.
        if (error !== failure) {
            await run.diagnostics
                .event(failure ? 'phase_persistence_failed' : 'phase_failed', {
                    phase,
                    workUnitId,
                    attempt,
                    code: 'phase_artifact_failed',
                    elapsedMs: Date.now() - Date.parse(session.startedAt),
                    details: { ...providerFailureDiagnostics(error), ...systemFailureDiagnostics(error) },
                })
                .catch(() => undefined);
        }
        throw failure ?? error;
    }
}
const latestAssessment = (run: AssessmentRuntime) =>
    run.state.phases.filter((phase) => phase.phase === 'assess' && phase.workUnitId === 'all').at(-1);
const nextAttempt = (run: AssessmentRuntime, phase: ModelPhase) =>
    Math.max(
        0,
        ...run.state.phases
            .filter((record) => record.phase === phase && record.workUnitId === 'all')
            .map((record) => record.attempt),
    ) + 1;
function artifactPrContext(context: PrContext | null) {
    if (!context || context.version === 1) return context;
    const { observedChecks: _observedChecks, ...artifactContext } = context;
    return artifactContext;
}
function baseAssessmentPayload(run: AssessmentRuntime) {
    return {
        reviewer: run.state.reviewer,
        artifact: run.state.artifact,
        purpose: run.options.purpose ?? null,
        prContext: artifactPrContext(run.prContext),
        governingEvidence: modelPackEvidence(run.evidencePack!, run.ledger),
        diff: run.modelDiff,
        repositoryInstructions: run.repositoryInstructions,
        changedFiles: run.prepared.state.changes,
        sourceLimits: run.source.limits,
    };
}
async function prepareRunEvidence(run: AssessmentRuntime) {
    const { state, directory, prepared, prContext, material, ledger } = run;
    run.modelDiff = await modelDiffEvidence(directory, run.preparedManifest.files?.['diff.patch'], prepared.state.diff);
    await atomicJson(join(directory, 'prepared.json'), sanitizeRecord(prepared.state));
    if (prContext) await atomicJson(join(directory, 'pr-context.json'), sanitizeRecord(prContext));
    for (const entry of state.entries) {
        if (!entry.material) continue;
        const pinned = publicationSchema.parse(material[entry.assessmentId]);
        if (
            pinned.nodeId !== entry.nodeId ||
            pinned.version !== entry.version ||
            pinned.subtype !== entry.subtype ||
            digest(pinned.content) !== entry.contentHash
        )
            throw new Error('pinned_material_changed');
    }
    for (const publication of Object.values(material)) ledger.publication(publication);
    run.evidencePack = prepareEvidencePack({ state: prepared.state, publications: material, ledger });
    await writeEvidencePack(directory, run.evidencePack);
    const remaining = run.budget.remainingMs('assess');
    if (remaining !== null && remaining <= 0) throw new BudgetStop('max_time_ms');
    const deadline = remaining === null ? undefined : AbortSignal.timeout(Math.ceil(remaining));
    const signals = [run.options.signal, deadline].filter((value): value is AbortSignal => value !== undefined);
    try {
        run.repositoryInstructions = await repositoryInstructionsEvidence(
            run.source,
            ledger,
            signals.length ? AbortSignal.any(signals) : undefined,
        );
    } catch (error) {
        if (deadline?.aborted) throw new BudgetStop('max_time_ms');
        throw error;
    }

    await run.persist();
}
async function restorePartialProposals(run: AssessmentRuntime) {
    if (!run.options.resume) return;
    const last = latestAssessment(run);
    if (!last) return;
    const partial = JSON.parse(
        await readFile(join(run.directory, 'phases', `partial-assess-all-${last.attempt}.json`), 'utf8').catch(
            () => 'null',
        ),
    );
    if (!partial) return;
    const { state, ledger } = run;
    validatePhaseRecord(partial, {
        runId: state.runId,
        artifact: state.artifact,
        scopeIdentity: state.scopeIdentity,
        assessmentIds: state.entries.map((entry) => entry.assessmentId),
        inputRefs: last.inputRefs,
        phase: 'assess',
        workUnitId: 'all',
        attempt: last.attempt,
        requireComplete: false,
    });
    if (partial.output.changeSummary)
        state.changeSummary = {
            candidate: revalidateSummary(partial.output.changeSummary, ledger),
            accepted: null,
            status: 'pending',
        };
    run.retainedProposals = (partial.output as { assessments: AssessmentProposal[] }).assessments.map((proposal) =>
        revalidateCandidate(proposal, state.entries, ledger),
    );
}
async function assessRun(run: AssessmentRuntime) {
    const previous = latestAssessment(run),
        { state, ledger } = run;
    if (previous?.status === 'complete') {
        const proposals = phaseItems<AssessmentProposal>(previous.output, 'assessments');
        const summary = (previous.output as { changeSummary?: unknown }).changeSummary;
        if (summary)
            state.changeSummary = { candidate: revalidateSummary(summary, ledger), accepted: null, status: 'pending' };
        exactIds(
            proposals.map((p) => p.result.assessmentId),
            state.entries.map((entry) => entry.assessmentId),
        );
        return proposals.map((proposal) => revalidateCandidate(proposal, state.entries, ledger));
    }
    await restorePartialProposals(run);
    return invokePhase<AssessmentProposal[]>(
        run,
        'assess',
        'all',
        state.entries,
        {
            ...baseAssessmentPayload(run),
            expectedChecklist: state.entries.map(({ result: _result, ...entry }) => entry),
            evidencePack: run.evidencePack!.index,
            retained: run.retainedProposals,
            remaining: state.entries
                .filter((entry) => !run.retainedProposals.some((p) => p.result.assessmentId === entry.assessmentId))
                .map((entry) => entry.assessmentId),
        },
        candidateSelectionSchema,
        () => {
            throw new Error('assessment_accumulator_required');
        },
        nextAttempt(run, 'assess'),
    );
}
async function verifyRun(run: AssessmentRuntime, assessments: AssessmentProposal[]) {
    const { state, ledger } = run;
    const observations = assessments.flatMap((p) => p.observations ?? []);
    if (assessments.some((p) => !p.observations)) throw Error('candidate_checkpoint_required');
    state.observations = observations;
    const concerns = observations.filter((o) => o.concern !== null);
    const decisions: ConcernDecision[] = [];
    state.concernDecisions = decisions;
    const validation = {
        expected: concerns.length,
        validated: 0,
        complete: false,
        scope: 'nominated_concerns' as const,
    };
    state.concernValidation = validation;
    const validateOne = async (observation: CandidateObservation) => {
        const entry = state.entries.find((e) => e.assessmentId === observation.assessmentId)!;
        const prior = state.phases
            .filter((p) => p.phase === 'verify' && p.workUnitId === observation.id && p.status === 'complete')
            .at(-1);
        let decision: ConcernDecision;
        if (prior) {
            const saved = ((prior.output as { entries?: unknown })?.entries ?? prior.output) as ConcernDecision;
            decision = validateConcern(
                {
                    decision: saved.decision,
                    reason: saved.reason,
                    duty: saved.duty,
                    suggestionAccepted: saved.suggestionAccepted,
                    applicability: saved.applicability,
                    consequence: saved.consequence,
                    correction: saved.correction,
                    sourceRefs: saved.sourceRefs.map(({ ref, quote, start, end }) => ({ ref, quote, start, end })),
                },
                observation,
                ledger,
            );
        } else {
            decision = await invokePhase(
                run,
                'verify',
                observation.id,
                [entry],
                {
                    reviewer: state.reviewer,
                    purpose: run.options.purpose ?? null,
                    prContext: artifactPrContext(run.prContext),
                    publication: run.material[entry.assessmentId],
                    observation,
                    governingEvidence: {
                        evidence: [modelEvidence(ledger.records[observation.passage.ref]!)],
                        selectedPassage: {
                            ref: observation.passage.ref,
                            startOffset: observation.passage.start,
                            endOffset: observation.passage.end,
                        },
                    },
                    sourceEvidence: modelSourceEvidence(
                        ledger,
                        observation.sourceRefs.map((c) => c.ref),
                    ),
                },
                concernDecisionSchema,
                (value) => validateConcern(value, observation, ledger),
                1 +
                    Math.max(
                        0,
                        ...state.phases
                            .filter((p) => p.phase === 'verify' && p.workUnitId === observation.id)
                            .map((p) => p.attempt),
                    ),
            );
        }
        decisions.push(decision);
        validation.validated++;
        projectCandidates(state, assessments, decisions);
        await run.persist();
    };
    let cursor = 0;
    const failures: unknown[] = [];
    await Promise.all(
        Array.from({ length: Math.min(2, concerns.length) }, async () => {
            while (cursor < concerns.length) {
                const observation = concerns[cursor++]!;
                try {
                    await validateOne(observation);
                } catch (error) {
                    failures.push(error);
                }
            }
        }),
    );
    projectCandidates(state, assessments, decisions);
    validation.complete = validation.validated === validation.expected;
    state.verification = {
        expected: concerns.length,
        verified: validation.validated,
        complete: validation.complete,
    };
    if (failures.length) throw failures[0];
    await verifyCandidateSummary(run);
    state.execution.scope =
        'Standards observations with independent validation of nominated concerns only. No concern identified does not establish whole-standard compliance. Operational outcomes and missing premises remain separate.';
}
async function verifyCandidateSummary(run: AssessmentRuntime) {
    const candidate = run.state.changeSummary?.candidate;
    if (!candidate) return;
    try {
        const prior = run.state.phases
            .filter((p) => p.phase === 'verify' && p.workUnitId === 'change-summary' && p.status === 'complete')
            .at(-1);
        const value = prior
            ? (((prior.output as { entries?: unknown })?.entries ?? prior.output) as { summary: unknown })
            : await invokePhase(
                  run,
                  'verify',
                  'change-summary',
                  run.state.entries,
                  {
                      artifact: run.state.artifact,
                      summary: candidate,
                      diff: run.modelDiff,
                      sourceEvidence: modelSourceEvidence(
                          run.ledger,
                          candidate.sourceRefs.map((c) => c.ref),
                      ),
                  },
                  z.strictObject({ summary: changeSummarySelectionSchema.nullable() }),
                  (input) => {
                      const value = input as { summary: unknown };
                      return {
                          summary: value.summary === null ? null : validateChangeSummary(value.summary, run.ledger),
                      };
                  },
                  1 +
                      Math.max(
                          0,
                          ...run.state.phases.filter((p) => p.workUnitId === 'change-summary').map((p) => p.attempt),
                      ),
              );
        run.state.changeSummary = {
            candidate,
            accepted: value.summary === null ? null : revalidateSummary(value.summary, run.ledger),
            status: value.summary === null ? 'rejected' : 'verified',
        };
    } catch (error) {
        const optionalContentStop =
            error instanceof BudgetStop &&
            ['model_call_limit', 'phase_corrections_exhausted', 'model_stopped'].includes(error.code);
        if (run.options.signal?.aborted || !optionalContentStop) throw error;
        run.state.changeSummary = { candidate, accepted: null, status: 'pending' };
        run.state.limitations.push(
            'Reader change summary verification did not complete; standards concern outcomes are retained.',
        );
    }
}
async function executeAssessment(run: AssessmentRuntime) {
    await prepareRunEvidence(run);
    const { state, models, options, prepared, preparedManifest, diagnostics } = run;
    if (state.preparationStatus !== 'prepared') {
        state.execution.stopReason = 'preparation_incomplete';
        return true;
    }
    for (const phase of ['assess', 'verify'] as const) assessmentModel(models[phase], options.fetch ?? fetch);
    if (
        prepared.state.changes?.status !== 'complete' ||
        preparedManifest.changesHash !== digest(prepared.state.changes)
    ) {
        await diagnostics.event('preparation_inventory_rejected', { code: 'upstream_artifact_changed' });
        throw new Error('upstream_artifact_changed');
    }
    await verifyRun(run, await assessRun(run));
    const newPhases = state.phases.slice(run.invocationPhaseIndex).filter((p) => p.workUnitId !== 'change-summary');
    state.execution.stopReason = newPhases.find((phase) => phase.status !== 'complete')?.stopReason ?? 'finished';
    return newPhases.some((phase) => phase.status !== 'complete');
}
export async function runAssessment(options: AssessmentOptions) {
    const run = await createAssessmentRuntime(options);
    let executionFailure = false;
    try {
        executionFailure = await executeAssessment(run);
    } catch (error) {
        executionFailure = true;
        run.state.execution.stopReason =
            error instanceof BudgetStop
                ? error.code
                : options.signal?.aborted
                  ? 'cancelled'
                  : knownExecutionFailure(error);
        await run.diagnostics
            .event('execution_stopped', {
                code: run.state.execution.stopReason,
                details: { ...providerFailureDiagnostics(error), ...systemFailureDiagnostics(error) },
            })
            .catch(() => undefined);
    }
    return finalizeAssessment(run, executionFailure);
}
async function deliverAssessmentFeedback(state: AssessmentState, options: AssessmentOptions): Promise<ReportingStatus> {
    let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            sendAssessmentReport(state, {
                mode: options.feedback,
                sender: options.feedbackSender,
                repositoryAttribution: options.repositoryAttribution,
            }),
            new Promise<ReportingStatus>((resolve) => {
                cleanupTimer = setTimeout(() => resolve({ status: 'failed', code: 'submission_failed' }), 10_000);
            }),
        ]);
    } finally {
        if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    }
}
async function sealReportArtifacts(directory: string, state: AssessmentState) {
    const hashes: Record<string, string> = {};
    for (const name of await readdir(directory)) {
        if (name === 'manifest.json' || name.endsWith('.tmp')) continue;
        if (name === 'phases') {
            for (const child of await readdir(join(directory, name)))
                hashes[`${name}/${child}`] = `sha256:${createHash('sha256')
                    .update(await readFile(join(directory, name, child)))
                    .digest('hex')}`;
        } else
            hashes[name] = `sha256:${createHash('sha256')
                .update(await readFile(join(directory, name)))
                .digest('hex')}`;
    }
    let original: Record<string, unknown> = {};
    try {
        original = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    } catch {
        original = {};
    }
    await atomicJson(join(directory, 'manifest.json'), {
        ...original,
        runId: state.runId,
        files: hashes,
        capture: state.execution.capture,
    });
}
async function finalizeAssessment(run: AssessmentRuntime, executionFailure: boolean) {
    const { state, directory, budget, diagnostics, persist, options, prepared, previousElapsed } = run;
    state.execution.elapsedMs = previousElapsed + Date.now() - budget.started;
    state.decision = decideExit(
        state.entries,
        state.execution.policy,
        !state.verification.complete || state.preparationStatus !== 'prepared',
        executionFailure,
        state.findings,
    );
    state.assessmentStatus = state.decision.complete && !executionFailure ? 'complete' : 'incomplete';
    const reportPath = join(directory, 'report.json');
    const started = performance.now();
    const primaryStopReason = state.execution.stopReason;
    let stage = 'diagnostics';
    try {
        await diagnostics.event('assessment_finalization_started', {
            status: state.assessmentStatus,
            exitCode: state.decision.exitCode,
            elapsedMs: state.execution.elapsedMs,
            complete: state.verification.complete,
        });
        stage = 'state_write';
        await persist();
        stage = 'json_report';
        await atomicJson(reportPath, sanitizeRecord(state));
        stage = 'markdown_report';
        await writeFile(join(directory, 'report.md'), markdownReport(state), { mode: 0o600 });
        stage = 'feedback';
        state.execution.reporting = await deliverAssessmentFeedback(state, options);
        await diagnostics.event('assessment_reporting', { reporting: state.execution.reporting.status });
        stage = 'reporting_status';
        await atomicJson(join(directory, 'reporting-status.json'), {
            runId: state.runId,
            reporting: state.execution.reporting,
        });
        stage = 'state_write';
        await persist();
        stage = 'json_report';
        await atomicJson(reportPath, sanitizeRecord(state));
        stage = 'markdown_report';
        await writeFile(join(directory, 'report.md'), markdownReport(state), { mode: 0o600 });
        stage = 'diagnostics';
        await diagnostics.event('assessment_finalized', {
            status: state.assessmentStatus,
            exitCode: state.decision.exitCode,
            elapsedMs: state.execution.elapsedMs,
            complete: state.verification.complete,
        });
        await diagnostics.flush();
        stage = 'artifact_seal';
        await sealReportArtifacts(directory, state);
    } catch (error) {
        state.decision = { ...state.decision, exitCode: 2 };
        state.assessmentStatus = 'incomplete';
        state.execution.stopReason = executionFailure ? primaryStopReason : 'report_delivery_failed';
        await diagnostics
            .event('finalization_failed', {
                code: 'report_delivery_failed',
                primaryStopReason,
                stage,
                elapsedMs: performance.now() - started,
                details: { ...providerFailureDiagnostics(error), ...systemFailureDiagnostics(error) },
            })
            .catch(() => undefined);
        if (state.execution.reporting.status === 'pending')
            state.execution.reporting =
                options.feedback === 'off' ? { status: 'off' } : { status: 'failed', code: 'finalization_unavailable' };
        await atomicJson(prepared.statePath, sanitizeRecord(state)).catch(() => undefined);
        await atomicJson(reportPath, sanitizeRecord(state)).catch(() => undefined);
    }
    return { state: sanitizeRecord(state), statePath: prepared.statePath, reportPath, directory };
}
function markdownReport(state: AssessmentState) {
    const coverage = assessmentCoverage(state);
    const progressLabel = (assessmentId: string) => {
        const progress = coverage.entries.find((p) => p.assessmentId === assessmentId);
        return assessmentProgressLabel(
            progress?.status ?? 'unexamined',
            state.concernValidation?.scope === 'nominated_concerns',
        );
    };
    return (
        `# Standards assessment ${state.runId}\n\nAssessment: **${state.assessmentStatus}**; review exit ${state.decision?.reviewExit}; process exit ${state.decision?.exitCode}.\n\n${state.artifact.base.commit} → ${state.artifact.head.commit}\n\n[Open prepared Git diff](diff.patch) · [Preparation summary](preparation.md)\n\nAssessed ${coverage.assessed}/${coverage.total} governed context assessments; ${coverage.awaitingVerification} awaiting independent verification; ${coverage.needsReassessment} need reassessment; ${coverage.savedProposals} saved proposals with an incomplete assessment handoff; ${coverage.unexamined} unexamined. ${state.concernValidation?.scope === 'nominated_concerns' ? 'Nominated concerns checked' : 'Verified'} ${state.verification.verified}/${state.verification.expected}. Assessment proposals are not accepted findings until independently verified. No runtime tests were executed.\n\n` +
        'The JSON diff field is the initial paged diff view: truncated means that view has more content or a bounded patch, not that diff.patch is incomplete. See preparation.md for full permitted capture availability and exclusions. Additional pinned source can be read through tools; capture and availability do not establish what the assessor examined.\n\n' +
        renderReaderGuidance(state) +
        '\n\n' +
        state.entries
            .map((e) => {
                const r = e.result;
                const unscored =
                    state.concernValidation?.scope === 'nominated_concerns' && r.disposition !== 'not_evaluated'
                        ? 'not scored under this method'
                        : 'unknown';
                return (
                    `## ${e.nodeId} @${e.version}\n\n${progressLabel(e.assessmentId)}\n\nFinal canonical outcome: ${r.disposition}; adherence ${r.adherence ?? unscored}; confidence ${r.confidence ?? unscored}\n\n` +
                    ('explanation' in r
                        ? `${r.explanation}\n\nCorrection: ${r.correction}\n\nLimits: ${r.limitations.join('; ')}\n\n${r.citations.map((c) => `${c.ref}: ${JSON.stringify(c.quote)}`).join('\n\n')}`
                        : progressLabel(e.assessmentId))
                );
            })
            .join('\n\n') +
        `\n\n## Run details\n\nPhase models: ${JSON.stringify(state.execution.phaseModels)}\n\nDuration ${state.execution.elapsedMs}ms; ${state.execution.calls} calls; stop ${state.execution.stopReason}.\n\n${state.execution.capture}\n`
    );
}
