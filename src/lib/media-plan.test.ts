import { describe, expect, it } from 'vitest';
import { fitInput, planImage, planVideo, type Prop, type PropsOf } from './media-plan.js';

const str: Prop = { type: 'string' };
const list = (maxItems?: number): Prop => ({ type: 'array', maxItems });
const nums = (values: number[]): Prop => ({ type: 'integer', enum: values });

// A fake catalog: endpoint -> input properties.
const catalog = (schemas: Record<string, Record<string, Prop>>): PropsOf => async (id) => schemas[id] ?? null;

const IMAGE_CATALOG = catalog({
  'bytedance/seedream-v5.5': { prompt: str, aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] }, resolution: { type: 'string', enum: ['1k', '2k'] } },
  'bytedance/seedream-v5.5/edit': { prompt: str, images: list(10), aspect_ratio: str, resolution: str },
  'bytedance/seedream-v5.0-pro': { prompt: str, aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16'] }, resolution: { type: 'string', enum: ['1k', '2k'] } },
  'bytedance/seedream-v5.0-pro/edit': { prompt: str, images: list(10), aspect_ratio: str, resolution: str },
  'google/nano-banana-2.1/text-to-image': { prompt: str, resolution: { type: 'string', enum: ['1k', '2k', '4k'] } },
});

describe('fitInput', () => {
  const props = catalog({
    m: {
      prompt: str,
      duration: { type: 'integer', minimum: 4, maximum: 15, default: 5 },
      resolution: { type: 'string', enum: ['720p', '1080p'], default: '720p' },
      steps: nums([4, 8, 16]),
      refs: list(2),
      style: { type: 'string', enum: ['vivid', 'natural'] },
    },
  });

  it('sends what the schema takes as it is, skips empty values and spells out requested defaults', async () => {
    expect(await fitInput('m', { prompt: 'a', resolution: '', duration: undefined, refs: [] }, props)).toEqual({ input: { prompt: 'a' }, notes: [] });
    expect(await fitInput('m', { duration: 6, steps: 8, refs: ['a', 'b'] }, props, ['duration', 'resolution'])).toEqual({
      input: { duration: 6, steps: 8, refs: ['a', 'b'], resolution: '720p' },
      notes: [],
    });
  });

  it('refuses a value outside an enum and lists the ones the model takes', async () => {
    await expect(fitInput('m', { resolution: '4k' }, props)).rejects.toThrow('resolution 4k is not offered by m; it takes 720p, 1080p.');
    await expect(fitInput('m', { style: 'neon' }, props)).rejects.toThrow('style neon is not offered by m; it takes vivid, natural.');
    await expect(fitInput('m', { steps: 10 }, props)).rejects.toThrow('steps 10 is not offered by m; it takes 4, 8, 16.');
  });

  it('refuses a number outside the range or not whole, more items than allowed, and a field the model has no input for', async () => {
    await expect(fitInput('m', { duration: 40 }, props)).rejects.toThrow('duration 40 is outside what m takes (4 to 15).');
    await expect(fitInput('m', { duration: 1 }, props)).rejects.toThrow('duration 1 is outside what m takes (4 to 15).');
    await expect(fitInput('m', { duration: 5.5 }, props)).rejects.toThrow('duration must be a whole number for m; 5.5 was given.');
    await expect(fitInput('m', { refs: ['a', 'b', 'c'] }, props)).rejects.toThrow('m takes at most 2 refs; 3 were given.');
    await expect(fitInput('m', { nope: 1 }, props)).rejects.toThrow('m does not take nope.');
  });

  it('fails clearly when the catalog has no schema', async () => {
    await expect(fitInput('zzz', {}, props)).rejects.toThrow('No schema for zzz');
  });
});

