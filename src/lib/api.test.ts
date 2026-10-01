import { describe, it, expect, afterEach, vi } from 'vitest';
import { clientAttributionHeaders, waitForPrediction } from './api.js';

const ORIGINAL_ENV = process.env.WAVESPEED_CLIENT_NAME;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.WAVESPEED_CLIENT_NAME;
  } else {
    process.env.WAVESPEED_CLIENT_NAME = ORIGINAL_ENV;
  }
});

describe('clientAttributionHeaders', () => {
  it('reports the MCP server name, package version, and OS', () => {
    delete process.env.WAVESPEED_CLIENT_NAME;
    const headers = clientAttributionHeaders();
    expect(headers['X-Client-Name']).toBe('wavespeed-mcp');
    expect(headers['X-Client-Version']).toMatch(/^\d+\.\d+\.\d+/);
    expect(['darwin', 'linux', 'windows']).toContain(headers['X-Client-OS']);
  });

  it('lets WAVESPEED_CLIENT_NAME override the client name', () => {
    process.env.WAVESPEED_CLIENT_NAME = 'claude-plugin';
    expect(clientAttributionHeaders()['X-Client-Name']).toBe('claude-plugin');
  });
});

describe('waitForPrediction', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  function serve(statuses: string[]) {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    let i = 0;
    globalThis.fetch = vi.fn(async () => {
      const status = statuses[Math.min(i++, statuses.length - 1)];
      return new Response(
        JSON.stringify({ code: 200, data: { id: 'p1', status, error: status === 'failed' ? 'boom' : undefined } }),
      );
    }) as typeof fetch;
  }

  it('returns the still-running prediction instead of throwing when the wait runs out', async () => {
    serve(['processing']);
    const ticks: string[] = [];
    const r = await waitForPrediction('p1', { intervalMs: 5, timeoutMs: 20, onTick: (p) => void ticks.push(p.status) });
    expect(r).toMatchObject({ done: false, item: { id: 'p1', status: 'processing' } });
    expect(ticks.length).toBeGreaterThan(0);
  });

  it('returns terminal failures as done so the caller decides', async () => {
    serve(['processing', 'failed']);
    const r = await waitForPrediction('p1', { intervalMs: 1, timeoutMs: 1000 });
    expect(r).toMatchObject({ done: true, item: { status: 'failed', error: 'boom' } });
  });

  it('stops early when the request is aborted', async () => {
    serve(['processing']);
    const ac = new AbortController();
    ac.abort();
    const r = await waitForPrediction('p1', { intervalMs: 10_000, signal: ac.signal });
    expect(r.done).toBe(false);
  });
});
