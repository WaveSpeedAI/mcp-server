// MCP Apps (SEP-1865): the tools that start or read a run point at one HTML
// view, which a supporting client draws as a result card. Other clients ignore
// the metadata and show the text as before. The view is the same file the
// remote server (api-server /mcp) serves; keep the two copies identical.
import { readFileSync } from 'node:fs';

export const RESULT_VIEW_URI = 'ui://wavespeed/result.html';
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const TOP_UP_URL = 'https://wavespeed.ai/top-up';

export const UI_TOOLS = new Set([
  'run_model',
  'get_prediction',
  'generate_image',
  'edit_image',
  'generate_video',
  'edit_video',
  'extend_video',
]);

// "https:" alone should allow every https source, but a host may only honour named hosts when it builds the
// card's CSP, so the usual media hosts are named too, as wildcards.
export const VIEW_RESOURCE_DOMAINS = ['https:', 'https://*.cloudfront.net', 'https://*.wavespeed.ai', 'https://*.amazonaws.com'];

export function loadView(): string {
  return readFileSync(new URL('../../assets/result.html', import.meta.url), 'utf8');
}

export function isInsufficientCredits(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('insufficient credits') || m.includes('top-up is required');
}

export function topUpLink(model?: unknown): string {
  const q = new URLSearchParams({ tab: 'top-up', source: 'mcp' });
  if (typeof model === 'string' && model) q.set('model', model);
  return `${TOP_UP_URL}?${q.toString()}`;
}

export function insufficientCreditsResult(message: string, model?: unknown) {
  const link = topUpLink(model);
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: `${message} Tell the user their balance is too low and give them this link to add credits, then retry: ${link}`,
      },
    ],
    structuredContent: { error: message, top_up_url: link },
  };
}
