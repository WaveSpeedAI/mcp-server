import { describe, it, expect } from 'vitest';
import { MAX_DELETE_IDS, prepareDelete, summarizeDelete } from './delete-predictions.js';

describe('prepareDelete', () => {
  it('refuses to delete anything until the user has confirmed', () => {
    expect(() => prepareDelete(['p1', 'p2'], false)).toThrow(/confirm: true/);
  });

  it('trims and de-duplicates the ids', () => {
    expect(prepareDelete([' p1 ', 'p2', 'p1'], true)).toEqual(['p1', 'p2']);
  });

  it('rejects ids that are not prediction ids, before anything is sent', () => {
    expect(() => prepareDelete(['../x'], true)).toThrow(/Invalid prediction id/);
    expect(() => prepareDelete([''], true)).toThrow(/Invalid prediction id/);
    expect(() => prepareDelete(['a b'], true)).toThrow(/Invalid prediction id/);
  });

  it('takes 1 to 100 ids', () => {
    expect(() => prepareDelete([], true)).toThrow(/between 1 and 100/);
    const many = Array.from({ length: MAX_DELETE_IDS + 1 }, (_, i) => `p${i}`);
    expect(() => prepareDelete(many, true)).toThrow(/between 1 and 100/);
    expect(prepareDelete(many.slice(0, MAX_DELETE_IDS), true)).toHaveLength(MAX_DELETE_IDS);
  });
});

describe('summarizeDelete', () => {
  it('reports what the API deleted and what it left alone', () => {
    expect(summarizeDelete(['p1', 'p2', 'x'], ['p1', 'p2'])).toMatchObject({ deleted: ['p1', 'p2'], deleted_count: 2, requested: 3, not_deleted: ['x'] });
  });
  it('has no not_deleted when everything went', () => {
    expect(summarizeDelete(['p1'], ['p1'])).not.toHaveProperty('not_deleted');
  });
  it('treats a missing list as nothing deleted', () => {
    expect(summarizeDelete(['p1'], undefined)).toMatchObject({ deleted_count: 0, not_deleted: ['p1'] });
  });
});
