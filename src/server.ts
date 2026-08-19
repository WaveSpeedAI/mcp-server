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
// * Price quotes name the inputs they were blind to instead of presenting
//   the formula's floor as "the" price.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Client } from 'wavespeed';
import {
  fetchModels,
  fetchBalance,
  fetchPricing,
  fetchPrediction,
  submitPrediction,
  waitForPrediction,
  type LiveModel,
} from './lib/api.js';
import { getApiKey, getBaseUrl } from './lib/config.js';
import { resolveLocalFiles } from './lib/local-files.js';
import { uploadWithCache } from './lib/upload-cache.js';
import { missingPriceVars, isFloorQuote } from './lib/pricing-vars.js';

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
  const client = new Client(apiKey, { baseUrl: getBaseUrl() });
  return uploadWithCache(filePath, (p) => client.upload(p));
}

function ok(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: 'wavespeed', version: '1.0.0' },
    {
      instructions: [
        'WaveSpeed AI media generation (image, video, audio, 3D).',
        'Pattern: list_models to find a model, get_model_schema to see its',
        'inputs, run_model to execute. Reference local files as "@./path"',
        'values inside input — they upload automatically; bare paths are',
        'passed through untouched and will fail model validation.',
        'Use get_price before expensive runs. Never invent model IDs.',
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
    { model: z.string().describe('Model ID from list_models, e.g. google/nano-banana-2/text-to-image') },
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
      });
    },
  );

  server.tool(
    'run_model',
    'Run any WaveSpeed model. input keys come from get_model_schema. Local files: pass "@./path" string values — they are uploaded and replaced with hosted URLs (bare paths are NOT uploaded). Returns output URLs. If the wait limit is hit, the task keeps running; recover it with get_prediction.',
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
        .default(600)
        .describe('Max seconds to wait; 0 = submit only and return the prediction id'),
    },
    async ({ model, input, wait_seconds }) => {
      const resolved = await resolveLocalFiles(input as Record<string, unknown>, {
        upload: async (p) => (await uploadFile(p)).url,
      });
      const started = Date.now();
      const submitted = await submitPrediction(model, resolved.input);
      if (wait_seconds === 0) {
        return ok({ id: submitted.id, status: submitted.status, model });
      }
      const done = await waitForPrediction(submitted.id, {
        intervalMs: 2000,
        timeoutMs: wait_seconds * 1000,
      });
      return ok({
        id: submitted.id,
        model,
        status: done.status,
        outputs: done.outputs ?? [],
        elapsed_ms: Date.now() - started,
        uploaded_files: resolved.uploaded,
      });
    },
  );

  server.tool(
    'get_price',
    'Estimate the cost of a run before executing it (no charge). Provide the same input you would pass to run_model — pricing often depends on inputs like duration or resolution.',
    {
      model: z.string().describe('Model ID from list_models'),
      input: z.record(z.unknown()).default({}).describe('Inputs the quote should account for'),
    },
    async ({ model, input }) => {
      const data = await fetchPricing(model, input as Record<string, unknown>);
      // The pricing endpoint accepts partial inputs without complaint — a
      // formula whose variables are all missing collapses to base_price, the
      // floor of the model's range. Name what the quote could not see.
      let unpriced: string[] = [];
      let atFloor = false;
      try {
        const models = await fetchModels();
        const meta = models.find((m) => m.model_id === model);
        unpriced = missingPriceVars(
          meta?.formula,
          input as Record<string, unknown>,
          requestSchema(meta ?? ({} as LiveModel))?.properties,
        );
        atFloor = isFloorQuote(meta?.formula, input as Record<string, unknown>);
      } catch {
        /* no catalog — the generic disclaimer still applies */
      }
      return ok({
        ...data,
        estimate: true,
        unpriced_inputs: unpriced,
        at_base_price: atFloor,
        disclaimer: PRICE_DISCLAIMER,
      });
    },
  );

  server.tool('get_balance', 'Show the WaveSpeed account credit balance.', {}, async () => {
    return ok(await fetchBalance());
  });

  server.tool(
    'upload_file',
    'Upload a local file to WaveSpeed and get its hosted URL (identical bytes reuse the same upload for 24h). Usually unnecessary — run_model handles "@./path" inputs itself.',
    { path: z.string().describe('Local file path') },
    async ({ path: filePath }) => {
      return ok(await uploadFile(filePath));
    },
  );

  server.tool(
    'get_prediction',
    'Fetch the status and outputs of a past or in-flight prediction by id — use to recover a run that hit the wait limit.',
    { id: z.string().describe('Prediction id returned by run_model') },
    async ({ id }) => {
      const item = await fetchPrediction(id);
      return ok({
        id: item.id,
        model: item.model,
        status: item.status,
        outputs: item.outputs ?? [],
        error: item.error,
        created_at: item.created_at,
      });
    },
  );

  return server;
}
