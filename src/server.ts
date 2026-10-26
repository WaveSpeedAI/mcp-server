// WaveSpeed MCP server — tools mirror the wavespeed CLI's verbs.
//
// Design (shared with wavespeed-cli):
// * The live /api/v3/models catalog is the only model source for `run_model`:
//   no hardcoded per-model tool, so new platform models work the day they ship.
// * One generation verb (`run_model`), driven by per-model schemas exposed
//   through `get_model_schema`.
// * Five shortcut verbs (generate_image, edit_image, generate_video,
//   edit_video, extend_video) pick the endpoint and fit the input for the
//   models the WaveSpeed /chat page offers (lib/media-models.ts). They submit
//   through the same path as `run_model`.
// * Inputs are never mutated. The one explicit transform is the `@path`
//   marker, which uploads the referenced local file and substitutes its
//   hosted URL. Bare paths pass through untouched.
// * Price quotes are estimates for the inputs given; the model's playground
//   page is linked next to them for what each input means.

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
  modelPlaygroundUrl,
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
import { IMAGE_MODEL_KEYS, VIDEO_MODEL_KEYS } from './lib/media-models.js';
import { planImage, planVideo, type MediaPlan, type Prop } from './lib/media-plan.js';

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

// Input properties of an endpoint from the live catalog, for fitting a
// request to what the model accepts. Null when the catalog has no schema.
async function catalogProps(modelId: string): Promise<Record<string, Prop> | null> {
  const model = (await fetchModels()).find((m) => m.model_id === modelId);
  const props = model && requestSchema(model)?.properties;
  return props ? (props as Record<string, Prop>) : null;
}

