// WaveSpeed MCP server — tools mirror the wavespeed CLI's verbs.
//
// Design (shared with wavespeed-cli):
// * The live /api/v3/models catalog is the only model source. There is no
//   bundled model list and no hardcoded per-model tool — new platform models
//   work the day they ship.
// * One generation verb (`run_model`), driven by per-model schemas exposed
//   through `get_model_schema`.
// * Inputs are never mutated. The one explicit transform is the `@path`
//   marker, which uploads the referenced local file and substitutes its
//   hosted URL. Bare paths pass through untouched.
// * Price quotes are estimates for the inputs given; the model's docs page
//   is linked next to them for what each input means.

import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Client } from 'wavespeed';
import {
  fetchModels,
  fetchBalance,
  fetchHistory,
  fetchBillings,
  fetchUsageStats,
  deletePredictions,
  PREDICTION_STATUSES,
  fetchPricing,
  modelDocsUrl,
  fetchPrediction,
  submitPrediction,
  waitForPrediction,
  MCP_CLIENT_NAME,
  TERMINAL_FAILURES,
  type LiveModel,
  type Prediction,
} from './lib/api.js';
import { getApiKey, getBaseUrl } from './lib/config.js';
import { MAX_DELETE_IDS, prepareDelete, summarizeDelete } from './lib/delete-predictions.js';

// Where to add credit; handed to the assistant next to the balance.
const TOP_UP_URL = 'https://wavespeed.ai/top-up';
import { resolveLocalFiles } from './lib/local-files.js';
import { uploadWithCache } from './lib/upload-cache.js';
import { findUnknownInputs } from './lib/validate-inputs.js';

const require = createRequire(import.meta.url);
const { version: PKG_VERSION } = require('../package.json') as { version: string };

function toIso(value: string | undefined, name: string): string | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new Error(`Invalid ${name} "${value}": use ISO 8601 or YYYY-MM-DD.`);
  return new Date(t).toISOString();
}

const PRICE_DISCLAIMER =
  'Estimate only, for reference — the amount actually charged for a run is authoritative.';

function requestSchema(m: LiveModel) {
  return m.api_schema?.api_schemas?.[0]?.request_schema;
}

function compactModel(m: LiveModel) {
  return {
    model_id: m.model_id,
    name: m.name,
    type: m.type,
    base_price: m.base_price,
    description: m.description?.slice(0, 160),
  };
}

async function uploadFile(filePath: string): Promise<{ url: string; cached: boolean }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No API key configured (WAVESPEED_API_KEY or `wavespeed login`).');
  const client = new Client(apiKey, { baseUrl: getBaseUrl(), clientName: MCP_CLIENT_NAME });
  return uploadWithCache(filePath, (p) => client.upload(p));
}

// run_model submits and returns the prediction id right away (same as the
// hosted server); the assistant then waits with get_prediction. Many MCP
// clients abort a tool call after 60s and an aborted call never delivers the
// id, so a long wait is opt-in via wait_seconds.
const DEFAULT_WAIT_SECONDS = 0;
const POLL_INTERVAL_MS = 2000;

const STILL_RUNNING_HINT =
  'The run was submitted and is processing on the server. Call get_prediction with this id and wait_seconds ' +
  'until done=true; it returns the output URLs. Do not submit the same run again: a new run is billed again.';

type ToolExtra = {
  signal: AbortSignal;
  _meta?: { progressToken?: string | number };
  sendNotification: (n: {
    method: 'notifications/progress';
    params: { progressToken: string | number; progress: number; message?: string };
  }) => Promise<void>;
};

// Emits notifications/progress while polling when the client asked for it.
// Each one carries the prediction id, and clients that reset their timeout
// on progress keep a long wait alive.
function progressTicker(extra: ToolExtra, id: string, startedAt: number) {
  const token = extra._meta?.progressToken;
  if (token === undefined) return undefined;
  let n = 0;
  return async (item: Prediction) => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    await extra
      .sendNotification({
        method: 'notifications/progress',
        params: { progressToken: token, progress: ++n, message: `prediction ${id}: ${item.status} (${secs}s)` },
      })
      .catch(() => {
        /* progress is advisory */
      });
  };
}

