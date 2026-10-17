// WaveSpeed REST helpers, ported from wavespeed-cli src/lib/api.ts so the two
// tools share one design: live /api/v3/models as the only catalog source
// (1h on-disk cache), explicit submit/poll split, and the platform's error
// envelope surfaced instead of bare status lines. Every endpoint here is v3
// and documented in the public api-doc — no internal or legacy contracts.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { getApiKey, getBaseUrl } from './config.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../../package.json') as { version: string };

// Channel-attribution headers (X-Client-Name / X-Client-Version / X-Client-OS),
// following the wavespeed-desktop convention. The WAVESPEED_CLIENT_NAME
// environment variable overrides the name so wrapper channels can brand
// themselves without code changes.
export const MCP_CLIENT_NAME = 'wavespeed-mcp';

export function clientAttributionHeaders(): Record<string, string> {
  const platform = os.platform();
  return {
    'X-Client-Name': process.env.WAVESPEED_CLIENT_NAME || MCP_CLIENT_NAME,
    'X-Client-Version': PKG_VERSION,
    'X-Client-OS': platform === 'win32' ? 'windows' : platform,
  };
}

export interface LiveModel {
  model_id: string;
  name: string;
  description?: string;
  type?: string;
  base_price?: number;
  formula?: string;
  api_schema?: {
    api_schemas?: Array<{
      request_schema?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        ['x-order-properties']?: string[];
      };
    }>;
  };
}

interface Envelope<T> {
  code: number;
  message?: string;
  data: T;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function cachePath(): string {
  return path.join(os.homedir(), '.cache', 'wavespeed', 'models.json');
}

interface CacheFile {
  fetched_at: number;
  base_url: string;
  models: LiveModel[];
}

function readCache(baseUrl: string): CacheFile | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile;
    if (parsed.base_url !== baseUrl) return null;
    if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(baseUrl: string, models: LiveModel[]): void {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true });
    const body: CacheFile = { fetched_at: Date.now(), base_url: baseUrl, models };
    fs.writeFileSync(cachePath(), JSON.stringify(body));
  } catch {
    /* best-effort cache; ignore failures */
  }
}

// Non-2xx responses still carry the platform's error envelope, and for
// permission failures that body is the whole point: it names the role that
// created the key and a role whose key would work.
async function httpError(res: Response, method: string, apiPath: string): Promise<Error> {
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; error_code?: string };
    if (body?.message) {
      detail = body.error_code ? `${body.message} [${body.error_code}]` : body.message;
    }
  } catch {
    /* non-JSON body — fall back below */
  }
  const err: Error & { status?: number } = detail
    ? new Error(detail)
    : new Error(`${method} ${apiPath} failed: ${res.status} ${res.statusText}`);
  err.status = res.status;
  return err;
}

function authHeaders(): Record<string, string> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error(
      'No WaveSpeed API key configured. Set WAVESPEED_API_KEY, or run `wavespeed login`.',
    );
  }
  return { Authorization: `Bearer ${apiKey}`, ...clientAttributionHeaders() };
}

// Per-request timeouts (no overall cap). A hung socket would otherwise stall
// the tool call. Read-only GETs are far below 30s in practice (result p99.9
// < 1s); the async submit gets more headroom because a timeout there is an
// ambiguous outcome, not a clean failure.
export const GET_TIMEOUT_MS = 30_000;
export const SUBMIT_TIMEOUT_MS = 60_000;

async function apiGetOnce<T>(apiPath: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${apiPath}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(GET_TIMEOUT_MS),
  });
  if (!res.ok) throw await httpError(res, 'GET', apiPath);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

// Same set as wavespeed-python. An error with no HTTP status is a network
// failure or timeout; envelope/JSON errors are not transient.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_GET_RETRIES = 5;

function isTransient(err: any): boolean {
  if (typeof err?.status === 'number') return RETRYABLE_STATUS.has(err.status);
  return err instanceof TypeError || err?.name === 'TimeoutError' || err?.name === 'AbortError';
}

// Read-only GETs only — submit (POST) is deliberately never retried.
async function apiGet<T>(
  apiPath: string,
  opts: { retryDelayMs?: number; describe?: (reason: string, attempts: number) => string } = {},
): Promise<T> {
  const delay = opts.retryDelayMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiGetOnce<T>(apiPath);
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      if (!isTransient(err) && !opts.describe) throw err;
      if (!isTransient(err) || attempt >= MAX_GET_RETRIES) {
        throw new Error(opts.describe ? opts.describe(reason, attempt + 1) : reason);
      }
      await new Promise((r) => setTimeout(r, delay * (attempt + 1)));
    }
  }
}

async function apiPost<T>(apiPath: string, body: unknown, opts: { timeoutMs?: number } = {}): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
  });
  if (!res.ok) throw await httpError(res, 'POST', apiPath);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

