import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  IMAGE_MODEL_KEYS,
  VIDEO_MODELS,
  VIDEO_MODEL_KEYS,
  videoEndpoints,
} from './media-models.js';

// The same list, in the same order, as the /chat page: a change there is a change here.
describe('media models', () => {
  it('defaults to the first model of each kind, as /chat does', () => {
    expect(DEFAULT_IMAGE_MODEL).toBe('seedream-5-pro');
    expect(DEFAULT_VIDEO_MODEL).toBe('seedance-2.5');
    expect(IMAGE_MODEL_KEYS).toEqual(['seedream-5-pro', 'nano-banana-2.1', 'nano-banana-2', 'nano-banana-pro', 'gpt-image-2.5', 'gpt-image-2']);
    expect(VIDEO_MODEL_KEYS).toHaveLength(11);
  });

  it('names the endpoints each model runs on', () => {
    expect(IMAGE_MODELS['seedream-5-pro'].generate).toBe('bytedance/seedream-v5.0-pro');
    expect(IMAGE_MODELS['seedream-5-pro'].edit).toBe('bytedance/seedream-v5.0-pro/edit');
    expect(IMAGE_MODELS['gpt-image-2.5'].generate).toBe('openai/gpt-image-2.5-sunburst/text-to-image');
    expect(videoEndpoints(VIDEO_MODELS['seedance-2.5-turbo'])).toEqual({
      text: 'bytedance/seedance-2.5/text-to-video-turbo',
      image: 'bytedance/seedance-2.5/image-to-video-turbo',
      reference: 'bytedance/seedance-2.5/reference-to-video-turbo',
      edit: 'bytedance/seedance-2.5/video-edit-turbo',
    });
    expect(videoEndpoints(VIDEO_MODELS['minimax-h3']).reference).toBe('wavespeed-ai/minimax-h3/reference-to-video');
    expect(videoEndpoints(VIDEO_MODELS['seedance-2.0']).reference).toBe('bytedance/seedance-2.0/reference-to-video');
  });
});
