// Turn a generate/edit request into the endpoint and input to submit: the
// model choice, the endpoint for the inputs given, and the input checked against
// that endpoint's live schema. A port of /chat's runImage and proposeVideo
// (api-dashboard lib/chat/server.ts) without the chat session around them, so
// the same words give the same model, endpoint and input on both.

import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  IMAGE_MODEL_KEYS,
  VIDEO_MODELS,
  VIDEO_MODEL_KEYS,
  referenceFields,
  videoEndpoints,
  type ImageModelKey,
  type VideoModelKey,
} from './media-models.js';
import { renameRefs } from './prompt-refs.js';

/** The part of an input schema property that fitting reads. */
export interface Prop {
  type?: string;
  enum?: unknown[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxItems?: number;
}

/** The input properties of an endpoint, or null when it has no schema in the catalog. */
export type PropsOf = (modelId: string) => Promise<Record<string, Prop> | null>;

export interface MediaPlan {
  /** The endpoint to run, e.g. bytedance/seedream-v5.0-pro/edit. */
  modelId: string;
  /** The model's name as /chat shows it, e.g. Seedream 5 Pro. */
  label: string;
  mode: string;
  input: Record<string, unknown>;
  /** Kept for the callers' shape; nothing is changed to fit a request any more, so it is empty. */
  notes: string[];
}

export interface FittedInput {
  input: Record<string, unknown>;
  /** Kept for the callers' shape; fitting no longer changes a value, so it is empty. */
  notes: string[];
}

/** Why `value` cannot be sent as `key` to `modelId`, or undefined when the schema takes it as it is. */
export function rejection(modelId: string, key: string, prop: Prop | undefined, value: unknown): string | undefined {
  if (!prop) return `${modelId} does not take ${key}.`;
  if (Array.isArray(value)) {
    return prop.maxItems && value.length > prop.maxItems
      ? `${modelId} takes at most ${prop.maxItems} ${key}; ${value.length} were given.`
      : undefined;
  }
  if (prop.enum?.length) {
    return prop.enum.includes(value)
      ? undefined
      : `${key} ${String(value)} is not offered by ${modelId}; it takes ${prop.enum.map(String).join(', ')}.`;
  }
  if (typeof value === 'number' && (prop.type === 'integer' || prop.type === 'number')) {
    if (prop.type === 'integer' && !Number.isInteger(value)) return `${key} must be a whole number for ${modelId}; ${value} was given.`;
    const low = typeof prop.minimum === 'number' && value < prop.minimum;
    const high = typeof prop.maximum === 'number' && value > prop.maximum;
    if (low || high) return `${key} ${value} is outside what ${modelId} takes (${prop.minimum ?? '-'} to ${prop.maximum ?? '-'}).`;
  }
  return undefined;
}

/** A value the model does not take: the request is refused, naming what it takes (and, from the planners, who does). */
export class InputRejected extends Error {
  constructor(
    message: string,
    readonly key: string,
    readonly value: unknown,
  ) {
    super(message);
    this.name = 'InputRejected';
  }
}

const isEmpty = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Check every value against the endpoint's live schema and send it as given. The rule is shared with the remote MCP
 * (api-server) and the dashboard /chat (owner, 2026-11-27): a value the model does not offer (a tier, a ratio, a number
 * out of range, more items than it takes, a field it has no input for) is an error naming what it takes. Nothing is
 * moved to a nearby value and nothing is left out.
 */
export async function fitInput(
  modelId: string,
  wanted: Record<string, unknown>,
  propsOf: PropsOf,
  showDefaults: string[] = [],
): Promise<FittedInput> {
  const properties = await propsOf(modelId);
  if (!properties) throw new Error(`No schema for ${modelId} in the model catalog.`);
  const input: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(wanted)) {
    if (isEmpty(value)) continue;
    const why = rejection(modelId, key, properties[key], value);
    if (why) throw new InputRejected(why, key, value);
    input[key] = value;
  }
  // Spell out the defaults that set the price, so the estimate shows them.
  for (const key of showDefaults) {
    if (input[key] === undefined && properties[key]?.default !== undefined) input[key] = properties[key].default;
  }
  return { input, notes: [] };
}

/** The /chat models whose endpoint (one per model, from `endpointOf`) takes `value` as `key`. */
async function whoAccepts(
  keys: readonly string[],
  endpointOf: (key: string) => string | undefined,
  key: string,
  value: unknown,
  propsOf: PropsOf,
): Promise<string> {
  const takers: string[] = [];
  for (const k of keys) {
    const id = endpointOf(k);
    if (!id) continue;
    const props = await propsOf(id).catch(() => null);
    if (props && !rejection(id, key, props[key], value)) takers.push(k);
  }
  return takers.length ? `Models that take it: ${takers.join(', ')}.` : 'No /chat model takes it.';
}

