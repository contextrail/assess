export type ModelPhase = 'assess' | 'verify';
export type ExecutionLimits = {
    maxTurns: number | null;
    maxOutputTokens: number | null;
    maxTotalTokens: number | null;
    maxTimeMs: number | null;
    /** Model calls per verification work unit; null keeps the package default. */
    maxVerifyCalls: number | null;
};
export const DEFAULT_VERIFY_CALLS = 12;
export const DEFAULT_EXECUTION_LIMITS: ExecutionLimits = {
    maxTurns: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxTimeMs: null,
    maxVerifyCalls: null,
};
export class BudgetStop extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}
/** Synchronous reservations precede transport, including simultaneous workers and failed calls. */
export class AssessmentBudget {
    readonly started = Date.now();
    calls = 0;
    totalTokens = 0;
    usageComplete = true;
    constructor(readonly limits: ExecutionLimits) {
        for (const value of Object.values(limits))
            if (value !== null && (!Number.isSafeInteger(value) || value < 1))
                throw new Error('invalid_execution_limit');
        if (limits.maxTimeMs !== null && limits.maxTimeMs > 2147483647)
            throw new Error('invalid_time_limit_node_timer');
    }
    remainingMs(_phase: ModelPhase) {
        return this.limits.maxTimeMs === null ? null : Math.max(0, this.started + this.limits.maxTimeMs - Date.now());
    }
    reserve(phase: ModelPhase) {
        const remaining = this.remainingMs(phase);
        if (remaining !== null && remaining <= 0) throw new BudgetStop('max_time_ms');
        if (this.limits.maxTotalTokens !== null) {
            if (!this.usageComplete) throw new BudgetStop('total_token_limit_unmeasurable');
            if (this.totalTokens >= this.limits.maxTotalTokens) throw new BudgetStop('max_total_tokens');
        }
        if (this.limits.maxTurns !== null && this.calls >= this.limits.maxTurns) throw new BudgetStop('max_turns');
        return ++this.calls;
    }
    record(totalTokens: number | null) {
        if (totalTokens === null) this.usageComplete = false;
        else this.totalTokens += totalTokens;
    }
}