// Wait for a submitted prediction up to wait_seconds and report it. Shared by
// run_model and the shortcut verbs so a run reads the same whichever started it.
async function reportPrediction(
  submitted: { id: string; status: string },
  model: string,
  waitSeconds: number,
  extra: ToolExtra,
  started: number,
  // always: in every reply; waited: only when the call waited for the result.
  more: { always?: Record<string, unknown>; waited?: Record<string, unknown> } = {},
) {
  if (waitSeconds === 0) {
    return ok({ id: submitted.id, status: submitted.status, model, done: false, ...more.always, next: STILL_RUNNING_HINT });
  }
  const { item, done } = await waitForPrediction(submitted.id, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: waitSeconds * 1000,
    onTick: progressTicker(extra, submitted.id, started),
    signal: extra.signal,
  });
  if (TERMINAL_FAILURES.includes(item.status)) {
    throw new Error(`Prediction ${item.status}${item.error ? `: ${item.error}` : ''} (task_id: ${submitted.id})`);
  }
  return ok({
    id: submitted.id,
    model,
    status: item.status,
    done,
    outputs: item.outputs ?? [],
    elapsed_ms: Date.now() - started,
    ...more.waited,
    ...more.always,
    ...(done ? {} : { next: STILL_RUNNING_HINT }),
  });
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
        'For plain image or video generation, generate_image, edit_image,',
        'generate_video, edit_video and extend_video pick the model and inputs',
        'for you (the models of the WaveSpeed chat page); pass estimate_only to',
        'get the price without running.',
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
        playground_url: modelPlaygroundUrl(meta.model_id),
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
      return reportPrediction(submitted, model, wait_seconds, extra, started, { waited: { uploaded_files: resolved.uploaded } });
    },
  );

  // ---- Shortcut verbs: the models the /chat page offers, endpoint and input
  // chosen and fitted for the caller (see lib/media-plan.ts). They submit and
  // wait exactly like run_model, and estimate_only quotes without running.
  const waitSchema = z
    .number()
    .int()
    .min(0)
    .max(1800)
    .default(DEFAULT_WAIT_SECONDS)
    .describe(`Max seconds to wait for the result in this call (default ${DEFAULT_WAIT_SECONDS}: return the prediction id right away)`);
  const estimateSchema = z
    .boolean()
    .default(false)
    .describe('true: only return the price estimate and the request that would run. Nothing is submitted or charged.');
  const mediaList = (what: string) =>
    z.array(z.string()).describe(`${what}: public URLs, or "@./path" for local files (uploaded automatically).`);
  const REFS =
    'In the prompt, name input media as @image 1, @image 2, @video 1, @audio 1 (counted in the order the lists are given); they are renamed to what the model expects.';
  const shortcutAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

  async function runPlan(plan: MediaPlan, opts: { estimate_only: boolean; wait_seconds: number }, extra: ToolExtra, uploaded: number) {
    let estimate: unknown = null;
    let estimateError: string | undefined;
    try {
      estimate = await fetchPricing(plan.modelId, plan.input);
    } catch (err: any) {
      estimateError = err?.message ?? String(err);
    }
    const summary = {
      model_label: plan.label,
      mode: plan.mode,
      estimate,
      ...(estimateError ? { estimate_error: estimateError } : {}),
      ...(plan.notes.length ? { notes: plan.notes } : {}),
    };
    if (opts.estimate_only) {
      return ok({
        estimate_only: true,
        model: plan.modelId,
        input: plan.input,
        ...summary,
        disclaimer: PRICE_DISCLAIMER,
        playground_url: modelPlaygroundUrl(plan.modelId),
      });
    }
    const started = Date.now();
    const submitted = await submitPrediction(plan.modelId, plan.input);
    return reportPrediction(submitted, plan.modelId, opts.wait_seconds, extra, started, {
      always: summary,
      waited: { uploaded_files: uploaded },
    });
  }

  // Replace @path values in the media arguments with hosted URLs. The prompt is
  // not scanned: a prompt that starts with "@image 1" is not a file.
  async function withUploads<T extends object>(args: T, keys: string[]): Promise<{ args: T; uploaded: number }> {
    const media: Record<string, unknown> = {};
    for (const k of keys) if ((args as Record<string, unknown>)[k] !== undefined) media[k] = (args as Record<string, unknown>)[k];
    const resolved = await resolveLocalFiles(media, { upload: async (p) => (await uploadFile(p)).url });
    return { args: { ...args, ...resolved.input }, uploaded: resolved.uploaded };
  }

  const imageShape = {
    prompt: z.string().min(1).describe('Complete visual prompt: subject, composition, style, lighting, mood.'),
    model: z.enum(IMAGE_MODEL_KEYS as [string, ...string[]]).optional().describe('Only when the user names a model; default is the first (Seedream 5 Pro).'),
    aspect_ratio: z.string().optional().describe('e.g. 1:1, 16:9, 9:16, 4:3, 3:4; snapped to what the model supports.'),
    resolution: z.enum(['1k', '2k', '4k']).optional().describe('Only when the user asks for a size.'),
    wait_seconds: waitSchema,
    estimate_only: estimateSchema,
  };
  const IMAGE_KEYS = ['images', 'reference_images'];

  server.tool(
    'generate_image',
    `Create an image from a text description with the same models as the WaveSpeed /chat page (${IMAGE_MODEL_KEYS.join(', ')}; default ${IMAGE_MODEL_KEYS[0]}). Give reference_images to use existing images as subject, product, face or style (the model's edit endpoint is used). To change existing images use edit_image. ${REFS}`,
    { ...imageShape, reference_images: mediaList('Optional images whose subject, product, face or style the new image should use').optional() },
    shortcutAnnotations,
    async (raw, extra) => {
      const { args, uploaded } = await withUploads(raw, IMAGE_KEYS);
      const plan = await planImage(args, catalogProps);
      return runPlan(plan, { estimate_only: raw.estimate_only, wait_seconds: raw.wait_seconds }, extra, uploaded);
    },
  );

  server.tool(
    'edit_image',
    `Change existing images with the same models as the WaveSpeed /chat page: edits, restyles, backgrounds, adding or removing things, combining several images. ${REFS}`,
    { ...imageShape, images: mediaList('The images to edit, in order').min(1) },
    shortcutAnnotations,
    async (raw, extra) => {
      const { args, uploaded } = await withUploads(raw, IMAGE_KEYS);
      const plan = await planImage(args, catalogProps);
      return runPlan(plan, { estimate_only: raw.estimate_only, wait_seconds: raw.wait_seconds }, extra, uploaded);
    },
  );

  const videoModelSchema = z
    .enum(VIDEO_MODEL_KEYS as [string, ...string[]])
    .optional()
    .describe(`Only when the user names a model (${VIDEO_MODEL_KEYS.join(', ')}). Without it the default (${VIDEO_MODEL_KEYS[0]}) is used, and another model only when it cannot take the inputs.`);
  const resolutionSchema = z
    .enum(['480p', '540p', '720p', '768p', '1080p'])
    .optional()
    .describe('Only when the user asks for a resolution, or 480p for a cheaper draft; otherwise omit. MiniMax H3 defaults to 768p (its equivalent of 720p).');
  const durationSchema = z.number().int().optional().describe('Seconds, only when the user asks for a length; omit to use the model default.');
  const VIDEO_KEYS = ['first_frame', 'last_frame', 'reference_images', 'reference_videos', 'reference_audios', 'video'];

  server.tool(
    'generate_video',
    `Create a video with the same models as the WaveSpeed /chat page (default ${VIDEO_MODEL_KEYS[0]}). Give first_frame to animate an image; give reference_images / reference_videos / reference_audios to keep characters, products, motion, voice or music. The right mode (text, image or reference to video) is picked from what you give. Videos can cost dollars: use estimate_only first when unsure. ${REFS}`,
    {
      prompt: z.string().min(1).describe('Shot description: subject, action, camera movement, style, sound.'),
      model: videoModelSchema,
      first_frame: z.string().optional().describe('Image to start the video from (URL or "@./path").'),
      last_frame: z.string().optional().describe('Optional image to end on (needs first_frame).'),
      reference_images: mediaList('Optional images for characters, products or style to keep (not a first frame)').optional(),
      reference_videos: mediaList('Optional videos for motion, camera or a character to follow').optional(),
      reference_audios: mediaList('Optional audio for voice, music or sound to use').optional(),
      duration: durationSchema,
      resolution: resolutionSchema,
      aspect_ratio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']).optional(),
      wait_seconds: waitSchema,
      estimate_only: estimateSchema,
    },
    shortcutAnnotations,
    async (raw, extra) => {
      const { args, uploaded } = await withUploads(raw, VIDEO_KEYS);
      const plan = await planVideo(args, 'generate', catalogProps);
      return runPlan(plan, { estimate_only: raw.estimate_only, wait_seconds: raw.wait_seconds }, extra, uploaded);
    },
  );

  server.tool(
    'edit_video',
    `Edit an existing video with the same models as the WaveSpeed /chat page. Name the video and any references in the prompt (e.g. "replace the cat in @video 1 with the lion from @image 1"). ${REFS}`,
    {
      prompt: z.string().min(1).describe('What to change in the video and what must stay.'),
      video: z.string().describe('The video to edit (URL or "@./path").'),
      reference_images: mediaList('Optional images to use as references').optional(),
      reference_audios: mediaList('Optional audio for voice, music or sound').optional(),
      model: videoModelSchema,
      resolution: resolutionSchema,
      wait_seconds: waitSchema,
      estimate_only: estimateSchema,
    },
    shortcutAnnotations,
    async (raw, extra) => {
      const { args, uploaded } = await withUploads(raw, VIDEO_KEYS);
      const plan = await planVideo(args, 'edit', catalogProps);
      return runPlan(plan, { estimate_only: raw.estimate_only, wait_seconds: raw.wait_seconds }, extra, uploaded);
    },
  );

  server.tool(
    'extend_video',
    `Continue an existing video with new footage after its end, with the same models as the WaveSpeed /chat page. Turbo models cannot extend. ${REFS}`,
    {
      prompt: z.string().min(1).describe('What happens next.'),
      video: z.string().describe('The video to continue (URL or "@./path").'),
      last_frame: z.string().optional().describe('Optional image the continuation should end on.'),
      duration: durationSchema.describe('Seconds of new footage; omit to use the model default.'),
      model: videoModelSchema,
      resolution: resolutionSchema,
      wait_seconds: waitSchema,
      estimate_only: estimateSchema,
    },
    shortcutAnnotations,
    async (raw, extra) => {
      const { args, uploaded } = await withUploads(raw, VIDEO_KEYS);
      const plan = await planVideo(args, 'extend', catalogProps);
      return runPlan(plan, { estimate_only: raw.estimate_only, wait_seconds: raw.wait_seconds }, extra, uploaded);
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
      return ok({ ...data, estimate: true, disclaimer: PRICE_DISCLAIMER, playground_url: modelPlaygroundUrl(model) });
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