/** fitInput, with the models that would take a refused value added to the error. */
async function fitOrExplain(
  modelId: string,
  wanted: Record<string, unknown>,
  propsOf: PropsOf,
  showDefaults: string[],
  keys: readonly string[],
  endpointOf: (key: string) => string | undefined,
): Promise<FittedInput> {
  try {
    return await fitInput(modelId, wanted, propsOf, showDefaults);
  } catch (e) {
    if (!(e instanceof InputRejected)) throw e;
    throw new InputRejected(`${e.message} ${await whoAccepts(keys, endpointOf, e.key, e.value, propsOf)}`, e.key, e.value);
  }
}

// ---------------------------------------------------------------- images

export interface ImageArgs {
  prompt: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  /** Images to edit, combine or use as references; any image sends the request to the model's edit endpoint. */
  images?: string[];
  reference_images?: string[];
}

function imageModelKey(named?: string): ImageModelKey {
  if (named === undefined || named === '') return DEFAULT_IMAGE_MODEL;
  if ((IMAGE_MODEL_KEYS as string[]).includes(named)) return named as ImageModelKey;
  throw new Error(`Unknown image model "${named}". Choose one of: ${IMAGE_MODEL_KEYS.join(', ')}.`);
}

/** Images go to the model's edit endpoint whenever any image is given, and to text-to-image otherwise. */
export async function planImage(args: ImageArgs, propsOf: PropsOf): Promise<MediaPlan> {
  const model = IMAGE_MODELS[imageModelKey(args.model)];
  const images = [...(args.images ?? []), ...(args.reference_images ?? [])];
  const edit = images.length > 0;
  const modelId = edit ? model.edit : model.generate;
  const wanted: Record<string, unknown> = { prompt: args.prompt, aspect_ratio: args.aspect_ratio, resolution: args.resolution };
  if (edit) wanted.images = images;
  const endpointOf = (k: string) => (edit ? IMAGE_MODELS[k as ImageModelKey].edit : IMAGE_MODELS[k as ImageModelKey].generate);
  const { input } = await fitOrExplain(modelId, wanted, propsOf, [], IMAGE_MODEL_KEYS, endpointOf);
  if (typeof input.prompt === 'string') input.prompt = renameRefs(input.prompt, input, modelId);
  return { modelId, label: model.label, mode: edit ? 'edit' : 'generate', input, notes: [] };
}

// ---------------------------------------------------------------- videos

export type VideoAction = 'generate' | 'edit' | 'extend';

export interface VideoArgs {
  prompt: string;
  model?: string;
  first_frame?: string;
  last_frame?: string;
  reference_images?: string[];
  reference_videos?: string[];
  reference_audios?: string[];
  /** The video to edit or extend. */
  video?: string;
  duration?: number;
  resolution?: string;
  aspect_ratio?: string;
}

const MODE_LABEL = { text: 'text to video', image: 'image to video', reference: 'reference to video', edit: 'video edit', extend: 'video extend' } as const;
type Mode = keyof typeof MODE_LABEL;

// Reference media goes under reference_* on most models and under images, videos, audios on Kling 4.0 (referenceFields).
const OPTIONAL_INPUTS = ['reference_images', 'reference_videos', 'reference_audios', 'images', 'videos', 'audios', 'last_image'] as const;

function videoModelKey(named?: string): VideoModelKey {
  if (named === undefined || named === '') return DEFAULT_VIDEO_MODEL;
  if ((VIDEO_MODEL_KEYS as string[]).includes(named)) return named as VideoModelKey;
  throw new Error(`Unknown video model "${named}". Choose one of: ${VIDEO_MODEL_KEYS.join(', ')}.`);
}

/** Which /chat video model + mode takes every one of these inputs, read from their schemas. */
async function whoTakes(fields: string[], modes: readonly Mode[], propsOf: PropsOf): Promise<string> {
  const options: string[] = [];
  for (const key of VIDEO_MODEL_KEYS) {
    const e = videoEndpoints(VIDEO_MODELS[key]);
    for (const mode of modes) {
      const id = e[mode];
      if (!id) continue;
      const props = await propsOf(id).catch(() => null);
      if (props && fields.every((f) => props[f])) options.push(`${key} (${MODE_LABEL[mode]})`);
    }
  }
  return options.length ? `Models that take them: ${options.join('; ')}.` : 'No /chat video model takes them.';
}

