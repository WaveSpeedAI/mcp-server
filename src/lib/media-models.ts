// The image and video models the dedicated generate/edit tools offer: the
// same list, in the same order, as the WaveSpeed /chat page (api-dashboard
// lib/media-models.ts, checked 2026-10-26). The first of each is the default.
// This is a vendored copy: when /chat changes its models, change this file and
// its test (src/lib/media-models.test.ts) with it. Capabilities mirror the
// endpoints' input schemas; the tools still fit every request to the live
// schema, so a stale entry degrades to a trimmed request rather than a wrong one.
// The code is kept in the dashboard's style (no semicolons) so the two files diff cleanly.

// ------------------------------------------------------------------ images

export type ImageModelKey = 'seedream-5-pro' | 'nano-banana-2.1' | 'nano-banana-2' | 'nano-banana-pro' | 'gpt-image-2.5' | 'gpt-image-2'

export type ImageModel = {
  id: ImageModelKey
  label: string
  generate: string
  /** Takes the input / reference images. */
  edit: string
  resolutions: string[]
  aspectRatios: string[]
  maxImages: number
}

const WIDE_RATIOS = ['1:1', '1:2', '2:1', '1:3', '3:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '9:21', '21:9']
const NANO_BANANA_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']
const NANO_BANANA_2_RATIOS = [...NANO_BANANA_RATIOS, '1:4', '4:1', '1:8', '8:1']

const image = (id: ImageModelKey, label: string, base: string, generate: string, resolutions: string[], aspectRatios: string[], maxImages: number): ImageModel => ({
  id, label, generate: `${base}/${generate}`.replace(/\/$/, ''), edit: `${base}/edit`, resolutions, aspectRatios, maxImages,
})

/** In menu order; the first is the default. */
export const IMAGE_MODELS: Record<ImageModelKey, ImageModel> = {
  'seedream-5-pro': image('seedream-5-pro', 'Seedream 5 Pro', 'bytedance/seedream-v5.0-pro', '', ['1k', '1.5k', '2k'], WIDE_RATIOS, 10),
  'nano-banana-2.1': image('nano-banana-2.1', 'Nano Banana 2.1', 'google/nano-banana-2.1', 'text-to-image', ['1k', '2k', '4k'], NANO_BANANA_2_RATIOS, 14),
  'nano-banana-2': image('nano-banana-2', 'Nano Banana 2', 'google/nano-banana-2', 'text-to-image', ['0.5k', '1k', '2k', '4k'], NANO_BANANA_2_RATIOS, 14),
  'nano-banana-pro': image('nano-banana-pro', 'Nano Banana Pro', 'google/nano-banana-pro', 'text-to-image', ['1k', '2k', '4k'], NANO_BANANA_RATIOS, 14),
  'gpt-image-2.5': image('gpt-image-2.5', 'GPT Image 2.5', 'openai/gpt-image-2.5-sunburst', 'text-to-image', ['1k', '2k', '4k'], WIDE_RATIOS, 16),
  'gpt-image-2': image('gpt-image-2', 'GPT Image 2', 'openai/gpt-image-2', 'text-to-image', ['1k', '2k', '4k'], WIDE_RATIOS, 16),
}

export const IMAGE_MODEL_KEYS = Object.keys(IMAGE_MODELS) as ImageModelKey[]
export const DEFAULT_IMAGE_MODEL: ImageModelKey = IMAGE_MODEL_KEYS[0]

export function findImageModel(id: string | undefined): ImageModel {
  return IMAGE_MODELS[id as ImageModelKey] ?? IMAGE_MODELS[DEFAULT_IMAGE_MODEL]
}

// ------------------------------------------------------------------ videos

export type VideoModelKey =
  | 'seedance-2.5'
  | 'seedance-2.5-turbo'
  | 'seedance-2.0'
  | 'seedance-2.0-turbo'
  | 'seedance-2.0-fast'
  | 'seedance-2.0-fast-turbo'
  | 'seedance-2.0-mini'
  | 'wan-3.0'
  | 'wan-3.0-prime'
  | 'kling-4.0'
  | 'minimax-h3'

export type VideoFamily = 'seedance-2.5' | 'seedance-2.0' | 'wan-3.0' | 'kling-4.0' | 'minimax-h3'
export type VideoMode = 'generate' | 'edit' | 'extend'

export type VideoModel = {
  id: VideoModelKey
  label: string
  family: VideoFamily
  /** Endpoint prefix, e.g. bytedance/seedance-2.0-fast. */
  base: string
  turbo: boolean
  modes: VideoMode[]
  resolutions: string[]
  defaultResolution: string
  durations: [number, number]
  aspectRatios: string[]
  /** Whether generate and extend take generate_audio. */
  audio: boolean
  maxRefs: { images: number; videos: number; audios: number }
}

const SEEDANCE_ASPECTS = ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9']
const ALL_RES = ['480p', '720p', '1080p', '4k']
const TURBO_RES = ['720p', '1080p']
const seedance = (id: VideoModelKey, label: string, base: string, turbo: boolean, v25: boolean): VideoModel => ({
  id, label, family: v25 ? 'seedance-2.5' : 'seedance-2.0', base, turbo,
  // Turbo endpoints have no extend.
  modes: turbo ? ['generate', 'edit'] : ['generate', 'edit', 'extend'],
  resolutions: turbo ? TURBO_RES : ALL_RES, defaultResolution: '720p',
  durations: v25 ? [4, 30] : [4, 15], aspectRatios: SEEDANCE_ASPECTS, audio: true,
  maxRefs: v25 ? { images: 30, videos: 10, audios: 10 } : { images: 9, videos: 3, audios: 3 },
})
const wan = (id: VideoModelKey, label: string, base: string): VideoModel => ({
  id, label, family: 'wan-3.0', base, turbo: false, modes: ['generate', 'edit', 'extend'],
  resolutions: ['480p', '720p', '1080p'], defaultResolution: '720p', durations: [2, 30],
  aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1'], audio: true, maxRefs: { images: 10, videos: 5, audios: 5 },
})

/** In menu order; the first is the default. */
export const VIDEO_MODELS: Record<VideoModelKey, VideoModel> = {
  'seedance-2.5': seedance('seedance-2.5', 'Seedance 2.5', 'bytedance/seedance-2.5', false, true),
  'seedance-2.5-turbo': seedance('seedance-2.5-turbo', 'Seedance 2.5 Turbo', 'bytedance/seedance-2.5', true, true),
  'seedance-2.0': seedance('seedance-2.0', 'Seedance 2.0', 'bytedance/seedance-2.0', false, false),
  'seedance-2.0-turbo': seedance('seedance-2.0-turbo', 'Seedance 2.0 Turbo', 'bytedance/seedance-2.0', true, false),
  'seedance-2.0-fast': seedance('seedance-2.0-fast', 'Seedance 2.0 Fast', 'bytedance/seedance-2.0-fast', false, false),
  'seedance-2.0-fast-turbo': seedance('seedance-2.0-fast-turbo', 'Seedance 2.0 Fast Turbo', 'bytedance/seedance-2.0-fast', true, false),
  'seedance-2.0-mini': seedance('seedance-2.0-mini', 'Seedance 2.0 Mini', 'bytedance/seedance-2.0-mini', false, false),
  'wan-3.0': wan('wan-3.0', 'Wan 3.0', 'alibaba/wan-3.0'),
  'wan-3.0-prime': wan('wan-3.0-prime', 'Wan 3.0 Prime', 'alibaba/wan-3.0-prime'),
  'kling-4.0': {
    id: 'kling-4.0', label: 'Kling 4.0', family: 'kling-4.0', base: 'kwaivgi/kling-v4.0', turbo: false, modes: ['generate', 'edit', 'extend'],
    resolutions: ['720p', '1080p'], defaultResolution: '720p', durations: [3, 30],
    // Sound is always generated with the picture; there is no switch.
    aspectRatios: ['16:9', '9:16', '1:1', '21:9'], audio: false, maxRefs: { images: 10, videos: 5, audios: 3 },
  },
  'minimax-h3': {
    id: 'minimax-h3', label: 'MiniMax H3', family: 'minimax-h3', base: 'wavespeed-ai/minimax-h3', turbo: false, modes: ['generate', 'edit', 'extend'],
    resolutions: ['480p', '540p', '768p', '1080p'], defaultResolution: '768p', durations: [3, 15],
    aspectRatios: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9', '9:21'], audio: false, maxRefs: { images: 9, videos: 3, audios: 3 },
  },
}

export const VIDEO_MODEL_KEYS = Object.keys(VIDEO_MODELS) as VideoModelKey[]
export const DEFAULT_VIDEO_MODEL: VideoModelKey = VIDEO_MODEL_KEYS[0]

export function findVideoModel(id: string | undefined): VideoModel {
  return VIDEO_MODELS[id as VideoModelKey] ?? VIDEO_MODELS[DEFAULT_VIDEO_MODEL]
}

/** The model a full endpoint id belongs to, e.g. bytedance/seedance-2.0-fast/image-to-video-turbo. */
export function videoModelForEndpoint(modelId: string): VideoModel | undefined {
  const turbo = modelId.endsWith('-turbo')
  return VIDEO_MODEL_KEYS.map((k) => VIDEO_MODELS[k]).find((m) => m.turbo === turbo && modelId.startsWith(`${m.base}/`))
}

export type VideoEndpoints = { text: string; image: string; reference?: string; edit: string; extend?: string }

/**
 * A model's endpoints. Every family takes references on a dedicated
 * reference-to-video endpoint. Seedance has turbo ones; the others do not.
 * Turbo endpoints have no extend.
 */
export function videoEndpoints(m: VideoModel): VideoEndpoints {
  const suffix = m.turbo ? '-turbo' : ''
  return {
    text: `${m.base}/text-to-video${suffix}`,
    image: `${m.base}/image-to-video${suffix}`,
    reference: `${m.base}/reference-to-video${m.family === 'seedance-2.5' || m.family === 'seedance-2.0' ? suffix : ''}`,
    edit: `${m.base}/video-edit${suffix}`,
    ...(m.modes.includes('extend') ? { extend: `${m.base}/video-extend` } : {}),
  }
}

/** The input names a model takes its reference media under (Kling 4.0 drops the reference_ prefix). */
export function referenceFields(m: VideoModel): { images: string; videos: string; audios: string } {
  return m.family === 'kling-4.0'
    ? { images: 'images', videos: 'videos', audios: 'audios' }
    : { images: 'reference_images', videos: 'reference_videos', audios: 'reference_audios' }
}

/** Image-to-video follows the start image's frame on these families; the others take aspect_ratio. */
export function imageToVideoTakesAspectRatio(m: VideoModel): boolean {
  return m.family === 'seedance-2.0' || m.family === 'wan-3.0'
}
