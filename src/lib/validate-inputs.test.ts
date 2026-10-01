import { describe, expect, it } from 'vitest';
import { findUnknownInputs, requestSchemaProps } from './validate-inputs.js';
import { LiveModel } from './api.js';

const model = (props: string[] | undefined): LiveModel =>
  ({
    model_id: 'm',
    name: 'm',
    api_schema:
      props === undefined
        ? undefined
        : {
            api_schemas: [
              {
                request_schema: {
                  type: 'object',
                  properties: Object.fromEntries(props.map((p) => [p, { type: 'string' }])),
                },
              },
            ],
          },
  }) as LiveModel;

describe('findUnknownInputs', () => {
  it('flags keys the schema does not declare', () => {
    // The real incident: `size` against seedream-v5.0-pro, whose knobs are
    // aspect_ratio/resolution — the API silently dropped it and billed a
    // default-sized generation.
    const r = findUnknownInputs(
      { prompt: 'x', size: '2560*1440' },
      model(['prompt', 'aspect_ratio', 'resolution']),
    );
    expect(r?.unknown).toEqual(['size']);
  });

  it('suggests the closest real key for a typo', () => {
    const r = findUnknownInputs({ aspectratio: '16:9' }, model(['aspect_ratio', 'prompt']));
    expect(r?.suggestions.get('aspectratio')).toBe('aspect_ratio');
  });

  it('offers no suggestion when nothing is plausibly close', () => {
    const r = findUnknownInputs({ zzz: 1 }, model(['prompt', 'seed']));
    expect(r?.unknown).toEqual(['zzz']);
    expect(r?.suggestions.size).toBe(0);
  });

  it('passes when every key is declared', () => {
    expect(findUnknownInputs({ prompt: 'x' }, model(['prompt']))).toBeNull();
  });

  it('fails open with no schema at all', () => {
    expect(findUnknownInputs({ whatever: 1 }, model(undefined))).toBeNull();
    expect(findUnknownInputs({ whatever: 1 }, undefined)).toBeNull();
  });

  it('fails open on an empty properties object', () => {
    expect(requestSchemaProps(model([]))).toBeNull();
  });
});
