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
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { McpServer, ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/server';
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
  isPending,
  type LiveModel,
  type Prediction,
} from './lib/api.js';
import { callerCacheId, getApiKey, getBaseUrl } from './lib/config.js';
import { MAX_DELETE_IDS, prepareDelete, summarizeDelete } from './lib/delete-predictions.js';

// Where to add credit; handed to the assistant next to the balance.
const TOP_UP_URL = 'https://wavespeed.ai/top-up';
import { resolveLocalFiles } from './lib/local-files.js';
import {
  APP_MIME_TYPE,
  RESULT_VIEW_URI,
  toolMeta,
  VIEW_RESOURCE_DOMAINS,
  insufficientCreditsResult,
  isInsufficientCredits,
  loadView,
} from './lib/app.js';
import { uploadWithCache } from './lib/upload-cache.js';
import { findUnknownInputs } from './lib/validate-inputs.js';
import { checkModelId, checkPredictionId } from './lib/ids.js';
import { IMAGE_MODEL_KEYS, VIDEO_MODEL_KEYS } from './lib/media-models.js';
import { planImage, planVideo, type MediaPlan, type Prop } from './lib/media-plan.js';
import { decodeTaskId, TASKS_EXTENSION, taskCreated, taskState, type TaskRef } from './lib/tasks.js';

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
  const baseUrl = getBaseUrl();
  const client = new Client(apiKey, { baseUrl, clientName: MCP_CLIENT_NAME });
  return uploadWithCache(filePath, callerCacheId(baseUrl, apiKey), (p) => client.upload(p));
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

// The handler context the SDK passes to every tool: progress, cancellation and,
// on a 2026-07-28 request, the client capabilities it declared.
type ToolExtra = {
  mcpReq: {
    signal: AbortSignal;
    _meta?: { progressToken?: string | number };
    // Keyed by the reserved _meta names, e.g. io.modelcontextprotocol/clientCapabilities.
    envelope?: Record<string, any>;
    notify: (n: {
      method: 'notifications/progress';
      params: { progressToken: string | number; progress: number; message?: string };
    }) => Promise<void>;
  };
};

// A client that declared the tasks extension gets a run that is still going
// back as a task: it polls tasks/get itself and is told when the run ends.
function takesTasks(extra: ToolExtra): boolean {
  return extra.mcpReq.envelope?.['io.modelcontextprotocol/clientCapabilities']?.extensions?.[TASKS_EXTENSION] !== undefined;
}

