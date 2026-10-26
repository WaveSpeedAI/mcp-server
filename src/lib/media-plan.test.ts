import { describe, expect, it } from 'vitest';
import { fitInput, planImage, planVideo, type Prop, type PropsOf } from './media-plan.js';

const str: Prop = { type: 'string' };
const list = (maxItems?: number): Prop => ({ type: 'array', maxItems });
const nums = (values: number[]): Prop => ({ type: 'integer', enum: values });

// A fake catalog: endpoint -> input properties.
const catalog = (schemas: Record<string, Record<string, Prop>>): PropsOf => async (id) => schemas[id] ?? null;

const IMAGE_CATALOG = catalog({
  'bytedance/seedream-v5.0-pro': { prompt: str, aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] }, resolution: { type: 'string', enum: ['1k', '2k'] } },
  'bytedance/seedream-v5.0-pro/edit': { prompt: str, images: list(10), aspect_ratio: str, resolution: str },
  'google/nano-banana-2.1/text-to-image': { prompt: str },
});

describe('fitInput', () => {
  const props = catalog({
    m: {
      prompt: str,
      duration: { type: 'integer', minimum: 4, maximum: 15, default: 5 },
      resolution: { type: 'string', enum: ['720p', '1080p'], default: '720p' },
      steps: nums([4, 8, 16]),
      refs: list(2),
    },
  });

  it('drops fields the model does not take and empty values', async () => {
    expect(await fitInput('m', { prompt: 'a', nope: 1, resolution: '', duration: undefined }, props)).toEqual({ prompt: 'a' });
  });

  it('snaps numbers to the nearest enum value and clamps to the range', async () => {
    expect(await fitInput('m', { steps: 10, duration: 99 }, props)).toEqual({ steps: 8, duration: 15 });
    expect(await fitInput('m', { duration: 1 }, props)).toEqual({ duration: 4 });
  });

  it('drops a value outside a string enum', async () => {
    expect(await fitInput('m', { resolution: '4k' }, props)).toEqual({});
  });

  it('cuts lists to maxItems and spells out requested defaults', async () => {
    expect(await fitInput('m', { refs: ['a', 'b', 'c'] }, props, ['duration', 'resolution'])).toEqual({
      refs: ['a', 'b'],
      duration: 5,
      resolution: '720p',
    });
  });

  it('fails clearly when the catalog has no schema', async () => {
    await expect(fitInput('zzz', {}, props)).rejects.toThrow('No schema for zzz');
  });
});