// Reject inputs the model's schema does not declare. The API silently drops
// unknown keys and still bills the run, so this is the last free moment to
// catch an invented parameter. Fails open when no schema is available, and
// re-fetches the catalog once before rejecting so a stale cache can't block
// a valid input.
async function assertKnownInputs(model: string, input: Record<string, unknown>): Promise<void> {
  let report;
  try {
    report = findUnknownInputs(input, (await fetchModels()).find((m) => m.model_id === model));
    if (report) {
      const fresh = await fetchModels({ refresh: true });
      report = findUnknownInputs(input, fresh.find((m) => m.model_id === model));
    }
  } catch {
    return; // catalog unreachable — validation is best-effort
  }
  if (!report) return;
  const hints = report.unknown.map((k) => {
    const s = report!.suggestions.get(k);
    return s ? `${k} (did you mean ${s}?)` : k;
  });
  throw new Error(
    `Model ${model} does not accept: ${hints.join(', ')}. The API silently drops unknown ` +
      `inputs and still bills the run, so nothing was submitted. Accepted inputs: ` +
      `${report.known.join(', ')}. See get_model_schema.`,
  );
}

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'wavespeed', version: PKG_VERSION },
    {
      instructions: [
        'WaveSpeed AI media generation (image, video, audio, 3D).',
        'Pattern: list_models to find a model, get_model_schema to see its',
        'inputs, run_model to execute. Reference local files as "@./path"',
        'values inside input — they upload automatically; bare paths are',
        'passed through untouched and will fail model validation.',
        'Use get_price before expensive runs. Never invent model IDs or input keys.',
        'Long generations (video, some audio/3D) can run for hours: when',
        'run_model returns done=false, keep the id and poll get_prediction.',
      ].join(' '),
    },
  );

  server.tool(
    'list_models',
    'Search the live WaveSpeed model catalog (image, video, audio, 3D). Returns model IDs usable with run_model. Do not invent model IDs — always pick one returned by this tool.',
    {
      query: z.string().optional().describe('Free-text filter on id/name/description'),
      type: z
        .string()
        .optional()
        .describe('Filter by modality type, e.g. text-to-image, image-to-video'),
      limit: z.number().int().min(1).max(200).default(30).describe('Max results'),
      refresh: z.boolean().default(false).describe('Bypass the 1h catalog cache'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ query, type, limit, refresh }) => {
      const models = await fetchModels({ refresh });
      const q = query?.toLowerCase();
      const filtered = models.filter((m) => {
        if (type && (m.type ?? '') !== type) return false;
        if (!q) return true;
        return (
          m.model_id.toLowerCase().includes(q) ||
          m.name.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q)
        );
      });
      return ok({
        total_matches: filtered.length,
        models: filtered.slice(0, limit).map(compactModel),
      });
    },
  );

  server.tool(
    'get_model_schema',
    "Get a model's real input schema (required fields, properties, defaults). Call this before run_model so inputs match what the model actually accepts.",
    { model: z.string().describe('Model ID from list_models, e.g. bytedance/seedream-v5.0-pro') },
    { readOnlyHint: true, openWorldHint: true },
    async ({ model }) => {
      const models = await fetchModels();
      const meta = models.find((m) => m.model_id === model);
      if (!meta) {
        throw new Error(`Unknown model: ${model}. Use list_models to find valid IDs.`);
      }
      const schema = requestSchema(meta);
      return ok({
        model_id: meta.model_id,
        type: meta.type,
        base_price: meta.base_price,
        required: schema?.required ?? [],
        properties: schema?.properties ?? {},
        property_order: schema?.['x-order-properties'] ?? [],
        docs_url: modelDocsUrl(meta.model_id),
      });
    },
  );

  server.tool(
    'run_model',
    'Run any WaveSpeed model. input keys come from get_model_schema; unknown keys are rejected before submission. Local files: pass "@./path" string values — they are uploaded and replaced with hosted URLs (bare paths are NOT uploaded). Returns the prediction id right away (done=false); call get_prediction with that id and wait_seconds until done=true to get the output URLs. The task keeps running on the server. Pass wait_seconds here to wait for a quick model in the same call.',
    {
      model: z.string().describe('Model ID from list_models'),
      input: z
        .record(z.unknown())
        .describe('Model inputs per its schema (e.g. {"prompt": "...", "aspect_ratio": "16:9"})'),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .default(DEFAULT_WAIT_SECONDS)
        .describe(
          `Max seconds to wait for the result in this call (default ${DEFAULT_WAIT_SECONDS}: return the prediction id right away)`,
        ),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async ({ model, input, wait_seconds }, extra) => {
      const resolved = await resolveLocalFiles(input as Record<string, unknown>, {
        upload: async (p) => (await uploadFile(p)).url,
      });
      await assertKnownInputs(model, resolved.input);
      const started = Date.now();
      const submitted = await submitPrediction(model, resolved.input);
      if (wait_seconds === 0) {
        return ok({ id: submitted.id, status: submitted.status, model, done: false, next: STILL_RUNNING_HINT });
      }
      const { item, done } = await waitForPrediction(submitted.id, {
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: wait_seconds * 1000,
        onTick: progressTicker(extra, submitted.id, started),
        signal: extra.signal,
      });
      if (TERMINAL_FAILURES.includes(item.status)) {
        throw new Error(
          `Prediction ${item.status}${item.error ? `: ${item.error}` : ''} (task_id: ${submitted.id})`,
        );
      }
      return ok({
        id: submitted.id,
        model,
        status: item.status,
        done,
        outputs: item.outputs ?? [],
        elapsed_ms: Date.now() - started,
        uploaded_files: resolved.uploaded,
        ...(done ? {} : { next: STILL_RUNNING_HINT }),
      });
    },
  );

  server.tool(
    'get_price',
    'Estimate the cost of a run before executing it (no charge). Provide the same input you would pass to run_model — pricing often depends on inputs like duration or resolution, and a quote made without them can be lower than the real charge.',
    {
      model: z.string().describe('Model ID from list_models'),
      input: z.record(z.unknown()).default({}).describe('Inputs the quote should account for'),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ model, input }) => {
      // Resolve @path markers exactly like run_model: some prices are measured
      // from the file itself, so quoting with the literal "@./a.mp3" string
      // would be wrong. The 24h content-hash cache means the later run reuses
      // this upload.
      const resolved = await resolveLocalFiles(input as Record<string, unknown>, {
        upload: async (p) => (await uploadFile(p)).url,
      });
      const priceInput = resolved.input;
      const data = await fetchPricing(model, priceInput);
      return ok({ ...data, estimate: true, disclaimer: PRICE_DISCLAIMER, docs_url: modelDocsUrl(model) });
    },
  );

  server.tool('get_balance', 'Show the WaveSpeed account credit balance, with the link to top up.', {}, { readOnlyHint: true, openWorldHint: true }, async () => {
    return ok({ ...(await fetchBalance()), top_up_url: TOP_UP_URL });
  });

  server.tool(
    'list_predictions',
    'List past predictions (run history), newest window first. Defaults to the last 24 hours; pass since/until (ISO or YYYY-MM-DD) for other ranges. Use get_prediction with an id for one task in full.',
    {
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20).describe('Page size'),
      model: z.string().optional().describe('Filter by model ID'),
      status: z.enum(PREDICTION_STATUSES as [string, ...string[]]).optional(),
      since: z.string().optional().describe('Created after this time (ISO or YYYY-MM-DD)'),
      until: z.string().optional().describe('Created before this time (ISO or YYYY-MM-DD)'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ page, limit, model, status, since, until }) => {
      return ok(
        await fetchHistory({
          page,
          pageSize: limit,
          model,
          status,
          createdAfter: toIso(since, 'since'),
          createdBefore: toIso(until, 'until'),
        }),
      );
    },
  );

  server.tool(
    'list_billings',
    'List itemized charges and refunds (billing records). Requires an API key with Billing access.',
    {
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20).describe('Page size'),
      type: z.enum(['deduct', 'refund']).optional(),
      model: z.string().optional().describe('Filter by model uuid'),
      key: z.string().optional().describe('Filter by the API key uuid that generated the charge'),
      since: z.string().optional().describe('Records after this time (ISO or YYYY-MM-DD)'),
      until: z.string().optional().describe('Records before this time (ISO or YYYY-MM-DD)'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ page, limit, type, model, key, since, until }) => {
      return ok(
        await fetchBillings({
          page,
          pageSize: limit,
          type,
          model,
          accessKey: key,
          startTime: toIso(since, 'since'),
          endTime: toIso(until, 'until'),
        }),
      );
    },
  );

  server.tool(
    'get_usage',
    'Usage statistics: spend, request counts, daily series and per-model breakdown. Defaults to the last 7 days. Requires an API key with Billing access.',
    {
      since: z.string().optional().describe('Start (ISO or YYYY-MM-DD); default 7 days ago'),
      until: z.string().optional().describe('End (ISO or YYYY-MM-DD); default now'),
      model: z.string().optional().describe('Filter by model uuid'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ since, until, model }) => {
      const end = toIso(until, 'until') ?? new Date().toISOString();
      const start = toIso(since, 'since') ?? new Date(Date.parse(end) - 7 * 24 * 60 * 60 * 1000).toISOString();
      return ok(await fetchUsageStats(start, end, model));
    },
  );

  server.tool(
    'delete_predictions',
    `Delete finished predictions from this account's run history, up to ${MAX_DELETE_IDS} at a time. They stop appearing in list_predictions and get_prediction, and this tool cannot bring them back. Runs that are still going are left alone, and only the key's own organization's records are deleted. Ask the user first, and pass confirm: true only after they agreed to delete these ids.`,
    {
      ids: z.array(z.string()).min(1).max(MAX_DELETE_IDS).describe('Prediction ids to delete'),
      confirm: z.boolean().describe('Must be true: the user has agreed to delete these predictions'),
    },
    { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    async ({ ids, confirm }) => {
      const toDelete = prepareDelete(ids, confirm);
      const res = await deletePredictions(toDelete);
      return ok(summarizeDelete(toDelete, res.deleted_ids));
    },
  );

  server.tool(
    'upload_file',
    'Upload a local file to WaveSpeed and get its hosted URL (identical bytes reuse the same upload for 24h). Usually unnecessary — run_model handles "@./path" inputs itself.',
    { path: z.string().describe('Local file path') },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ path: filePath }) => {
      return ok(await uploadFile(filePath));
    },
  );

  server.tool(
    'get_prediction',
    'Fetch the status and outputs of a past or in-flight prediction by id — use to pick up a run that returned done=false. Pass wait_seconds to keep waiting for it to finish.',
    {
      id: z.string().describe('Prediction id returned by run_model'),
      wait_seconds: z
        .number()
        .int()
        .min(0)
        .max(1800)
        .default(0)
        .describe('Max seconds to wait for a terminal status; 0 = return the current status now'),
    },
    { readOnlyHint: true, openWorldHint: true },
    async ({ id, wait_seconds }, extra) => {
      const started = Date.now();
      const { item, done } = await waitForPrediction(id, {
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: wait_seconds * 1000,
        onTick: wait_seconds > 0 ? progressTicker(extra, id, started) : undefined,
        signal: extra.signal,
      });
      return ok({
        id: item.id,
        model: item.model,
        status: item.status,
        done,
        outputs: item.outputs ?? [],
        error: item.error,
        created_at: item.created_at,
        ...(done ? {} : { next: STILL_RUNNING_HINT }),
      });
    },
  );

  return server;
}