describe('planImage', () => {
  it('uses the default model, text to image, when no image is given', async () => {
    const plan = await planImage({ prompt: 'a cat', aspect_ratio: '16:9', resolution: '2k' }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.5');
    expect(plan.label).toBe('Seedream 5.5');
    expect(plan.mode).toBe('generate');
    expect(plan.input).toEqual({ prompt: 'a cat', aspect_ratio: '16:9', resolution: '2k' });
    expect(plan.notes).toEqual([]);
  });

  it('refuses a size or ratio the model does not offer and names the models that do', async () => {
    await expect(planImage({ prompt: 'p', resolution: '4k' }, IMAGE_CATALOG)).rejects.toThrow(
      'resolution 4k is not offered by bytedance/seedream-v5.5; it takes 1k, 2k. Models that take it: nano-banana-2.1.',
    );
    await expect(planImage({ prompt: 'p', aspect_ratio: '4:3' }, IMAGE_CATALOG)).rejects.toThrow(
      'aspect_ratio 4:3 is not offered by bytedance/seedream-v5.5; it takes 1:1, 16:9, 9:16. No /chat model takes it.',
    );
  });

  it('sends any image to the edit endpoint, whichever list it came in', async () => {
    const plan = await planImage({ prompt: 'make @image 1 a watercolor', images: ['https://x/a.png'], reference_images: ['https://x/b.png'] }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.5/edit');
    expect(plan.mode).toBe('edit');
    expect(plan.input.images).toEqual(['https://x/a.png', 'https://x/b.png']);
    expect(plan.input.prompt).toBe('make Image 1 a watercolor');
  });

  it('refuses more images than the model takes instead of cutting them, and takes a named model', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://x/${i}.png`);
    await expect(planImage({ prompt: 'p', images: many }, IMAGE_CATALOG)).rejects.toThrow('bytedance/seedream-v5.5/edit takes at most 10 images; 12 were given.');
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

const flash = (extra: Record<string, Prop> = {}, resolutions = ['480p', '720p', '1080p', '4k']): Record<string, Prop> => ({
  ...video(extra),
  duration: { type: 'integer', minimum: 4, maximum: 30, default: 5 },
  resolution: { type: 'string', enum: resolutions, default: '720p' },
});
const flashTurbo = (extra: Record<string, Prop> = {}) => flash(extra, ['720p', '1080p']);
// Seedance 2.5 takes the same duration and resolution schema as Flash (4 to 30 s, 480p to 4k) with a larger reference budget.
const seedance25 = (extra: Record<string, Prop> = {}) => flash(extra);

const VIDEO_CATALOG = catalog({
  // Seedance 2.5 Flash: 480p to 4k (1080p / 4k upscaled), 10 images, 5 videos; the standard tier extends (no end image), a turbo tier at 720p / 1080p does not. (Like the fixture's Seedance it takes no audio
  // references here, so audio still moves to another model; the live schema does take them.)
  'bytedance/seedance-2.5-flash/text-to-video': flash({ reference_images: list(10), reference_videos: list(5) }),
  'bytedance/seedance-2.5-flash/reference-to-video': flash({ reference_images: list(10), reference_videos: list(5) }),
  'bytedance/seedance-2.5-flash/image-to-video': flash({ image: str, last_image: str }),
  'bytedance/seedance-2.5-flash/video-edit': flash({ video: str, reference_images: list(10) }),
  'bytedance/seedance-2.5-flash/video-extend': flash({ video: str }),
  'bytedance/seedance-2.5-flash/text-to-video-turbo': flashTurbo({ reference_images: list(10), reference_videos: list(5) }),
  'bytedance/seedance-2.5-flash/reference-to-video-turbo': flashTurbo({ reference_images: list(10), reference_videos: list(5) }),
  'bytedance/seedance-2.5/text-to-video': seedance25({ reference_images: list(30), reference_videos: list(10) }),
  // The fixture's Seedance takes no audio references, so audio still moves to another model.
  'bytedance/seedance-2.5/reference-to-video': seedance25({ reference_images: list(30), reference_videos: list(10) }),
  'bytedance/seedance-2.5/image-to-video': seedance25({ image: str, last_image: str }),
  'bytedance/seedance-2.5/video-edit': seedance25({ video: str, reference_images: list(30) }),
  'bytedance/seedance-2.5/video-extend': seedance25({ video: str, last_image: str }),
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
    expect(plan.modelId).toBe('alibaba/wan-3.0/text-to-video');
    expect(plan.mode).toBe('text to video');
    expect(plan.input).toEqual({ prompt: 'a fox runs', duration: 5, resolution: '720p', aspect_ratio: '16:9' });
    expect(plan.notes).toEqual([]);
  });

  it('refuses a ratio or duration the model does not take, naming what it takes and who takes it', async () => {
    await expect(planVideo({ model: 'seedance-2.5', prompt: 'p', aspect_ratio: '9:21' }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      'aspect_ratio 9:21 is not offered by bytedance/seedance-2.5/text-to-video; it takes 16:9, 9:16, 1:1. No /chat model takes it.',
    );
    await expect(planVideo({ model: 'seedance-2.5', prompt: 'p', duration: 40 }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      'duration 40 is outside what bytedance/seedance-2.5/text-to-video takes (4 to 30).',
    );
    // The default model is not swapped for one that offers 4k: the error names those models.
    await expect(planVideo({ prompt: 'p', resolution: '4k' }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      /resolution 4k is not offered by alibaba\/wan-3\.0\/text-to-video; it takes 480p, 720p, 768p, 1080p\. Models that take it: .*seedance-2\.5\b/,
    );
  });

  it('animates a first frame and leaves aspect_ratio to the frame', async () => {
    const plan = await planVideo({ model: 'seedance-2.5', prompt: 'go', first_frame: 'https://x/f.png', aspect_ratio: '9:16' }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/image-to-video');
    expect(plan.input.image).toBe('https://x/f.png');
    expect(plan.input).not.toHaveProperty('aspect_ratio');
  });

  it('never turns a first frame into a reference', async () => {
    // Image to video with references it does not take: refused, not moved to reference to video.
    await expect(
      planVideo({ model: 'seedance-2.5', prompt: 'go', first_frame: 'https://x/f.png', reference_images: ['https://x/a.png'] }, 'generate', VIDEO_CATALOG),
    ).rejects.toThrow(
      /Seedance 2\.5 does not take reference_images for image to video\. No \/chat video model takes them\./,
    );
    // A missing schema is said as such.
    await expect(planVideo({ model: 'minimax-h3', prompt: 'go', first_frame: 'https://x/f.png' }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      'No schema for wavespeed-ai/minimax-h3/image-to-video',
    );
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

  it('puts Seedance references on reference to video, up to its own limits', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `https://x/${i}.png`);
    const plan = await planVideo({ model: 'seedance-2.5', prompt: 'p', reference_images: many }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/reference-to-video');
    expect(plan.input.reference_images).toHaveLength(11);
    // Flash takes 10: refused, not trimmed.
    await expect(planVideo({ prompt: 'p', model: 'seedance-2.5-flash', reference_images: many }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      /takes at most 10 reference_images; 11 were given\. Models that take it: .*seedance-2\.5\b/,
    );
  });

  it('keeps every tier Seedance 2.5 offers on it, never on its turbo tier', async () => {
    for (const resolution of ['480p', '720p', '1080p', '4k']) {
      const plan = await planVideo({ model: 'seedance-2.5', prompt: 'p', resolution }, 'generate', VIDEO_CATALOG);
      expect(plan.modelId).toBe('bytedance/seedance-2.5/text-to-video');
      expect(plan.input.resolution).toBe(resolution);
    }
    await expect(planVideo({ prompt: 'p', model: 'seedance-2.5-flash-turbo', resolution: '4k' }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      'resolution 4k is not offered by bytedance/seedance-2.5-flash/text-to-video-turbo; it takes 720p, 1080p.',
    );
  });

  it('keeps Wan 3.0, the default, for audio references, since it takes them', async () => {
    const plan = await planVideo({ prompt: 'p', reference_audios: ['https://x/a.mp3'] }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('alibaba/wan-3.0/reference-to-video');
  });

  it('refuses inputs the model cannot take in any mode and names who can, named or not', async () => {
    await expect(planVideo({ prompt: 'p', model: 'seedance-2.5', reference_audios: ['https://x/a.mp3'] }, 'generate', VIDEO_CATALOG)).rejects.toThrow(
      /Seedance 2\.5 does not take reference_audios for reference to video\. Models that take them: .*minimax-h3 \(reference to video\)/,
    );
  });

  it('edits and extends through the edit and extend endpoints', async () => {
    const edit = await planVideo({ model: 'seedance-2.5', prompt: 'p', video: 'https://x/v.mp4', reference_images: ['https://x/a.png'] }, 'edit', VIDEO_CATALOG);
    expect(edit.modelId).toBe('bytedance/seedance-2.5/video-edit');
    expect(edit.input.video).toBe('https://x/v.mp4');
    const extend = await planVideo({ model: 'seedance-2.5', prompt: 'p', video: 'https://x/v.mp4', duration: 6 }, 'extend', VIDEO_CATALOG);
    expect(extend.modelId).toBe('bytedance/seedance-2.5/video-extend');
    expect(extend.input).toMatchObject({ video: 'https://x/v.mp4', duration: 6 });
    const withEnd = await planVideo({ model: 'seedance-2.5', prompt: 'p', video: 'https://x/v.mp4', last_frame: 'https://x/e.png', duration: 6 }, 'extend', VIDEO_CATALOG);
    expect(withEnd.input).toMatchObject({ video: 'https://x/v.mp4', last_image: 'https://x/e.png', duration: 6 });
  });

  it('cannot extend on a turbo model', async () => {
    await expect(planVideo({ prompt: 'p', model: 'seedance-2.5-turbo', video: 'https://x/v.mp4' }, 'extend', VIDEO_CATALOG)).rejects.toThrow('cannot extend videos');
  });

  it('extends on a named Flash at 4k', async () => {
    const plan = await planVideo({ prompt: 'p', model: 'seedance-2.5-flash', video: 'https://x/v.mp4', resolution: '4k' }, 'extend', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5-flash/video-extend');
    expect(plan.input).toMatchObject({ resolution: '4k' });
  });

  it('rejects a model that is not on the /chat list', async () => {
    await expect(planVideo({ prompt: 'p', model: 'veo' }, 'generate', VIDEO_CATALOG)).rejects.toThrow('Unknown video model');
  });
});