// Emits notifications/progress while polling when the client asked for it.
// Each one carries the prediction id, and clients that reset their timeout
// on progress keep a long wait alive.
function progressTicker(extra: ToolExtra, id: string, startedAt: number) {
  const token = extra.mcpReq._meta?.progressToken;
  if (token === undefined) return undefined;
  let n = 0;
  return async (item: Prediction) => {
    const secs = Math.floor((Date.now() - startedAt) / 1000);
    await extra.mcpReq
      .notify({
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
async function assertKnownInputs(
  model: string,
  input: Record<string, unknown>,
  consequence = 'and still bills the run, so nothing was submitted',
): Promise<void> {
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
      `inputs ${consequence}. Accepted inputs: ` +
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
  const ref: TaskRef = { p: submitted.id, m: model, a: more.always, r: true };
  if (waitSeconds === 0) {
    if (takesTasks(extra)) return taskCreated(ref, submitted.status);
    return ok({ id: submitted.id, status: submitted.status, model, done: false, ...more.always, next: STILL_RUNNING_HINT });
  }
  const { item, done } = await waitForPrediction(submitted.id, {
    intervalMs: POLL_INTERVAL_MS,
    timeoutMs: waitSeconds * 1000,
    onTick: progressTicker(extra, submitted.id, started),
    signal: extra.mcpReq.signal,
  });
  if (!done && takesTasks(extra)) return taskCreated(ref, item.status, item.created_at);
  return runOutcome(item, done, ref, Date.now() - started, more.waited);
}

// A run tool's reply once it has waited: the result, or an error naming the
// task when the run ended without success. tasks/get completes a task with it.
export function runOutcome(item: Prediction, done: boolean, ref: TaskRef, elapsedMs: number, waited?: Record<string, unknown>) {
  const submitted = { id: ref.p };
  const model = ref.m;
  const more = { always: ref.a, waited };
  const started = Date.now() - elapsedMs;
  if (TERMINAL_FAILURES.includes(item.status)) {
    throw new Error(`Prediction ${item.status}${item.error ? `: ${item.error}` : ''} (task_id: ${submitted.id})`);
  }
  return ok({
    id: submitted.id,
    model,
    status: item.status,
    done,
    outputs: item.outputs ?? [],
    ...(item.error ? { error: item.error } : {}),
    elapsed_ms: Date.now() - started,
    ...more.waited,
    ...more.always,
    ...(done ? {} : { next: STILL_RUNNING_HINT }),
  });
}

export function ok(payload: unknown) {
  const res: { content: { type: 'text'; text: string }[]; structuredContent?: Record<string, unknown> } = {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
  };
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    res.structuredContent = payload as Record<string, unknown>;
  }
  return res;
}

function predictionReport(item: Prediction, id: string, done: boolean) {
  return {
    id: item.id || id,
    model: item.model,
    status: item.status,
    done,
    outputs: item.outputs ?? [],
    error: item.error,
    created_at: item.created_at,
    ...(done ? {} : { next: STILL_RUNNING_HINT }),
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'wavespeed',
      title: 'WaveSpeed',
      version: PKG_VERSION,
      websiteUrl: 'https://wavespeed.ai',
      icons: [
        { src: 'https://wavespeed.ai/favicon.svg', mimeType: 'image/svg+xml', sizes: ['any'] },
        { src: 'https://wavespeed.ai/apple-touch-icon.png', mimeType: 'image/png', sizes: ['192x192'] },
      ],
    },
    {
      capabilities: { extensions: { [TASKS_EXTENSION]: {} } } as any,
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

  // Every tool gets the same three additions: a balance that is too low comes back with the top-up link, the
  // tools that show a result point at the result card, and an argument the tool does not declare is refused (zod
  // objects strip unknown keys by default, so a misspelt name, "inputs" for get_price's "input", ran as if left out
  // and quoted the model with no inputs at all).
  const tool = (
    name: string,
    description: string,
    shape: z.ZodRawShape,
    annotations: ToolAnnotations,
    cb: (args: any, extra: ToolExtra) => Promise<unknown>,
  ) => {
    const accepted = Object.keys(shape).sort().join(', ') || 'none';
    const inputSchema = z.strictObject(shape, {
      error: (iss) => (iss.code === 'unrecognized_keys' ? `Unknown argument for ${name}. It accepts: ${accepted}.` : undefined),
    });
    const meta = toolMeta(name);
    return server.registerTool(
      name,
      { description, inputSchema, annotations, ...(meta ? { _meta: meta } : {}) },
      (async (args: any, extra: ToolExtra) => {
        try {
          return await cb(args, extra);
        } catch (err: any) {
          const message = String(err?.message ?? err);
          if (!isInsufficientCredits(message)) throw err;
          return insufficientCreditsResult(message, args?.model);
        }
      }) as any,
    );
  };

  server.registerResource(
    'result-card',
    RESULT_VIEW_URI,
    {
      title: 'WaveSpeed result card',
      description: 'Shows the images, videos and audio of a WaveSpeed run, and refreshes while it is running.',
      mimeType: APP_MIME_TYPE,
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: APP_MIME_TYPE,
          text: loadView(),
          _meta: {
            ui: { csp: { resourceDomains: VIEW_RESOURCE_DOMAINS, connectDomains: [] }, prefersBorder: true },
            // The same, in the names ChatGPT's own extensions use, for versions that read only those.
            'openai/widgetCSP': { resource_domains: VIEW_RESOURCE_DOMAINS, connect_domains: [] },
            'openai/widgetPrefersBorder': true,
            'openai/widgetDescription': 'Shows the images, videos and audio of a WaveSpeed run and follows it until it finishes.',
          },
        },
      ],
    }),
  );

  tool(
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
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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

  tool(
    'get_model_schema',
    "Get a model's real input schema (required fields, properties, defaults). Call this before run_model so inputs match what the model actually accepts.",
    { model: z.string().describe('Model ID from list_models, e.g. bytedance/seedream-v5.0-pro') },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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

  tool(
    'run_model',
    'Run any WaveSpeed model. input keys come from get_model_schema; unknown keys are rejected before submission. Local files: pass "@./path" in a media field (image, images, video, audio, mask …) — it is uploaded and replaced with hosted URLs (bare paths are NOT uploaded). Returns the prediction id right away (done=false); call get_prediction with that id and wait_seconds until done=true to get the output URLs. The task keeps running on the server. Pass wait_seconds here to wait for a quick model in the same call.',
    {
      model: z.string().describe('Model ID from list_models'),
      input: z
        .record(z.string(), z.unknown())
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
      checkModelId(model);
      const resolved = await resolveLocalFiles(input as Record<string, unknown>, {
        props: (await catalogProps(model).catch(() => null)) ?? undefined,
        upload: async (p) => (await uploadFile(p)).url,
      });
      await assertKnownInputs(model, resolved.input);
      const started = Date.now();
      const submitted = await submitPrediction(model, resolved.input);
      return reportPrediction(submitted, model, wait_seconds, extra, started, { waited: { uploaded_files: resolved.uploaded } });
    },
  );

  // ---- Shortcut verbs: the models the /chat page offers, endpoint and input
  // chosen and checked for the caller (see lib/media-plan.ts). They submit and
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
    const resolved = await resolveLocalFiles(media, { allFields: true, upload: async (p) => (await uploadFile(p)).url });
    return { args: { ...args, ...resolved.input }, uploaded: resolved.uploaded };
  }

  // Every size any /chat image model offers; a size the chosen model does not offer is an error naming the ones it does.
  const IMAGE_RESOLUTIONS = ['0.5k', '1k', '1.5k', '2k', '3k', '4k'] as const;
  const imageShape = {
    prompt: z.string().min(1).describe('Complete visual prompt: subject, composition, style, lighting, mood.'),
    model: z.enum(IMAGE_MODEL_KEYS as [string, ...string[]]).optional().describe('Only when the user names a model; default is the first (Seedream 5.5).'),
    aspect_ratio: z.string().optional().describe('e.g. 1:1, 16:9, 9:16, 4:3, 3:4, 21:9, 9:21. A ratio the model does not offer is an error that lists the ones it does. If omitted: text-to-image is 1:1; with input images it is determined automatically from the input image.'),
    resolution: z
      .enum(IMAGE_RESOLUTIONS)
      .optional()
      .describe('Only when the user asks for a size. A size the model does not offer is an error that lists the ones it does and the models that offer it.'),
    wait_seconds: waitSchema,
    estimate_only: estimateSchema,
  };
  const IMAGE_KEYS = ['images', 'reference_images'];

  tool(
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

  tool(
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
    .describe(`Only when the user names a model (${VIDEO_MODEL_KEYS.join(', ')}). Without it the default (${VIDEO_MODEL_KEYS[0]}) is used; inputs it cannot take are an error naming the models that can (no automatic switch).`);
  // The union of the resolution enums of every /chat video endpoint (live catalog, 2026-11-03);
  // a resolution the chosen endpoint does not offer is an error.
  const VIDEO_RESOLUTIONS = ['480p', '540p', '720p', '768p', '1080p', '4k'] as const;
  const resolutionSchema = z
    .enum(VIDEO_RESOLUTIONS)
    .optional()
    .describe(
      'Only when the user asks for a resolution, or 480p for a cheaper draft; otherwise omit. A resolution the model does not offer is an error that lists the ones it does and the models that offer it. MiniMax H3 defaults to 768p (its equivalent of 720p).',
    );
  const durationSchema = z
    .number()
    .int()
    .optional()
    .describe("Seconds, only when the user asks for a length; omit to use the model default. A length outside the model's range is an error that states the range.");
  const VIDEO_KEYS = ['first_frame', 'last_frame', 'reference_images', 'reference_videos', 'reference_audios', 'video'];

  tool(
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
      aspect_ratio: z
        .string()
        .optional()
        .describe(
          "e.g. 16:9, 9:16, 1:1, 4:3, 3:4, 21:9, 9:21. A ratio the model does not offer is an error that lists the ones it does. If omitted, the model's default ratio is used; with first_frame the video follows that image's shape and this is ignored.",
        ),
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

  tool(
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

  tool(
    'extend_video',
    `Continue an existing video with new footage after its end, with the same models as the WaveSpeed /chat page (Seedance 2.5 Flash included). Turbo models, Flash Turbo too, cannot extend. ${REFS}`,
    {
      prompt: z.string().min(1).describe('What happens next.'),
      video: z.string().describe('The video to continue (URL or "@./path").'),
      last_frame: z.string().optional().describe('Optional image the continuation should end on.'),
      duration: durationSchema.describe("Seconds of new footage; omit to use the model default. A length outside the model's range is an error that states the range."),
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

  tool(
    'get_price',
    'Estimate the cost of a run before executing it (no charge). Provide the same input you would pass to run_model — pricing often depends on inputs like duration or resolution, and a quote made without them can be lower than the real charge.',
    {
      model: z.string().describe('Model ID from list_models'),
      input: z.record(z.string(), z.unknown()).default({}).describe('Inputs the quote should account for'),
    },
    // Not read-only, unlike the remote server's get_price: here "@./path" inputs upload local files
    // (a write to the account's uploads) before the quote.
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ model, input }) => {
      checkModelId(model);
      // Resolve @path markers exactly like run_model: some prices are measured
      // from the file itself, so quoting with the literal "@./a.mp3" string
      // would be wrong. The 24h content-hash cache means the later run reuses
      // this upload.
      const resolved = await resolveLocalFiles(input as Record<string, unknown>, {
        props: (await catalogProps(model).catch(() => null)) ?? undefined,
        upload: async (p) => (await uploadFile(p)).url,
      });
      const priceInput = resolved.input;
      // Same guard as run_model: a key the model does not declare is dropped by the API and the quote ignores it.
      await assertKnownInputs(model, priceInput, 'so the quote would not account for them');
      const data = await fetchPricing(model, priceInput);
      return ok({ ...data, estimate: true, disclaimer: PRICE_DISCLAIMER, playground_url: modelPlaygroundUrl(model) });
    },
  );

  tool('get_balance', 'Show the WaveSpeed account credit balance, with the link to top up.', {}, { readOnlyHint: true, destructiveHint: false, openWorldHint: true }, async () => {
    return ok({ ...(await fetchBalance()), top_up_url: TOP_UP_URL });
  });

  tool(
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
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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

  tool(
    'list_billings',
    'List itemized charges and refunds (billing records). Requires an API key with Billing access.',
    {
      page: z.number().int().min(1).default(1),
      limit: z.number().int().min(1).max(100).default(20).describe('Page size'),
      type: z.enum(['deduct', 'refund']).optional(),
      model: z.string().optional().describe('Filter by model ID as list_models returns it, e.g. bytedance/seedream-v5.0-pro'),
      key: z.string().optional().describe('Filter by the API key uuid that generated the charge'),
      since: z.string().optional().describe('Records after this time (ISO or YYYY-MM-DD)'),
      until: z.string().optional().describe('Records before this time (ISO or YYYY-MM-DD)'),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
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

  tool(
    'get_usage',
    'Usage statistics: spend, request counts, daily series and per-model breakdown. Defaults to the last 7 days. Requires an API key with Billing access.',
    {
      since: z.string().optional().describe('Start (ISO or YYYY-MM-DD); default 7 days ago'),
      until: z.string().optional().describe('End (ISO or YYYY-MM-DD); default now'),
      model: z.string().optional().describe('Filter by model ID as list_models returns it, e.g. bytedance/seedream-v5.0-pro'),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ since, until, model }) => {
      const end = toIso(until, 'until') ?? new Date().toISOString();
      const start = toIso(since, 'since') ?? new Date(Date.parse(end) - 7 * 24 * 60 * 60 * 1000).toISOString();
      return ok(await fetchUsageStats(start, end, model));
    },
  );

  tool(
    'delete_predictions',
    `Delete finished predictions from this account's run history, up to ${MAX_DELETE_IDS} at a time. This is a soft delete: each record stays, with status "deleted" and without its outputs, and list_predictions and get_prediction still return it that way; the output links are revoked (best effort). This tool cannot undo it. Runs that are still going are left alone, and only the key's own organization's records are deleted. Ask the user first, and pass confirm: true only after they agreed to delete these ids.`,
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

  tool(
    'upload_file',
    'Upload a local file to WaveSpeed and get its hosted URL (identical bytes reuse the same upload for 24h). Usually unnecessary — run_model handles "@./path" inputs itself.',
    { path: z.string().describe('Local file path') },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async ({ path: filePath }) => {
      return ok(await uploadFile(filePath));
    },
  );

  tool(
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
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ id: rawId, wait_seconds }, extra) => {
      const id = checkPredictionId(rawId);
      const started = Date.now();
      const { item, done } = await waitForPrediction(id, {
        intervalMs: POLL_INTERVAL_MS,
        timeoutMs: wait_seconds * 1000,
        onTick: wait_seconds > 0 ? progressTicker(extra, id, started) : undefined,
        signal: extra.mcpReq.signal,
      });
      if (!done && takesTasks(extra)) return taskCreated({ p: id }, item.status, item.created_at);
      return ok(predictionReport(item, id, done));
    },
  );

  // The tasks extension: a task id names a prediction, so a poll is one read of it.
  const TaskParams = z.looseObject({ taskId: z.string() });
  const TaskResult = z.looseObject({});
  server.server.setRequestHandler('tasks/get', { params: TaskParams, result: TaskResult }, async ({ taskId }) => {
    const ref = decodeTaskId(taskId);
    if (!ref) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Task not found');
    let item: Prediction;
    try {
      item = await fetchPrediction(ref.p);
    } catch (err: any) {
      // A status read that fails says nothing about the run: still working.
      return taskState(ref, 'working', String(err?.message ?? err));
    }
    if (isPending(item.status)) return taskState(ref, 'working', undefined, item);
    let result: Record<string, unknown>;
    if (ref.r) {
      const created = Date.parse(item.created_at ?? '');
      try {
        result = runOutcome(item, true, ref, Number.isNaN(created) ? 0 : Date.now() - created);
      } catch (err: any) {
        const message = String(err?.message ?? err);
        result = isInsufficientCredits(message)
          ? (insufficientCreditsResult(message, ref.m) as Record<string, unknown>)
          : { content: [{ type: 'text', text: message }], isError: true };
      }
    } else {
      result = ok(predictionReport(item, ref.p, true));
    }
    return taskState(ref, 'completed', undefined, item, { ...result, resultType: 'complete' });
  });
  server.server.setRequestHandler('tasks/cancel', { params: TaskParams, result: TaskResult }, async ({ taskId }) => {
    // Cancellation is cooperative: a submitted run cannot be stopped.
    if (!decodeTaskId(taskId)) throw new ProtocolError(ProtocolErrorCode.InvalidParams, 'Task not found');
    return {};
  });

  return server;
}
