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
      style: { type: 'string', enum: ['vivid', 'natural'] },
    },
  });
  const input = async (...a: Parameters<typeof fitInput>) => (await fitInput(...a)).input;

  it('drops fields the model does not take and empty values', async () => {
    expect(await fitInput('m', { prompt: 'a', nope: 1, resolution: '', duration: undefined }, props)).toEqual({ input: { prompt: 'a' }, notes: [] });
  });

  it('snaps numbers to the nearest enum value and clamps to the range, with a note', async () => {
    expect(await fitInput('m', { steps: 10, duration: 99 }, props)).toEqual({
      input: { steps: 8, duration: 15 },
      notes: ['steps 10 is not offered by m; used 8.', 'duration 99 is not offered by m; used 15.'],
    });
    expect(await fitInput('m', { duration: 1 }, props)).toEqual({ input: { duration: 4 }, notes: ['duration 1 is not offered by m; used 4.'] });
    // In range and already an integer: sent as is, no note.
    expect(await fitInput('m', { duration: 6, steps: 8 }, props)).toEqual({ input: { duration: 6, steps: 8 }, notes: [] });
  });

  it('drops any other value outside an enum and says the default is used', async () => {
    expect(await fitInput('m', { style: 'neon' }, props)).toEqual({
      input: {},
      notes: ['style neon is not accepted by m; the model default is used.'],
    });
  });

  it('cuts lists to maxItems and spells out requested defaults', async () => {
    expect(await input('m', { refs: ['a', 'b', 'c'] }, props, ['duration', 'resolution'])).toEqual({
      refs: ['a', 'b'],
      duration: 5,
      resolution: '720p',
    });
  });

  it('adds no note for a default filled in only for display', async () => {
    const odd = catalog({ d: { duration: { type: 'integer', minimum: 4, maximum: 15, default: 20 }, size: { type: 'string', enum: ['a'], default: 'b' } } });
    expect(await fitInput('d', {}, odd, ['duration', 'size'])).toEqual({ input: { duration: 15 }, notes: [] });
  });

  it('fails clearly when the catalog has no schema', async () => {
    await expect(fitInput('zzz', {}, props)).rejects.toThrow('No schema for zzz');
  });

  describe('size tiers', () => {
    const tiers = catalog({
      'bytedance/seedream-v5.0-pro': { resolution: { type: 'string', enum: ['1k', '1.5k', '2k'] } },
      'google/nano-banana-2/text-to-image': { resolution: { type: 'string', enum: ['0.5k', '1k', '2k', '4k'] } },
      v: { resolution: { type: 'string', enum: ['480p', '720p', '768p', '1080p', '4k'] } },
      h3: { resolution: { type: 'string', enum: ['480p', '540p', '768p', '1080p'] } },
      size: { size: { type: 'string', enum: ['1k', '2k'] } },
    });

    it('uses the closest tier the model offers (Seedream 5 Pro tops out at 2k)', async () => {
      expect(await fitInput('bytedance/seedream-v5.0-pro', { resolution: '4k' }, tiers)).toEqual({
        input: { resolution: '2k' },
        notes: ['resolution 4k is not offered by bytedance/seedream-v5.0-pro; used 2k.'],
      });
      expect(await input('bytedance/seedream-v5.0-pro', { resolution: '1.2k' }, tiers)).toEqual({ resolution: '1k' });
      expect(await input('bytedance/seedream-v5.0-pro', { resolution: '0.5k' }, tiers)).toEqual({ resolution: '1k' });
    });

    it('keeps a tier the model offers (Nano Banana 2 has 0.5k)', async () => {
      expect(await fitInput('google/nano-banana-2/text-to-image', { resolution: '0.5k' }, tiers)).toEqual({ input: { resolution: '0.5k' }, notes: [] });
      expect(await input('google/nano-banana-2/text-to-image', { resolution: '1.5k' }, tiers)).toEqual({ resolution: '1k' }); // tie
    });

    it('ranks p and k tiers on one scale and breaks ties toward the lower tier', async () => {
      expect(await input('bytedance/seedream-v5.0-pro', { resolution: '1.25k' }, tiers)).toEqual({ resolution: '1k' }); // 1k vs 1.5k
      expect(await input('v', { resolution: '744p' }, tiers)).toEqual({ resolution: '720p' }); // 720p vs 768p
      expect(await input('v', { resolution: '2k' }, tiers)).toEqual({ resolution: '1080p' });
      expect(await input('h3', { resolution: '720p' }, tiers)).toEqual({ resolution: '768p' });
      expect(await input('h3', { resolution: '4k' }, tiers)).toEqual({ resolution: '1080p' });
    });

    it('treats any enum of tiers as a size, whatever the key', async () => {
      expect(await input('size', { size: '4k' }, tiers)).toEqual({ size: '2k' });
    });
  });

  describe('aspect ratios', () => {
    const ratios = catalog({
      'wavespeed-ai/minimax-h3/text-to-video': { aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21'] } },
      'bytedance/seedance-2.5/text-to-video': { aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'] } },
      'kwaivgi/kling-v4.0/reference-to-video': { aspect_ratio: { type: 'string', enum: ['auto', '16:9', '9:16', '1:1', '21:9'] } },
      tie: { aspect_ratio: { type: 'string', enum: ['2:1', '1:2'] } },
    });

    it('keeps 9:21 on MiniMax H3, which offers it', async () => {
      expect(await fitInput('wavespeed-ai/minimax-h3/text-to-video', { aspect_ratio: '9:21' }, ratios)).toEqual({ input: { aspect_ratio: '9:21' }, notes: [] });
    });

    it('uses the closest ratio elsewhere, with a note', async () => {
      expect(await fitInput('bytedance/seedance-2.5/text-to-video', { aspect_ratio: '9:21' }, ratios)).toEqual({
        input: { aspect_ratio: '9:16' },
        notes: ['aspect_ratio 9:21 is not offered by bytedance/seedance-2.5/text-to-video; used 9:16.'],
      });
      expect(await input('kwaivgi/kling-v4.0/reference-to-video', { aspect_ratio: '3:1' }, ratios)).toEqual({ aspect_ratio: '21:9' });
    });

    it('breaks a tie toward the first ratio in enum order, ignoring non-ratio members', async () => {
      expect(await input('tie', { aspect_ratio: '1:1' }, ratios)).toEqual({ aspect_ratio: '2:1' });
      // 4:3 is exactly as far from 1:1 as from 16:9; Kling lists 16:9 first (auto is not a ratio).
      expect(await input('kwaivgi/kling-v4.0/reference-to-video', { aspect_ratio: '4:3' }, ratios)).toEqual({ aspect_ratio: '16:9' });
    });

    it('treats 4:3 and 3:4 around 1:1 as a tie, whatever the float error', async () => {
      const both = catalog({ a: { aspect_ratio: { type: 'string', enum: ['4:3', '3:4'] } }, b: { aspect_ratio: { type: 'string', enum: ['3:4', '4:3'] } } });
      expect(await input('a', { aspect_ratio: '1:1' }, both)).toEqual({ aspect_ratio: '4:3' });
      expect(await input('b', { aspect_ratio: '1:1' }, both)).toEqual({ aspect_ratio: '3:4' });
    });

    it('drops a value that is not a ratio', async () => {
      expect(await fitInput('bytedance/seedance-2.5/text-to-video', { aspect_ratio: 'auto' }, ratios)).toEqual({
        input: {},
        notes: ['aspect_ratio auto is not accepted by bytedance/seedance-2.5/text-to-video; the model default is used.'],
      });
    });
  });
});

