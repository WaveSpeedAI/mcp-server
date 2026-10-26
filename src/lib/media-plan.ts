// Turn a generate/edit request into the endpoint and input to submit: the
// model choice, the endpoint for the inputs given, and the input fitted to
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
  /** What was changed to fit the request; the caller should tell the user. */
  notes: string[];
}

/** Keep only fields the model accepts, snapping values onto its enums and ranges. */
export async function fitInput(
  modelId: string,
  wanted: Record<string, unknown>,
  propsOf: PropsOf,
  showDefaults: string[] = [],
): Promise<Record<string, unknown>> {
  const properties = await propsOf(modelId);
  if (!properties) throw new Error(`No schema for ${modelId} in the model catalog.`);
  const input: Record<string, unknown> = {};
  // Spell out the defaults that set the price, so the estimate shows them.
  for (const key of showDefaults) {
    if (properties[key]?.default !== undefined && (wanted[key] === undefined || wanted[key] === null || wanted[key] === '')) {
      wanted = { ...wanted, [key]: properties[key].default };
    }
  }
  for (const [key, value] of Object.entries(wanted)) {
    const prop = properties[key];
    if (!prop || value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      input[key] = prop.maxItems ? value.slice(0, prop.maxItems) : value;
      continue;
    }
    if (prop.enum?.length) {
      if (prop.enum.includes(value)) input[key] = value;
      else if (typeof value === 'number' && prop.enum.every((v) => typeof v === 'number')) {
        input[key] = (prop.enum as number[]).reduce((a, b) => (Math.abs(b - value) < Math.abs(a - value) ? b : a));
      }
      continue;
    }
    if (typeof value === 'number' && (prop.type === 'integer' || prop.type === 'number')) {
      let v = prop.type === 'integer' ? Math.round(value) : value;
      if (typeof prop.minimum === 'number') v = Math.max(prop.minimum, v);
      if (typeof prop.maximum === 'number') v = Math.min(prop.maximum, v);
      input[key] = v;
      continue;
    }
    input[key] = value;
  }
  return input;
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
  const input = await fitInput(modelId, wanted, propsOf);
  if (typeof input.prompt === 'string') input.prompt = renameRefs(input.prompt, input, modelId);
  const notes: string[] = [];
  if (edit && Array.isArray(input.images) && input.images.length < images.length) {
    notes.push(`${model.label} takes at most ${input.images.length} images, so only the first ${input.images.length} were used.`);
  }
  return { modelId, label: model.label, mode: edit ? 'edit' : 'generate', input, notes };
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

/** Which allowed video model + mode accepts every one of these inputs, read from their schemas. */
async function whoTakes(fields: string[], propsOf: PropsOf): Promise<string> {
  const options: string[] = [];
  for (const key of VIDEO_MODEL_KEYS) {
    const e = videoEndpoints(VIDEO_MODELS[key]);
    for (const [mode, id] of [['text to video', e.text], ['image to video', e.image], ['reference to video', e.reference]] as const) {
      if (!id) continue;
      const props = await propsOf(id).catch(() => null);
      if (props && fields.every((f) => props[f])) options.push(`${key} (${mode})`);
    }
  }
  return options.length ? `Models that take them: ${options.join('; ')}.` : 'No available video model takes them.';
}

/**
 * Pick the model + mode for a video. Candidates are tried in order and the
 * first whose schema takes every input given wins: an exact first frame
 * (image to video), then a dedicated reference-to-video endpoint, then text to
 * video with the references. Other models are tried only when the caller did
 * not name one.
 */
export async function planVideo(args: VideoArgs, action: VideoAction, propsOf: PropsOf): Promise<MediaPlan> {
  const firstFrame = action === 'generate' ? args.first_frame : undefined;
  const lastFrame = action !== 'edit' ? args.last_frame : undefined;
  const video = action !== 'generate' ? args.video : undefined;
  const refImages = args.reference_images?.length ? args.reference_images : undefined;
  const refVideos = action === 'generate' && args.reference_videos?.length ? args.reference_videos : undefined;
  const refAudios = args.reference_audios?.length ? args.reference_audios : undefined;

  const pinned = args.model !== undefined && args.model !== '';
  const first = videoModelKey(args.model);
  const keys = pinned ? [first] : [first, ...VIDEO_MODEL_KEYS.filter((k) => k !== first)];

  interface Candidate { key: VideoModelKey; mode: Mode; wanted: Record<string, unknown>; lost: string[] }
  const candidates: Candidate[] = [];
  for (const key of keys) {
    // H3's native 768p tier is the counterpart of other models' 720p default.
    // Keep explicit supported choices, including cheaper drafts, intact.
    const resolution = key === 'minimax-h3' && (args.resolution == null || args.resolution === '' || args.resolution === '720p') ? '768p' : args.resolution;
    const base = { prompt: args.prompt, resolution };
    const names = referenceFields(VIDEO_MODELS[key]);
    const refs = { [names.images]: refImages, [names.videos]: refVideos, [names.audios]: refAudios };
    if (action === 'edit') {
      candidates.push({ key, mode: 'edit', wanted: { ...base, video, [names.images]: refImages, [names.audios]: refAudios }, lost: [] });
    } else if (action === 'extend') {
      candidates.push({ key, mode: 'extend', wanted: { ...base, video, duration: args.duration, last_image: lastFrame }, lost: [] });
    } else if (firstFrame) {
      candidates.push({ key, mode: 'image', wanted: { ...base, duration: args.duration, image: firstFrame, last_image: lastFrame, ...refs }, lost: [] });
      // No exact first frame: the start image becomes a reference instead.
      const asRef = { ...base, duration: args.duration, aspect_ratio: args.aspect_ratio, ...refs, [names.images]: [firstFrame, ...(refImages ?? [])] };
      const lost = lastFrame ? ['exact first/last frame'] : ['exact first frame'];
      candidates.push({ key, mode: 'reference', wanted: asRef, lost });
      candidates.push({ key, mode: 'text', wanted: asRef, lost });
    } else if (refImages || refVideos || refAudios) {
      const withRefs = { ...base, duration: args.duration, aspect_ratio: args.aspect_ratio, ...refs };
      candidates.push({ key, mode: 'reference', wanted: withRefs, lost: [] });
      candidates.push({ key, mode: 'text', wanted: withRefs, lost: [] });
    } else {
      candidates.push({ key, mode: 'text', wanted: { ...base, duration: args.duration, aspect_ratio: args.aspect_ratio }, lost: [] });
    }
  }
  const endpoints = (key: VideoModelKey) => videoEndpoints(VIDEO_MODELS[key]);
  const usable = candidates.filter((c) => endpoints(c.key)[c.mode]);
  if (!usable.length) {
    // Turbo tiers have no extend endpoint.
    throw new Error(`${VIDEO_MODELS[first].label} cannot ${action} videos. Try another video model, such as ${DEFAULT_VIDEO_MODEL}.`);
  }

  const needed = (c: Candidate) => OPTIONAL_INPUTS.filter((k) => c.wanted[k] !== undefined);
  const takesAll = async (c: Candidate) => {
    const props = await propsOf(endpoints(c.key)[c.mode]!).catch(() => null);
    return !!props && needed(c).every((k) => props[k]);
  };
  let chosen = usable[0];
  for (const c of usable) {
    if (await takesAll(c)) {
      chosen = c;
      break;
    }
  }

  const model = VIDEO_MODELS[chosen.key];
  const modelId = endpoints(chosen.key)[chosen.mode]!;
  // Image-to-video follows the first frame's shape: no aspect_ratio, not even the schema default.
  const input = await fitInput(modelId, chosen.wanted, propsOf, chosen.mode === 'image' ? ['duration', 'resolution'] : ['duration', 'resolution', 'aspect_ratio']);
  if (chosen.mode === 'image') delete input.aspect_ratio;
  if (typeof input.prompt === 'string') input.prompt = renameRefs(input.prompt, input, modelId);
  const dropped = needed(chosen).filter((k) => input[k] === undefined);

  const notes: string[] = [];
  if (chosen.key !== usable[0].key || chosen.lost.length) {
    notes.push(
      `Used ${model.label} ${MODE_LABEL[chosen.mode]} so that ${needed(chosen).join(', ') || 'the inputs'} could be used` +
        (chosen.lost.length ? `; this means no ${chosen.lost.join(', ')}: the start image is used as a visual reference` : '') +
        '.',
    );
  }
  if (dropped.length) {
    notes.push(
      pinned
        ? `${model.label} does not take ${dropped.join(', ')} in any mode, so those were left out; the model you named was not switched. ${await whoTakes(dropped, propsOf)}`
        : `No available video model takes ${dropped.join(', ')} for this request, so those were left out.`,
    );
  }
  return { modelId, label: model.label, mode: MODE_LABEL[chosen.mode], input, notes };
}
