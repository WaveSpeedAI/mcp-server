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
export function clientAttributionHeaders(): Record<string, string> {
  const platform = os.platform();
  return {
    'X-Client-Name': process.env.WAVESPEED_CLIENT_NAME || 'wavespeed-mcp',
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

function readCache(baseUrl: string): LiveModel[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CacheFile;
    if (parsed.base_url !== baseUrl) return null;
    if (Date.now() - parsed.fetched_at > CACHE_TTL_MS) return null;
    return parsed.models;
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
  if (detail) return new Error(detail);
  return new Error(`${method} ${apiPath} failed: ${res.status} ${res.statusText}`);
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

async function apiGet<T>(apiPath: string): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${apiPath}`, { headers: authHeaders() });
  if (!res.ok) throw await httpError(res, 'GET', apiPath);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

async function apiPost<T>(apiPath: string, body: unknown): Promise<T> {
  const res = await fetch(`${getBaseUrl()}${apiPath}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await httpError(res, 'POST', apiPath);
  const json = (await res.json()) as Envelope<T>;
  if (json.code !== 200) throw new Error(json.message || `API returned code ${json.code}`);
  return json.data;
}

export async function fetchModels(opts: { refresh?: boolean } = {}): Promise<LiveModel[]> {
  const baseUrl = getBaseUrl();
  if (!opts.refresh) {
    const cached = readCache(baseUrl);
    if (cached) return cached;
  }
  const models = await apiGet<LiveModel[]>('/api/v3/models');
  writeCache(baseUrl, models);
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
  return apiPost<Prediction>(`/api/v3/${model}`, { ...input });
}

export async function fetchPrediction(id: string): Promise<Prediction> {
  return apiGet<Prediction>(`/api/v3/predictions/${id}/result`);
}

/** Poll a prediction until it reaches a terminal status. */
export async function waitForPrediction(
  id: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<Prediction> {
  const interval = opts.intervalMs ?? 1000;
  const deadline = opts.timeoutMs ? Date.now() + opts.timeoutMs : undefined;
  for (;;) {
    const item = await fetchPrediction(id);
    if (item.status === 'completed') return item;
    if (item.status === 'failed' || item.status === 'cancelled' || item.status === 'timeout') {
      throw new Error(
        `Prediction ${item.status}${item.error ? `: ${item.error}` : ''} (task_id: ${id})`,
      );
    }
    if (deadline && Date.now() > deadline) {
      throw new Error(
        `Still ${item.status} after the wait limit (task_id: ${id}). ` +
          `The task keeps running server-side — check it later with get_prediction.`,
      );
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}
