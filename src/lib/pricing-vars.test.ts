import { describe, it, expect } from 'vitest';
import { extractPriceVars, missingPriceVars, isFloorQuote } from './pricing-vars.js';

describe('extractPriceVars', () => {
  it('returns [] for a missing formula', () => {
    expect(extractPriceVars(undefined)).toEqual([]);
    expect(extractPriceVars('')).toEqual([]);
  });

  it('returns [] for a flat price', () => {
    expect(extractPriceVars('{"total_price":base_price * 1}')).toEqual([]);
  });

  it('reads a bare multiplier variable', () => {
    expect(extractPriceVars('{"total_price":base_price * num_images}')).toEqual(['num_images']);
    expect(extractPriceVars('{"total_price": duration * base_price}')).toEqual(['duration']);
    expect(extractPriceVars('{"total_price":base_price * (steps / 1000)}')).toEqual(['steps']);
  });

  it('skips JSONata builtins and server-side helper calls', () => {
    // The infinitetalk formula: only `audio` and `resolution` come from inputs.
    const f =
      '{"total_price": $max([5, $min([$ceil(get_duration_v3(audio)), 600])]) / 5 * base_price * (resolution = "720p" ? 2 : 1)}';
    expect(extractPriceVars(f)).toEqual(['audio', 'resolution']);
  });

  it('does not mistake string literals for variables', () => {
    // "720p" and the "total_price" key must not leak in as inputs.
    const f = '{"total_price": base_price * (resolution = "720p" ? 2 : 1)}';
    expect(extractPriceVars(f)).toEqual(['resolution']);
  });

  it('handles $length(text) and multi-media formulas', () => {
    expect(extractPriceVars('{"total_price": base_price * $ceil($length(text) / 1000)}')).toEqual([
      'text',
    ]);
    const multi =
      '{"total_price": $max([5, $min([order = "meanwhile" ? $max([$ceil(get_duration_v3(left_audio)), $ceil(get_duration_v3(right_audio))]) : ($ceil(get_duration_v3(left_audio)) + $ceil(get_duration_v3(right_audio))), 600])]) / 5 * base_price}';
    expect(extractPriceVars(multi)).toEqual(['order', 'left_audio', 'right_audio']);
  });

  it('deduplicates repeated variables in first-seen order', () => {
    expect(extractPriceVars('{"total_price": duration * base_price + duration}')).toEqual([
      'duration',
    ]);
  });
});

describe('missingPriceVars', () => {
  const infinitetalk =
    '{"total_price": $max([5, $min([$ceil(get_duration_v3(audio)), 600])]) / 5 * base_price * (resolution = "720p" ? 2 : 1)}';

  it('reports every driver when nothing was supplied', () => {
    expect(missingPriceVars(infinitetalk, {})).toEqual(['audio', 'resolution']);
  });

  it('reports only the drivers still unset', () => {
    expect(missingPriceVars(infinitetalk, { audio: 'https://x/a.mp3' })).toEqual(['resolution']);
  });

  it('is empty once every driver is supplied', () => {
    expect(missingPriceVars(infinitetalk, { audio: 'https://x/a.mp3', resolution: '720p' })).toEqual(
      [],
    );
  });

  it('treats null and empty string as unsupplied', () => {
    expect(missingPriceVars('{"total_price": base_price * duration}', { duration: null })).toEqual([
      'duration',
    ]);
    expect(missingPriceVars('{"total_price": base_price * duration}', { duration: '' })).toEqual([
      'duration',
    ]);
  });

  it('counts 0 as supplied', () => {
    expect(missingPriceVars('{"total_price": base_price * duration}', { duration: 0 })).toEqual([]);
  });

  it('does not flag an omitted driver that has a schema default', () => {
    // infinitetalk: `resolution` defaults to 480p, so the quote is not blind to
    // it; `audio` has no default and is what actually sinks the estimate.
    const props = { audio: { type: 'string' }, resolution: { default: '480p' } };
    expect(missingPriceVars(infinitetalk, {}, props)).toEqual(['audio']);
  });

  it('still flags a defaulted driver as fine once explicitly supplied', () => {
    const props = { audio: { type: 'string' }, resolution: { default: '480p' } };
    expect(missingPriceVars(infinitetalk, { audio: 'https://x/a.mp3' }, props)).toEqual([]);
  });
});

describe('isFloorQuote', () => {
  const infinitetalk =
    '{"total_price": $max([5, $min([$ceil(get_duration_v3(audio)), 600])]) / 5 * base_price * (resolution = "720p" ? 2 : 1)}';

  it('is true when no driver was supplied — the formula collapses to base_price', () => {
    expect(isFloorQuote(infinitetalk, {})).toBe(true);
  });

  it('is false once any driver is supplied', () => {
    // $1.2 for seedance at duration=10 is a real quote, not the floor.
    expect(isFloorQuote('{"total_price": base_price * duration / 5}', { duration: 10 })).toBe(false);
    expect(isFloorQuote(infinitetalk, { resolution: '720p' })).toBe(false);
  });

  it('is false for a flat-priced model — there is no floor to explain', () => {
    expect(isFloorQuote('{"total_price":base_price * 1}', {})).toBe(false);
    expect(isFloorQuote(undefined, {})).toBe(false);
  });
});
