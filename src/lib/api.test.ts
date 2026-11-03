import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { callerCacheId } from './config.js';
import {
  clientAttributionHeaders,
  waitForPrediction,
  submitPrediction,
  fetchHistory,
  fetchBillings,
  fetchUsageStats,
  deletePredictions,
  modelPlaygroundUrl,
  fetchModels,
} from './api.js';

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

  it('treats an empty or unknown status as final and keeps the error (archived outputs)', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    const bodies = [
      { id: 'p1', model: 'm', status: '', outputs: [], error: 'The outputs of this prediction have expired.' },
      { id: '', model: '', status: '', outputs: [] },
      { id: 'p1', status: 'archived' },
    ];
    for (const data of bodies) {
      let calls = 0;
      globalThis.fetch = vi.fn(async () => {
        calls++;
        return new Response(JSON.stringify({ code: 200, data }));
      }) as typeof fetch;
      const r = await waitForPrediction('p1', { intervalMs: 1, timeoutMs: 1000 });
      expect(r.done).toBe(true);
      expect(r.item).toEqual(data);
      expect(calls).toBe(1);
    }
  });

  it('keeps waiting only while created or processing', async () => {
    serve(['created', 'processing', 'completed']);
    const r = await waitForPrediction('p1', { intervalMs: 1, timeoutMs: 1000 });
    expect(r).toMatchObject({ done: true, item: { status: 'completed' } });
  });

  it('stops early when the request is aborted', async () => {
    serve(['processing']);
    const ac = new AbortController();
    ac.abort();
    const r = await waitForPrediction('p1', { intervalMs: 10_000, signal: ac.signal });
    expect(r.done).toBe(false);
  });
});

describe('polling retries', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const done = () => reply(200, { code: 200, data: { id: 't1', status: 'completed' } });

  function stub(responses: Array<Response | Error>) {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    let i = 0;
    const fn = vi.fn(async () => {
      const r = responses[Math.min(i++, responses.length - 1)];
      if (r instanceof Error) throw r;
      return r.clone();
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    return fn;
  }

  it('survives two 502s then succeeds', async () => {
    const fn = stub([reply(502, {}), reply(502, {}), done()]);
    const r = await waitForPrediction('t1', { retryDelayMs: 1, intervalMs: 1 });
    expect(r).toMatchObject({ done: true, item: { status: 'completed' } });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries network errors', async () => {
    const fn = stub([new TypeError('fetch failed'), done()]);
    await waitForPrediction('t1', { retryDelayMs: 1 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('persistent 502 names the task id and points at get_prediction', async () => {
    const fn = stub([reply(502, { message: 'bad gateway' })]);
    const err = await waitForPrediction('t1', { retryDelayMs: 1 }).catch((e) => e);
    expect(err.message).toMatch(/t1/);
    expect(err.message).toMatch(/get_prediction/);
    expect(err.message).toMatch(/bad gateway/);
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it('does not retry 401 and still names the task id', async () => {
    const fn = stub([reply(401, { message: 'bad key' })]);
    await expect(waitForPrediction('t1', { retryDelayMs: 1 })).rejects.toThrow(/bad key[\s\S]*t1/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('never retries submit', async () => {
    const fn = stub([reply(502, {}), done()]);
    await expect(submitPrediction('m/x', {})).rejects.toThrow(/502/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('per-request timeouts', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  const okBody = () => new Response(JSON.stringify({ code: 200, data: { id: 't1', status: 'completed' } }));

  it('submit uses a 60s signal and status GET 30s', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    const spy = vi.spyOn(AbortSignal, 'timeout');
    globalThis.fetch = vi.fn(async () => okBody()) as unknown as typeof fetch;
    await submitPrediction('m/x', {});
    await waitForPrediction('t1', { retryDelayMs: 1 });
    expect(spy.mock.calls.map((c) => c[0])).toEqual([60_000, 30_000]);
  });

  it('submit timeout gives the ambiguous message with exactly one POST', async () => {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    const fn = vi.fn(async () => {
      throw new DOMException('timed out', 'TimeoutError');
    });
    globalThis.fetch = fn as unknown as typeof fetch;
    await expect(submitPrediction('m/x', {})).rejects.toThrow(/outcome unknown.*may have been created/);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('history, billings and usage', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  function capture() {
    vi.stubEnv('WAVESPEED_API_KEY', 'test');
    const calls: { url: string; body: any }[] = [];
    globalThis.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ code: 200, data: { page: 1, items: [] } }));
    }) as typeof fetch;
    return calls;
  }

  it('history defaults to a 24h window and sends only the given filters', async () => {
    const calls = capture();
    await fetchHistory({ status: 'failed', pageSize: 5 });
    expect(calls[0].url).toMatch(/\/api\/v3\/predictions$/);
    const b = calls[0].body;
    expect(b).toMatchObject({ page: 1, page_size: 5, status: 'failed' });
    expect(b.model).toBeUndefined();
    expect(Date.parse(b.created_before) - Date.parse(b.created_after)).toBe(24 * 60 * 60 * 1000);
  });

  it('billings maps filters to the v3 field names', async () => {
    const calls = capture();
    await fetchBillings({ type: 'refund', model: 'm1', accessKey: 'k1', startTime: 's', endTime: 'e' });
    expect(calls[0].url).toMatch(/\/api\/v3\/billings\/search$/);
    expect(calls[0].body).toEqual({
      page: 1,
      page_size: 20,
      billing_type: 'refund',
      model_uuid: 'm1',
      access_key_uuid: 'k1',
      start_time: 's',
      end_time: 'e',
    });
  });

  it('usage posts the window and optional model', async () => {
    const calls = capture();
    await fetchUsageStats('s', 'e', 'm1');
    expect(calls[0].url).toMatch(/\/api\/v3\/user\/usage_stats$/);
    expect(calls[0].body).toEqual({ start_time: 's', end_time: 'e', model_uuid: 'm1' });
  });

  it('delete posts the ids to the delete endpoint', async () => {
    const calls = capture();
    await deletePredictions(['p1', 'p2']);
    expect(calls[0].url).toMatch(/\/api\/v3\/predictions\/delete$/);
    expect(calls[0].body).toEqual({ ids: ['p1', 'p2'] });
  });
});

describe('modelPlaygroundUrl', () => {
  it('links the model page, keeping every path segment', () => {
    expect(modelPlaygroundUrl('google/nano-banana-2.1/edit')).toBe(
      'https://wavespeed.ai/models/google/nano-banana-2.1/edit',
    );
  });
});

describe('catalog cache', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllEnvs();
  });

  it('keeps one file per base URL + API key and never writes the key', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mcp-home-'));
    vi.stubEnv('HOME', home);
    vi.stubEnv('WAVESPEED_BASE_URL', 'https://api.test');
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response(JSON.stringify({ code: 200, data: [{ model_id: `m${calls}`, name: 'm' }] }));
    }) as typeof fetch;

    vi.stubEnv('WAVESPEED_API_KEY', 'secret-key-a');
    expect((await fetchModels())[0].model_id).toBe('m1');
    vi.stubEnv('WAVESPEED_API_KEY', 'secret-key-b');
    // Another key does not see the first key's catalog, in memory or on disk.
    expect((await fetchModels())[0].model_id).toBe('m2');

    const dir = path.join(home, '.cache', 'wavespeed');
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual(
      [`models-${callerCacheId('https://api.test', 'secret-key-a')}.json`, `models-${callerCacheId('https://api.test', 'secret-key-b')}.json`].sort(),
    );
    for (const f of files) expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toContain('secret-key');
    fs.rmSync(home, { recursive: true, force: true });
  });
});
