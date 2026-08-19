// Content-addressed cache of uploaded files: sha256(file bytes) → hosted URL.
//
// Uploads are quota-limited per organization and slow for large videos, while
// the same file routinely goes up more than once — `price --upload` followed
// by `run`, or the same reference image across a batch of runs. Hashing the
// bytes (not the path) means a renamed or copied file still hits.
//
// TTL is 24h: hosted media does not expire that fast, but a bounded window
// keeps the cache from ever serving a URL the platform has since removed.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
  url: string;
  uploaded_at: number;
}

function cacheFile(): string {
  return path.join(os.homedir(), '.cache', 'wavespeed', 'uploads.json');
}

function readCache(): Record<string, CacheEntry> {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(entries: Record<string, CacheEntry>): void {
  try {
    fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
    fs.writeFileSync(cacheFile(), JSON.stringify(entries));
  } catch {
    /* best-effort; a failed cache write must never fail the upload */
  }
}

export function hashFile(filePath: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Upload through `doUpload` unless the identical bytes already went up within
 * the TTL. Returns the hosted URL either way.
 */
export async function uploadWithCache(
  filePath: string,
  doUpload: (p: string) => Promise<string>,
): Promise<{ url: string; cached: boolean }> {
  const key = hashFile(filePath);
  const entries = readCache();
  const hit = entries[key];
  if (hit && Date.now() - hit.uploaded_at < TTL_MS) {
    return { url: hit.url, cached: true };
  }
  const url = await doUpload(filePath);
  entries[key] = { url, uploaded_at: Date.now() };
  // Drop expired entries while we are here so the file stays small.
  for (const [k, v] of Object.entries(entries)) {
    if (Date.now() - v.uploaded_at >= TTL_MS) delete entries[k];
  }
  writeCache(entries);
  return { url, cached: false };
}
