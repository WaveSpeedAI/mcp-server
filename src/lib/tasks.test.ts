import { describe, expect, it } from 'vitest';
import { decodeTaskId, encodeTaskId, taskCreated, taskState } from './tasks.js';

describe('task ids', () => {
  it('carry the prediction and the reply fields', () => {
    const ref = { p: 'abc123', m: 'acme/img', a: { model_label: 'Acme', notes: ['resolution dropped'] }, r: true };
    expect(decodeTaskId(encodeTaskId(ref))).toEqual(ref);
  });

  it('refuse anything else', () => {
    for (const bad of ['', 'abc', 'ws1_!!', 'ws1_' + Buffer.from('{"p":"../x"}').toString('base64url'), 'ws1_' + 'a'.repeat(20000)]) {
      expect(decodeTaskId(bad)).toBeNull();
    }
  });
});

describe('task results', () => {
  it('hand the client a working task that names the prediction', () => {
    const t = taskCreated({ p: 'abc123', m: 'acme/img', r: true }, 'created');
    expect(t).toMatchObject({ resultType: 'task', status: 'working', ttlMs: 604800000, pollIntervalMs: 3000 });
    expect(t.statusMessage).toContain('abc123');
    expect(decodeTaskId(t.taskId)?.p).toBe('abc123');
    expect(Number.isNaN(Date.parse(t.createdAt))).toBe(false);
  });

  it('complete with the result', () => {
    const s = taskState({ p: 'abc123' }, 'completed', undefined, { id: 'abc123', status: 'completed', created_at: '2026-11-20T10:00:00Z' } as any, {
      content: [],
      resultType: 'complete',
    });
    expect(s).toMatchObject({ status: 'completed', createdAt: '2026-11-20T10:00:00.000Z', result: { resultType: 'complete' } });
  });
});
