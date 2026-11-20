// The MCP tasks extension (protocol revision 2026-07-28), as the hosted server
// implements it (api-server mcp_modern.go). A run that is still going is
// returned as a task to a client that declared the extension; the client polls
// tasks/get and is told when the run ends.
//
// A task id is the reference itself, with no task store: the prediction id and
// what the tool call would have added to its reply. Every read goes to the
// prediction API with this server's key.

import type { Prediction } from './api.js';

export const TASKS_EXTENSION = 'io.modelcontextprotocol/tasks';
const PREFIX = 'ws1_';
const MAX_ID_LENGTH = 16 << 10;
// Outputs on the WaveSpeed CDN expire after 7 days.
const TTL_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;
const PREDICTION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export type TaskRef = {
  p: string; // prediction id
  m?: string; // model, for a run tool
  a?: Record<string, unknown>; // fields the tool adds to every reply
  r?: boolean; // started by a run tool, whose failed run is a tool error
};

export function encodeTaskId(ref: TaskRef): string {
  return PREFIX + Buffer.from(JSON.stringify(ref)).toString('base64url');
}

export function decodeTaskId(id: string): TaskRef | null {
  if (typeof id !== 'string' || !id.startsWith(PREFIX) || id.length > MAX_ID_LENGTH) return null;
  try {
    const ref = JSON.parse(Buffer.from(id.slice(PREFIX.length), 'base64url').toString('utf8')) as TaskRef;
    return ref && typeof ref.p === 'string' && PREDICTION_ID.test(ref.p) ? ref : null;
  } catch {
    return null;
  }
}

function iso(value: string | undefined): string {
  const t = Date.parse(value ?? '');
  return new Date(Number.isNaN(t) ? Date.now() : t).toISOString();
}

function workingMessage(id: string, status: string | undefined): string {
  return `WaveSpeed prediction ${id} is ${status || 'processing'}; the result arrives when the run finishes. Do not submit it again: a new run is billed again.`;
}

function fields(ref: TaskRef, status: string, statusMessage: string, createdAt?: string) {
  return {
    taskId: encodeTaskId(ref),
    status,
    statusMessage,
    createdAt: iso(createdAt),
    lastUpdatedAt: new Date().toISOString(),
    ttlMs: TTL_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}

// The tools/call answer that hands the client a task.
export function taskCreated(ref: TaskRef, status: string | undefined, createdAt?: string) {
  return { resultType: 'task' as const, ...fields(ref, 'working', workingMessage(ref.p, status), createdAt) } as any;
}

// A tasks/get answer.
export function taskState(
  ref: TaskRef,
  status: 'working' | 'completed',
  message?: string,
  item?: Prediction,
  result?: Record<string, unknown>,
) {
  const text =
    message ?? (status === 'working' ? workingMessage(ref.p, item?.status) : `WaveSpeed prediction ${ref.p} ${item?.status}.`);
  return { ...fields(ref, status, text, item?.created_at), ...(result ? { result } : {}) };
}
