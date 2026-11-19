import { describe, expect, it, vi } from 'vitest';
import { speedFetch, type SpeedUnavailable } from '../src/speed.js';

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const request = (model = 'openai/gpt-6-luna') => ({ method: 'POST', body: JSON.stringify({ model, messages: [] }) });
const sentTier = (call: unknown[]) =>
    (JSON.parse((call[1] as RequestInit).body as string) as { service_tier?: string }).service_tier;

function harness(responses: Array<() => Response>) {
    const fetcher = vi.fn(async (..._args: Parameters<typeof fetch>) => responses.shift()!());
    const reports: SpeedUnavailable[] = [];
    return { fetcher, reports, report: (event: SpeedUnavailable) => reports.push(event) };
}

describe('speedFetch', () => {
    it('leaves requests untouched at normal speed', async () => {
        const { fetcher, report } = harness([]);
        expect(speedFetch(fetcher as typeof fetch, 'normal', report)).toBe(fetcher);
    });

    it.each([
        ['fast', 'priority'],
        ['ultrafast', 'ultrafast'],
    ] as const)('requests the %s tier and stays quiet when the provider serves it', async (speed, tier) => {
        const { fetcher, reports, report } = harness([() => json(200, { service_tier: tier })]);
        const response = await speedFetch(fetcher as typeof fetch, speed, report)('https://x/chat', request());
        expect(response.status).toBe(200);
        expect(sentTier(fetcher.mock.calls[0]!)).toBe(tier);
        expect(reports).toEqual([]);
    });

    it('accepts a provider reporting the fast alias for priority', async () => {
        const { fetcher, reports, report } = harness([() => json(200, { service_tier: 'fast' })]);
        await speedFetch(fetcher as typeof fetch, 'fast', report)('https://x/chat', request());
        expect(reports).toEqual([]);
    });

    it('resends a rejected tier without it, reports once and stops asking for that model', async () => {
        const { fetcher, reports, report } = harness([
            () => json(400, { error: { message: "Unsupported value: 'service_tier' does not support 'ultrafast'" } }),
            () => json(200, { service_tier: 'default' }),
            () => json(200, { service_tier: 'default' }),
        ]);
        const wrapped = speedFetch(fetcher as typeof fetch, 'ultrafast', report);
        expect((await wrapped('https://x/chat', request())).status).toBe(200);
        expect((await wrapped('https://x/chat', request())).status).toBe(200);
        expect(fetcher.mock.calls.map(sentTier)).toEqual(['ultrafast', undefined, undefined]);
        expect(reports).toEqual([{ model: 'openai/gpt-6-luna', expected: 'ultrafast', actual: null }]);
    });

    it('reports a request served on another tier once per model and keeps the response', async () => {
        const { fetcher, reports, report } = harness([
            () => json(200, { service_tier: 'default', id: 'a' }),
            () => json(200, { service_tier: 'default', id: 'b' }),
        ]);
        const wrapped = speedFetch(fetcher as typeof fetch, 'fast', report);
        const first = await wrapped('https://x/chat', request());
        await wrapped('https://x/chat', request());
        expect(await first.json()).toMatchObject({ id: 'a' });
        expect(fetcher.mock.calls.map(sentTier)).toEqual(['priority', 'priority']);
        expect(reports).toEqual([{ model: 'openai/gpt-6-luna', expected: 'priority', actual: 'default' }]);
    });

    it('passes unrelated provider failures through without retrying', async () => {
        const { fetcher, reports, report } = harness([
            () => json(429, { error: { message: 'rate limited on priority' } }),
            () => json(400, { error: { message: 'invalid tool schema' } }),
        ]);
        const wrapped = speedFetch(fetcher as typeof fetch, 'fast', report);
        expect((await wrapped('https://x/chat', request())).status).toBe(429);
        expect((await wrapped('https://x/chat', request())).status).toBe(400);
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(reports).toEqual([]);
    });

    it('does not report when the provider omits the served tier', async () => {
        const { fetcher, reports, report } = harness([() => json(200, { choices: [] })]);
        await speedFetch(fetcher as typeof fetch, 'fast', report)('https://x/chat', request());
        expect(reports).toEqual([]);
    });
});
