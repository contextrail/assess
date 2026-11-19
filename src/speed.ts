export type ProviderSpeed = 'normal' | 'fast' | 'ultrafast';
export const PROVIDER_SPEEDS: readonly ProviderSpeed[] = ['normal', 'fast', 'ultrafast'];

/** OpenAI and OpenRouter both read `service_tier`; "priority" is the tier OpenAI calls Fast. */
const tiers = { fast: 'priority', ultrafast: 'ultrafast' } as const;
const served = { fast: ['priority', 'fast'], ultrafast: ['ultrafast'] } as const;

export type SpeedUnavailable = { model: string; expected: string; actual: string | null };

/**
 * Requests a faster service tier on each provider call. The tier is best effort:
 * a rejected tier is dropped for that model and the same request is resent once,
 * and a request served on another tier is reported, never failed.
 */
export function speedFetch(
    fetcher: typeof fetch,
    speed: ProviderSpeed,
    unavailable: (event: SpeedUnavailable) => unknown,
): typeof fetch {
    if (speed === 'normal') return fetcher;
    const expected = tiers[speed];
    const dropped = new Set<string>(),
        reported = new Set<string>();
    const report = (model: string, actual: string | null) => {
        if (reported.has(model)) return;
        reported.add(model);
        unavailable({ model, expected, actual });
    };
    return async (input, init) => {
        const body = requestBody(init?.body);
        if (!body || dropped.has(body.model)) return fetcher(input, init);
        const response = await fetcher(input, {
            ...init,
            body: JSON.stringify({ ...body.value, service_tier: expected }),
        });
        if (await tierRejected(response)) {
            dropped.add(body.model);
            report(body.model, null);
            await response.body?.cancel().catch(() => undefined);
            return fetcher(input, init);
        }
        const actual = response.ok ? await servedTier(response) : null;
        if (actual !== null && !(served[speed] as readonly string[]).includes(actual)) report(body.model, actual);
        return response;
    };
}

function requestBody(body: unknown): { model: string; value: Record<string, unknown> } | null {
    if (typeof body !== 'string') return null;
    try {
        const value: unknown = JSON.parse(body);
        if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
        const model = (value as Record<string, unknown>).model;
        return { model: typeof model === 'string' ? model : '', value: value as Record<string, unknown> };
    } catch {
        return null;
    }
}

async function tierRejected(response: Response) {
    if (response.status < 400 || response.status >= 500 || [401, 408, 429].includes(response.status)) return false;
    const text = await response
        .clone()
        .text()
        .catch(() => '');
    return /service[_ ]tier|ultrafast|priority/i.test(text);
}

async function servedTier(response: Response) {
    try {
        const tier = ((await response.clone().json()) as Record<string, unknown>).service_tier;
        return typeof tier === 'string' ? tier : null;
    } catch {
        return null;
    }
}