describe('planImage', () => {
  it('uses the default model, text to image, when no image is given', async () => {
    const plan = await planImage({ prompt: 'a cat', aspect_ratio: '4:3' }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.0-pro');
    expect(plan.label).toBe('Seedream 5 Pro');
    expect(plan.mode).toBe('generate');
    // 4:3 is not in this fake schema's enum: dropped rather than sent wrong.
    expect(plan.input).toEqual({ prompt: 'a cat' });
  });

  it('sends any image to the edit endpoint, whichever list it came in', async () => {
    const plan = await planImage({ prompt: 'make @image 1 a watercolor', images: ['https://x/a.png'], reference_images: ['https://x/b.png'] }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.0-pro/edit');
    expect(plan.mode).toBe('edit');
    expect(plan.input.images).toEqual(['https://x/a.png', 'https://x/b.png']);
    expect(plan.input.prompt).toBe('make Image 1 a watercolor');
  });

  it('takes a named model and says when images were cut', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://x/${i}.png`);
    const plan = await planImage({ prompt: 'p', images: many }, IMAGE_CATALOG);
    expect(plan.input.images).toHaveLength(10);
    expect(plan.notes[0]).toContain('at most 10 images');
    const named = await planImage({ prompt: 'p', model: 'nano-banana-2.1' }, IMAGE_CATALOG);
    expect(named.modelId).toBe('google/nano-banana-2.1/text-to-image');
  });

  it('rejects a model that is not on the /chat list', async () => {
    await expect(planImage({ prompt: 'p', model: 'flux' }, IMAGE_CATALOG)).rejects.toThrow('Unknown image model');
  });
});

const video = (extra: Record<string, Prop> = {}): Record<string, Prop> => ({
  prompt: str,
  duration: { type: 'integer', minimum: 4, maximum: 15, default: 5 },
  resolution: { type: 'string', enum: ['480p', '720p', '768p', '1080p'], default: '720p' },
  aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
  ...extra,
});

const VIDEO_CATALOG = catalog({
  'bytedance/seedance-2.5/text-to-video': video({ reference_images: list(30), reference_videos: list(10) }),
  'bytedance/seedance-2.5/image-to-video': video({ image: str, last_image: str }),
  'bytedance/seedance-2.5/video-edit': video({ video: str, reference_images: list(30) }),
  'bytedance/seedance-2.5/video-extend': video({ video: str, last_image: str }),
  'bytedance/seedance-2.5/text-to-video-turbo': video(),
  'wavespeed-ai/minimax-h3/text-to-video': video(),
  'wavespeed-ai/minimax-h3/reference-to-video': video({ reference_images: list(9), reference_videos: list(3), reference_audios: list(3) }),
  'kwaivgi/kling-v4.0/text-to-video': video(),
  'kwaivgi/kling-v4.0/reference-to-video': video({ images: list(10), videos: list(5), audios: list(3) }),
  'alibaba/wan-3.0/text-to-video': video(),
  'alibaba/wan-3.0/reference-to-video': video({ reference_images: list(10), reference_videos: list(5), reference_audios: list(5) }),
});

describe('planVideo', () => {
  it('is text to video on the default model, with its defaults spelled out', async () => {
    const plan = await planVideo({ prompt: 'a fox runs' }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/text-to-video');
    expect(plan.mode).toBe('text to video');
    expect(plan.input).toEqual({ prompt: 'a fox runs', duration: 5, resolution: '720p', aspect_ratio: '16:9' });
    expect(plan.notes).toEqual([]);
  });

  it('animates a first frame and leaves aspect_ratio to the frame', async () => {
    const plan = await planVideo({ prompt: 'go', first_frame: 'https://x/f.png', aspect_ratio: '9:16' }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/image-to-video');
    expect(plan.input.image).toBe('https://x/f.png');
    expect(plan.input).not.toHaveProperty('aspect_ratio');
  });

  it('sends references to the dedicated endpoint where one exists, with the model syntax and field names', async () => {
    const h3 = await planVideo({ prompt: '@image 1 waves', model: 'minimax-h3', reference_images: ['https://x/a.png'] }, 'generate', VIDEO_CATALOG);
    expect(h3.modelId).toBe('wavespeed-ai/minimax-h3/reference-to-video');
    expect(h3.input.prompt).toBe('<Picture 1> waves');
    expect(h3.input.resolution).toBe('768p'); // H3's native tier stands in for 720p
    const kling = await planVideo({ prompt: 'p', model: 'kling-4.0', reference_images: ['https://x/a.png'] }, 'generate', VIDEO_CATALOG);
    expect(kling.modelId).toBe('kwaivgi/kling-v4.0/reference-to-video');
    expect(kling.input.images).toEqual(['https://x/a.png']);
    expect(kling.input).not.toHaveProperty('reference_images');
  });

  it('puts Seedance references on text to video, which takes them', async () => {
    const plan = await planVideo({ prompt: 'p', reference_images: ['https://x/a.png'] }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/text-to-video');
    expect(plan.input.reference_images).toEqual(['https://x/a.png']);
  });

  it('moves to another model when the default cannot take the inputs, and says so', async () => {
    const plan = await planVideo({ prompt: 'p', reference_audios: ['https://x/a.mp3'] }, 'generate', VIDEO_CATALOG);
    // The first model in the /chat order that takes audio references.
    expect(plan.modelId).toBe('alibaba/wan-3.0/reference-to-video');
    expect(plan.notes[0]).toContain('Wan 3.0 reference to video');
  });

  it('does not switch a named model: it leaves out what the model cannot take and names who can', async () => {
    const plan = await planVideo({ prompt: 'p', model: 'seedance-2.5', reference_audios: ['https://x/a.mp3'] }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/text-to-video');
    expect(plan.input).not.toHaveProperty('reference_audios');
    expect(plan.notes[0]).toContain('does not take reference_audios');
    expect(plan.notes[0]).toContain('minimax-h3 (reference to video)');
  });

  it('edits and extends through the edit and extend endpoints', async () => {
    const edit = await planVideo({ prompt: 'p', video: 'https://x/v.mp4', reference_images: ['https://x/a.png'] }, 'edit', VIDEO_CATALOG);
    expect(edit.modelId).toBe('bytedance/seedance-2.5/video-edit');
    expect(edit.input.video).toBe('https://x/v.mp4');
    const extend = await planVideo({ prompt: 'p', video: 'https://x/v.mp4', last_frame: 'https://x/e.png', duration: 6 }, 'extend', VIDEO_CATALOG);
    expect(extend.modelId).toBe('bytedance/seedance-2.5/video-extend');
    expect(extend.input).toMatchObject({ video: 'https://x/v.mp4', last_image: 'https://x/e.png', duration: 6 });
  });

  it('cannot extend on a turbo model', async () => {
    await expect(planVideo({ prompt: 'p', model: 'seedance-2.5-turbo', video: 'https://x/v.mp4' }, 'extend', VIDEO_CATALOG)).rejects.toThrow('cannot extend');
  });

  it('rejects a model that is not on the /chat list', async () => {
    await expect(planVideo({ prompt: 'p', model: 'veo' }, 'generate', VIDEO_CATALOG)).rejects.toThrow('Unknown video model');
  });
});
