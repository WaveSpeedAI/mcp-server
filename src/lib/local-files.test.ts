import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { collectLocalFiles, resolveLocalFiles } from './local-files.js';

const onDisk = (...paths: string[]) => (p: string) => paths.includes(p);

describe('collectLocalFiles', () => {
  it('picks up @-prefixed paths', () => {
    expect(collectLocalFiles({ image: '@./cat.png' })).toEqual([
      { path: './cat.png', at: 'image' },
    ]);
  });

  // The core promise after dropping auto-detection: nothing leaves the
  // machine without the explicit @ marker, no matter how file-like it looks.
  it('never picks up bare paths, even existing media files', () => {
    expect(collectLocalFiles({ image: './cat.png', video: '/tmp/a.mp4' })).toEqual([]);
  });

  it('leaves URLs and plain strings alone', () => {
    const input = {
      a: 'https://cdn.example.test/cat.png',
      prompt: 'a photo of cat.png',
      seed: 42,
    };
    expect(collectLocalFiles(input)).toEqual([]);
  });

  it('works in @-form inside prompt fields too', () => {
    expect(collectLocalFiles({ prompt: '@notes.txt' })).toEqual([
      { path: 'notes.txt', at: 'prompt' },
    ]);
  });

  it('walks arrays and nested objects', () => {
    const input = {
      image_urls: ['@a.png', 'https://example.test/b.png', '@c.png'],
      opts: { mask: '@m.webp' },
    };
    expect(collectLocalFiles(input)).toEqual([
      { path: 'a.png', at: 'image_urls.0' },
      { path: 'c.png', at: 'image_urls.2' },
      { path: 'm.webp', at: 'opts.mask' },
    ]);
  });
});

describe('resolveLocalFiles', () => {
  it('replaces @paths with uploaded URLs without mutating the input', async () => {
    const input = { image: '@a.png', mask: '@b.png' };
    const upload = vi.fn(async (p: string) => `https://cdn.test/${path.basename(p)}`);

    const { input: out, uploaded } = await resolveLocalFiles(input, {
      exists: onDisk('a.png', 'b.png'),
      upload,
    });

    expect(out).toEqual({ image: 'https://cdn.test/a.png', mask: 'https://cdn.test/b.png' });
    expect(input).toEqual({ image: '@a.png', mask: '@b.png' });
    expect(uploaded).toBe(2);
  });

  it('uploads a repeated file once', async () => {
    const upload = vi.fn(async () => 'https://cdn.test/a.png');
    const { uploaded } = await resolveLocalFiles(
      { image: '@a.png', reference: '@./a.png' },
      { exists: onDisk('a.png', './a.png'), upload },
    );
    expect(upload).toHaveBeenCalledTimes(1);
    expect(uploaded).toBe(1);
  });

  it('fails loudly when an @ path is missing', async () => {
    await expect(
      resolveLocalFiles({ image: '@nope.png' }, { exists: () => false, upload: async () => 'x' }),
    ).rejects.toThrow(/File not found: nope\.png/);
  });

  it('is a no-op when nothing is marked for upload', async () => {
    const upload = vi.fn();
    const input = { prompt: 'a cat', image: './cat.png' };
    const { input: out, uploaded } = await resolveLocalFiles(input, {
      exists: () => true,
      upload,
    });
    expect(out).toBe(input);
    expect(uploaded).toBe(0);
    expect(upload).not.toHaveBeenCalled();
  });
});
