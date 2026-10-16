// Pre-submit input validation against a model's published request schema.
//
// The API's entry whitelist silently DROPS any input key that is not in the
// model's schema — a typo like `size=2560*1440` against a model whose real
// knobs are `aspect_ratio`/`resolution` doesn't fail, it just quietly bills a
// generation with defaults. Catching that before submission is the only
// moment the mistake is still free.
//
// Validation fails OPEN: no schema (brand-new model, catalog lag, offline
// cache miss) means no check. It must never block a submission the API would
// have accepted.

import { LiveModel } from './api.js';

export interface UnknownKeyReport {
  unknown: string[];
  known: string[];
  suggestions: Map<string, string>;
}

export function requestSchemaProps(model: LiveModel | undefined): string[] | null {
  const props = model?.api_schema?.api_schemas?.[0]?.request_schema?.properties;
  if (!props) return null;
  const keys = Object.keys(props);
  return keys.length > 0 ? keys : null;
}

/**
 * Legacy field names a model still accepts, as `legacy -> canonical`.
 *
 * The API renames public fields without breaking old callers by declaring the
 * old name in the property's `x-aliases` (e.g. `last_image` carries
 * `["end_image"]`) and folding it into the canonical name before validation.
 * A legacy name is therefore a valid input, not a typo — it just is not listed
 * as an accepted input, so schema-driven UIs show only the current name.
 */
export function requestSchemaAliases(model: LiveModel | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  const props = model?.api_schema?.api_schemas?.[0]?.request_schema?.properties;
  if (!props) return aliases;
  for (const [name, def] of Object.entries(props as Record<string, { 'x-aliases'?: unknown }>)) {
    const declared = def?.['x-aliases'];
    if (!Array.isArray(declared)) continue;
    for (const alias of declared) {
      if (typeof alias === 'string' && alias !== name) aliases.set(alias, name);
    }
  }
  return aliases;
}

// Small edit distance for typo hints — inputs are short snake_case tokens, so
// a full Levenshtein over ≤40 keys is nothing.
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return dp[a.length][b.length];
}

function closest(key: string, known: string[]): string | undefined {
  let best: string | undefined;
  let bestD = Infinity;
  for (const k of known) {
    const d = editDistance(key.toLowerCase(), k.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  // A hint is only a hint when it's plausibly the same word.
  return bestD <= Math.max(2, Math.floor(key.length / 3)) ? best : undefined;
}

/**
 * Compare top-level input keys with the schema's properties.
 * Returns null when everything checks out or no schema is available.
 */
export function findUnknownInputs(
  input: Record<string, unknown>,
  model: LiveModel | undefined,
): UnknownKeyReport | null {
  const known = requestSchemaProps(model);
  if (!known) return null;
  const knownSet = new Set(known);
  const aliases = requestSchemaAliases(model);
  const unknown = Object.keys(input).filter((k) => !knownSet.has(k) && !aliases.has(k));
  if (unknown.length === 0) return null;
  const suggestions = new Map<string, string>();
  for (const k of unknown) {
    const hit = closest(k, known);
    if (hit) suggestions.set(k, hit);
  }
  return { unknown, known, suggestions };
}
