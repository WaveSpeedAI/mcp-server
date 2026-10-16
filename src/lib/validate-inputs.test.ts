import { describe, expect, it } from 'vitest';
import { findUnknownInputs, requestSchemaAliases, requestSchemaProps } from './validate-inputs.js';
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

const modelWithAliases = (props: Record<string, { 'x-aliases'?: string[] }>): LiveModel =>
  ({
    model_id: 'm',
    name: 'm',
    api_schema: {
      api_schemas: [
        {
          request_schema: {
            type: 'object',
            properties: Object.fromEntries(Object.entries(props).map(([k, v]) => [k, { type: 'string', ...v }])),
          },
        },
      ],
    },
  }) as LiveModel;

describe('x-aliases', () => {
  const renamed = modelWithAliases({ prompt: {}, image: {}, last_image: { 'x-aliases': ['end_image'] } });

  it('accepts a legacy name the schema declares as an alias', () => {
    expect(findUnknownInputs({ prompt: 'x', image: 'a', end_image: 'b' }, renamed)).toBeNull();
  });

  it('still accepts the canonical name', () => {
    expect(findUnknownInputs({ prompt: 'x', last_image: 'b' }, renamed)).toBeNull();
  });

  it('does not list legacy names as accepted inputs', () => {
    const r = findUnknownInputs({ zzz: 1 }, renamed);
    expect(r?.known).toEqual(['prompt', 'image', 'last_image']);
    expect(r?.unknown).toEqual(['zzz']);
  });

  it('rejects a legacy name the model does not declare', () => {
    const plain = modelWithAliases({ prompt: {}, image: {}, last_image: {} });
    expect(findUnknownInputs({ end_image: 'b' }, plain)?.unknown).toEqual(['end_image']);
  });

  it('does not apply one field\'s aliases to another model field', () => {
    const r = findUnknownInputs({ end_image: 'b', image_tail: 'c' }, renamed);
    expect(r?.unknown).toEqual(['image_tail']);
  });

  it('maps every declared alias to its canonical field and ignores malformed declarations', () => {
    const m = modelWithAliases({ a: { 'x-aliases': ['old_a', 'older_a'] }, b: { 'x-aliases': ['b', 7 as unknown as string] } });
    expect([...requestSchemaAliases(m)]).toEqual([
      ['old_a', 'a'],
      ['older_a', 'a'],
    ]);
    expect(requestSchemaAliases(undefined).size).toBe(0);
  });
});

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