// The server is a long-lived process, so keep the parsed catalog in memory
// instead of re-reading the ~2MB disk cache on every tool call. Same 1h TTL;
// the disk cache still lets a fresh process start without a network fetch.
let memCache: { baseUrl: string; fetchedAt: number; models: LiveModel[] } | null = null;

export async function fetchModels(opts: { refresh?: boolean } = {}): Promise<LiveModel[]> {
  const baseUrl = getBaseUrl();
  if (!opts.refresh) {
    if (
      memCache &&
      memCache.baseUrl === baseUrl &&
      Date.now() - memCache.fetchedAt <= CACHE_TTL_MS
    ) {
      return memCache.models;
    }
    const cached = readCache(baseUrl);
    if (cached) {
      memCache = { baseUrl, fetchedAt: cached.fetched_at, models: cached.models };
      return cached.models;
    }
  }
  const models = await apiGet<LiveModel[]>('/api/v3/models');
  writeCache(baseUrl, models);
  memCache = { baseUrl, fetchedAt: Date.now(), models };
  return models;
}

export async function fetchBalance(): Promise<{ balance: number }> {
  return apiGet<{ balance: number }>('/api/v3/balance');
}

export interface ModelPrice {
  model_id: string;
  price: number;
  discounted_price: number;
  discount_rate?: number;
  currency?: string;
}

export async function fetchPricing(
  modelId: string,
  inputs: Record<string, unknown>,
): Promise<ModelPrice> {
  // /model/price is the documented pricing endpoint.
  return apiPost('/api/v3/model/price', { model_id: modelId, inputs });
}

export interface Prediction {
  id: string;
  model?: string;
  status: string;
  outputs?: (string | Record<string, unknown>)[];
  error?: string;
  created_at?: string;
  executionTime?: number;
}

/**
 * Submit a prediction WITHOUT waiting for it. Split from polling so the
 * caller has the prediction ID the moment it exists — a dropped connection
 * mid-generation must never orphan a paid task.
 */
export async function submitPrediction(
  model: string,
  input: Record<string, unknown>,
): Promise<Prediction> {
  try {
    return await apiPost<Prediction>(`/api/v3/${model}`, { ...input }, { timeoutMs: SUBMIT_TIMEOUT_MS });
  } catch (err: any) {
    // Never retried: the server may already have created (and billed) the task.
    if (err?.name === 'TimeoutError') {
      throw new Error(
        `Submission outcome unknown: no response within ${SUBMIT_TIMEOUT_MS / 1000}s. The task may have been created and billed — do not resubmit blindly; if you have a prediction id, check it with get_prediction.`,
      );
    }
    throw err;
  }
}

// The message always carries the task id and says the task was not declared
// failed — a status read that dies after submit must not look like a lost
// (or failed) paid task.
export async function fetchPrediction(
  id: string,
  opts: { retryDelayMs?: number } = {},
): Promise<Prediction> {
  return apiGet<Prediction>(`/api/v3/predictions/${id}/result`, {
    retryDelayMs: opts.retryDelayMs,
    describe: (reason, attempts) =>
      `Could not read the status of task ${id} after ${attempts} attempt${attempts > 1 ? 's' : ''}: ${reason}. ` +
      `The task was created and may still be running — call get_prediction with id "${id}" to check it (task_id: ${id}).`,
  });
}

export const TERMINAL_FAILURES = ['failed', 'cancelled', 'timeout', 'deleted'];

/**
 * Poll a prediction until it reaches a terminal status (done=true, whether
 * completed or failed — the caller decides what a failure means) or the wait
 * budget runs out. Running out is NOT an error: generations can take hours,
 * so the caller gets the still-running prediction back (done=false) and
 * reports its id instead of losing it in a thrown message. `onTick` fires
 * after every non-terminal poll. Transient status-read failures are retried.
 */
export async function waitForPrediction(
  id: string,
  opts: {
    intervalMs?: number;
    retryDelayMs?: number;
    timeoutMs?: number;
    onTick?: (item: Prediction) => void | Promise<void>;
    signal?: AbortSignal;
  } = {},
): Promise<{ item: Prediction; done: boolean }> {
  const interval = opts.intervalMs ?? 1000;
  const deadline = opts.timeoutMs !== undefined ? Date.now() + opts.timeoutMs : undefined;
  for (;;) {
    const item = await fetchPrediction(id, { retryDelayMs: opts.retryDelayMs });
    if (item.status === 'completed' || TERMINAL_FAILURES.includes(item.status)) {
      return { item, done: true };
    }
    await opts.onTick?.(item);
    if (opts.signal?.aborted) return { item, done: false };
    if (deadline !== undefined && Date.now() + interval > deadline) return { item, done: false };
    await new Promise((r) => setTimeout(r, interval));
  }
}
