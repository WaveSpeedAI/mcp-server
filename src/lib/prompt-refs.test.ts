import { describe, expect, it } from 'vitest';
import { promptRefs, renameRefs } from './prompt-refs.js';

describe('renameRefs', () => {
  it('uses the model documented syntax: H3 pictures, Seedance @Image, Wan words, Kling @Image1', () => {
    const input = { reference_images: ['https://x/a.png', 'https://x/b.png'], reference_videos: ['https://x/v.mp4'] };
    const prompt = '@image 1 hugs @image2 while following @video 1';
    expect(renameRefs(prompt, input, 'wavespeed-ai/minimax-h3/reference-to-video')).toBe('<Picture 1> hugs <Picture 2> while following <Video 1>');
    expect(renameRefs(prompt, input, 'bytedance/seedance-2.5/text-to-video')).toBe('@Image 1 hugs @Image 2 while following @Video 1');
    expect(renameRefs(prompt, input, 'alibaba/wan-3.0/reference-to-video')).toBe('Image 1 hugs Image 2 while following Video 1');
    expect(
      renameRefs(prompt, { images: input.reference_images, videos: input.reference_videos }, 'kwaivgi/kling-v4.0/reference-to-video'),
    ).toBe('@Image1 hugs @Image2 while following @Video1');
  });

  it('falls back to plain words for models whose docs name nothing', () => {
    const input = { images: ['https://x/a.png'] };
    expect(renameRefs('turn @image 1 into watercolor', input, 'bytedance/seedream-v5.0-pro/edit')).toBe('turn Image 1 into watercolor');
  });

  it('leaves refs the request does not carry as typed', () => {
    expect(renameRefs('like @image 3', { images: ['https://x/a.png'] }, 'bytedance/seedream-v5.0-pro/edit')).toBe('like @image 3');
  });

  it('numbers the edited video, then images, then the frames', () => {
    const refs = promptRefs({ video: 'v', reference_images: ['i1'], image: 'f', last_image: 'l' }, 'wavespeed-ai/minimax-h3/video-edit');
    expect(refs.map((r) => [r.label, r.name])).toEqual([
      ['video1', null],
      ['image1', '<Picture 1>'],
      ['image2', null],
      ['image3', null],
    ]);
  });
});
