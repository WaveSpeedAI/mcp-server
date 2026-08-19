// Turn `@`-prefixed local file paths in a model's input into hosted URLs.
//
// The syntax is explicit on purpose — `-i image=@./cat.png`, borrowed from
// curl. An earlier draft also auto-detected bare paths (media extension +
// exists on disk), but that meant the CLI could upload a file the user never
// asked to share based on a heuristic; a value that merely looks like a
// filename must never leave the machine. No `@`, no upload: bare paths pass
// through to the API untouched and fail model validation there if they were
// meant to be files.

import fs from 'node:fs';
import path from 'node:path';

export interface LocalFileRef {
  /** Path as written by the user, `@` already stripped. */
  path: string;
  /** Dotted location in the input object, e.g. `image_urls.0`. */
  at: string;
}

export interface DetectOptions {
  /** Injected for tests; defaults to a real regular-file check. */
  exists?: (p: string) => boolean;
}

function isRegularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Walk the input and list every `@path` value. Pure over `exists`, so the
 * rules can be tested without touching the disk.
 */
export function collectLocalFiles(input: unknown, _opts: DetectOptions = {}): LocalFileRef[] {
  const found: LocalFileRef[] = [];

  const walk = (node: unknown, at: string): void => {
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, at ? `${at}.${i}` : String(i)));
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        walk(v, at ? `${at}.${k}` : k);
      }
      return;
    }
    if (typeof node !== 'string' || !node.startsWith('@')) return;
    found.push({ path: node.slice(1), at });
  };

  walk(input, '');
  return found;
}

function setAt(root: any, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
  cur[parts[parts.length - 1]] = value;
}

export interface ResolveOptions extends DetectOptions {
  /** Uploads one file and resolves to its hosted URL. */
  upload: (filePath: string) => Promise<string>;
  /** Called once per distinct file before its upload starts. */
  onUpload?: (filePath: string, index: number, total: number) => void;
}

/**
 * Replace `@path` values in `input` with uploaded URLs. Returns a new object;
 * the caller's input is not mutated. A missing file is an error — the user
 * explicitly asked for an upload, so a silent pass-through would submit the
 * literal `@path` string to the model. Distinct paths upload once even when
 * referenced several times.
 */
export async function resolveLocalFiles(
  input: Record<string, unknown>,
  opts: ResolveOptions,
): Promise<{ input: Record<string, unknown>; uploaded: number }> {
  const refs = collectLocalFiles(input, opts);
  if (refs.length === 0) return { input, uploaded: 0 };

  const exists = opts.exists ?? isRegularFile;
  const missing = refs.filter((r) => !exists(r.path));
  if (missing.length > 0) {
    throw new Error(`File not found: ${missing.map((m) => m.path).join(', ')}`);
  }

  const distinct = [...new Set(refs.map((r) => path.resolve(r.path)))];
  const urls = new Map<string, string>();
  for (const [i, abs] of distinct.entries()) {
    opts.onUpload?.(abs, i, distinct.length);
    urls.set(abs, await opts.upload(abs));
  }

  const out = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  for (const ref of refs) {
    setAt(out, ref.at, urls.get(path.resolve(ref.path))!);
  }
  return { input: out, uploaded: distinct.length };
}
