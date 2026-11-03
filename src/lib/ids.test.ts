import { describe, expect, it } from 'vitest';
import { checkModelId, checkPredictionId } from './ids.js';

describe('checkModelId', () => {
  it('takes catalog ids and refuses anything that would change the URL path', () => {
    expect(checkModelId('bytedance/seedream-v5.0-pro')).toBe('bytedance/seedream-v5.0-pro');
    expect(checkModelId('bytedance/seedance-2.5/text-to-video-turbo')).toBe('bytedance/seedance-2.5/text-to-video-turbo');
    for (const bad of ['seedream', '../balance', 'a/../b', 'a/b?x=1', 'a/b/', '/a/b', 'a/b/c/d/e', 'a b/c']) {
      expect(() => checkModelId(bad), bad).toThrow(/Invalid model id/);
    }
  });
});

describe('checkPredictionId', () => {
  it('takes prediction ids (trimmed) and refuses path characters', () => {
    expect(checkPredictionId(' 0b2c9f1e8d7a4c3b9e1f2a3b4c5d6e7f ')).toBe('0b2c9f1e8d7a4c3b9e1f2a3b4c5d6e7f');
    for (const bad of ['', '../balance', 'a/b', 'a?b', 'x'.repeat(129)]) {
      expect(() => checkPredictionId(bad), bad).toThrow(/Invalid prediction id/);
    }
  });
});
