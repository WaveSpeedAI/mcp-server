// Pricing formulas are JSONata expressions returned by /api/v3/models, e.g.
//   {"total_price": $max([5, $min([$ceil(get_duration_v3(audio)), 600])]) / 5 * base_price}
//   {"total_price": base_price * duration / 5}
//
// The pricing endpoint evaluates them server-side and happily accepts a partial
// (or empty) `inputs` object — a formula whose variables are all missing
// collapses to `base_price`, which is the floor of the model's price range, not
// a typical charge. `wavespeed price wavespeed-ai/infinitetalk` with no inputs
// quotes $0.15 while a 60s audio actually costs $1.80. So we parse the formula
// to find which inputs move the price, and say which ones the quote is blind to.

const RESERVED = new Set(['base_price', 'total_price', 'true', 'false', 'null']);

/**
 * Variable names a pricing formula reads from the model's inputs, in first-seen
 * order. Excludes JSONata builtins (`$max`), helper calls (`get_duration_v3`),
 * string literals, and `base_price`/`total_price`.
 *
 * Returns [] for a flat-priced model (`base_price * 1`) or an unparseable
 * formula — callers should treat [] as "nothing input-dependent to warn about".
 */
export function extractPriceVars(formula: string | undefined): string[] {
  if (!formula) return [];
  // Drop string literals first so "720p" / "total_price" keys never register.
  const stripped = formula.replace(/"(?:[^"\\]|\\.)*"/g, '""').replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const vars: string[] = [];
  const seen = new Set<string>();
  const re = /(\$?)([A-Za-z_][A-Za-z0-9_]*)\s*(\()?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const [, dollar, name, call] = m;
    if (dollar) continue; // $max, $ceil, $length — JSONata builtin
    if (call) continue; // get_duration_v3(...) — server-side helper
    if (RESERVED.has(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    vars.push(name);
  }
  return vars;
}

/**
 * Price-driving variables the quote is genuinely blind to.
 *
 * A driver the caller omitted but that carries a schema default is NOT blind —
 * the server priced it at that default, which is exactly what a run would use.
 * Only drivers with no default (infinitetalk's `audio`, seedance's
 * `reference_videos`) leave the quote uninformed, and those are the ones that
 * silently collapse the formula toward base_price.
 */
export function missingPriceVars(
  formula: string | undefined,
  inputs: Record<string, unknown>,
  schemaProps?: Record<string, unknown>,
): string[] {
  return extractPriceVars(formula).filter((v) => {
    const val = inputs[v];
    if (val !== undefined && val !== null && val !== '') return false;
    const prop = schemaProps?.[v] as { default?: unknown } | undefined;
    return !(prop && 'default' in prop);
  });
}

/**
 * True when every price driver is unsupplied — the case where the formula
 * degenerates to `base_price` and the quote is the floor of the model's range
 * rather than a representative charge.
 */
export function isFloorQuote(
  formula: string | undefined,
  inputs: Record<string, unknown>,
): boolean {
  const vars = extractPriceVars(formula);
  if (vars.length === 0) return false;
  return vars.every((v) => {
    const val = inputs[v];
    return val === undefined || val === null || val === '';
  });
}