describe('planImage', () => {
  it('uses the default model, text to image, when no image is given', async () => {
    const plan = await planImage({ prompt: 'a cat', aspect_ratio: '4:3' }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.5');
    expect(plan.label).toBe('Seedream 5.5');
    expect(plan.mode).toBe('generate');
    // 4:3 is not in this fake schema's enum: the closest ratio is sent, and the notes say so.
    // 4:3 is as far from 1:1 as from 16:9; 1:1 comes first.
    expect(plan.input).toEqual({ prompt: 'a cat', aspect_ratio: '1:1' });
    expect(plan.notes).toEqual(['aspect_ratio 4:3 is not offered by bytedance/seedream-v5.5; used 1:1.']);
  });

  it('sends any image to the edit endpoint, whichever list it came in', async () => {
    const plan = await planImage({ prompt: 'make @image 1 a watercolor', images: ['https://x/a.png'], reference_images: ['https://x/b.png'] }, IMAGE_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedream-v5.5/edit');
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
  // The fixture's Seedance takes no audio references, so audio still moves to another model.
  'bytedance/seedance-2.5/reference-to-video': video({ reference_images: list(30), reference_videos: list(10) }),
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

  it('fits resolution, ratio and duration to the model and adds each change to the notes', async () => {
    const plan = await planVideo({ prompt: 'p', resolution: '4k', aspect_ratio: '9:21', duration: 40 }, 'generate', VIDEO_CATALOG);
    expect(plan.input).toMatchObject({ resolution: '1080p', aspect_ratio: '9:16', duration: 15 });
    expect(plan.notes).toEqual([
      'resolution 4k is not offered by bytedance/seedance-2.5/text-to-video; used 1080p.',
      'duration 40 is not offered by bytedance/seedance-2.5/text-to-video; used 15.',
      'aspect_ratio 9:21 is not offered by bytedance/seedance-2.5/text-to-video; used 9:16.',
    ]);
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

  it('puts Seedance references on reference to video', async () => {
    const plan = await planVideo({ prompt: 'p', reference_images: ['https://x/a.png'] }, 'generate', VIDEO_CATALOG);
    expect(plan.modelId).toBe('bytedance/seedance-2.5/reference-to-video');
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
    expect(plan.modelId).toBe('bytedance/seedance-2.5/reference-to-video');
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