/**
 * Pick the endpoint for a video on the named model, or on the default one when none is named: an exact first frame goes
 * to image to video, references to a dedicated reference-to-video endpoint and then to text to video with the
 * references. The request never moves to another model and a first frame never becomes a reference (owner,
 * 2026-11-27): what the model cannot take is an error that names the models that can.
 */
export async function planVideo(args: VideoArgs, action: VideoAction, propsOf: PropsOf): Promise<MediaPlan> {
  const firstFrame = action === 'generate' ? args.first_frame : undefined;
  const lastFrame = action !== 'edit' ? args.last_frame : undefined;
  const video = action !== 'generate' ? args.video : undefined;
  const refImages = args.reference_images?.length ? args.reference_images : undefined;
  const refVideos = action === 'generate' && args.reference_videos?.length ? args.reference_videos : undefined;
  const refAudios = args.reference_audios?.length ? args.reference_audios : undefined;

  const key = videoModelKey(args.model);
  const model = VIDEO_MODELS[key];
  // H3's native 768p tier is the counterpart of other models' 720p default.
  const resolution = key === 'minimax-h3' && (args.resolution == null || args.resolution === '' || args.resolution === '720p') ? '768p' : args.resolution;
  const base = { prompt: args.prompt, resolution };
  const names = referenceFields(model);
  const refs = { [names.images]: refImages, [names.videos]: refVideos, [names.audios]: refAudios };

  interface Candidate {
    mode: Mode;
    wanted: Record<string, unknown>;
  }
  let candidates: Candidate[];
  if (action === 'edit') {
    candidates = [{ mode: 'edit', wanted: { ...base, video, [names.images]: refImages, [names.audios]: refAudios } }];
  } else if (action === 'extend') {
    candidates = [{ mode: 'extend', wanted: { ...base, video, duration: args.duration, last_image: lastFrame } }];
  } else if (firstFrame) {
    candidates = [{ mode: 'image', wanted: { ...base, duration: args.duration, image: firstFrame, last_image: lastFrame, ...refs } }];
  } else if (refImages || refVideos || refAudios) {
    const withRefs = { ...base, duration: args.duration, aspect_ratio: args.aspect_ratio, ...refs };
    candidates = [
      { mode: 'reference', wanted: withRefs },
      { mode: 'text', wanted: withRefs },
    ];
  } else {
    candidates = [{ mode: 'text', wanted: { ...base, duration: args.duration, aspect_ratio: args.aspect_ratio } }];
  }
  const endpoints = videoEndpoints(model);
  const modes = candidates.map((c) => c.mode);
  const usable = candidates.filter((c) => endpoints[c.mode]);
  if (!usable.length) {
    const what = action === 'generate' ? (firstFrame ? 'animate a first frame' : 'generate videos') : `${action} videos`;
    throw new Error(`${model.label} cannot ${what}. ${await whoTakes(firstFrame ? ['image'] : [], modes, propsOf)}`);
  }

  const needed = (c: Candidate) => OPTIONAL_INPUTS.filter((k) => !isEmpty(c.wanted[k]));
  let chosen: Candidate | undefined;
  for (const c of usable) {
    const props = await propsOf(endpoints[c.mode]!);
    if (!props) throw new Error(`No schema for ${endpoints[c.mode]} in the model catalog.`);
    if (needed(c).every((k) => props[k])) {
      chosen = c;
      break;
    }
  }
  if (!chosen) {
    const missing = needed(usable[0]);
    throw new Error(`${model.label} does not take ${missing.join(', ')} for ${MODE_LABEL[usable[0].mode]}. ${await whoTakes(missing, modes, propsOf)}`);
  }

  const mode = chosen.mode;
  const modelId = endpoints[mode]!;
  // Image-to-video follows the first frame's shape: no aspect_ratio, not even the schema default.
  const endpointOf = (k: string) => videoEndpoints(VIDEO_MODELS[k as VideoModelKey])[mode];
  const { input } = await fitOrExplain(modelId, chosen.wanted, propsOf, mode === 'image' ? ['duration', 'resolution'] : ['duration', 'resolution', 'aspect_ratio'], VIDEO_MODEL_KEYS, endpointOf);
  if (mode === 'image') delete input.aspect_ratio;
  if (typeof input.prompt === 'string') input.prompt = renameRefs(input.prompt, input, modelId);
  return { modelId, label: model.label, mode: MODE_LABEL[mode], input, notes: [] };
}
