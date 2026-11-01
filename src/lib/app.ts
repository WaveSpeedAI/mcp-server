// MCP Apps (SEP-1865): the tools that start or read a run point at one HTML
// view, which a supporting client draws as a result card. Other clients ignore
// the metadata and show the text as before. The view is the same file the
// remote server (api-server /mcp) serves; keep the two copies identical.
import { readFileSync } from 'node:fs';

// A host keeps a UI resource by its URI, so a changed card only reaches it under a new URI: bump the number.
export const RESULT_VIEW_URI = 'ui://wavespeed/result-v2.html';
export const APP_MIME_TYPE = 'text/html;profile=mcp-app';
export const TOP_UP_URL = 'https://wavespeed.ai/top-up';

// get_prediction is not one of them: the card asks it for itself while the run goes on, and an assistant that polls it
// would draw a second card for the same result. It is marked callable from the card instead (see toolMeta).
export const UI_TOOLS = new Set([
  'run_model',
  'generate_image',
  'edit_image',
  'generate_video',
  'edit_video',
  'extend_video',
]);

// "https:" alone should allow every https source, but a host may only honour named hosts when it builds the
// card's CSP, so the usual media hosts are named too, as wildcards.
export const VIEW_RESOURCE_DOMAINS = ['https:', 'https://*.cloudfront.net', 'https://*.wavespeed.ai', 'https://*.amazonaws.com'];

// The one-line status ChatGPT shows while a tool runs and after it ran (it allows 64 characters).
const TOOL_STATUS: Record<string, [string, string]> = {
  run_model: ['Starting the run…', 'Run started'],
  generate_image: ['Starting the run…', 'Run started'],
  edit_image: ['Starting the run…', 'Run started'],
  generate_video: ['Starting the run…', 'Run started'],
  edit_video: ['Starting the run…', 'Run started'],
  extend_video: ['Starting the run…', 'Run started'],
  get_prediction: ['Checking the run…', 'Run checked'],
};

/**
 * The tool's _meta for the card: the run tools open it; get_prediction does not but says the card may call it
 * (ChatGPT only lets a widget call a tool marked openai/widgetAccessible; MCP Apps hosts read ui.visibility, whose
 * default already includes "app"). Same as the remote server (api-server mcp_app.go).
 */
export function toolMeta(name: string): Record<string, unknown> | undefined {
  const linked = UI_TOOLS.has(name);
  if (!linked && name !== 'get_prediction') return undefined;
  const meta: Record<string, unknown> = {
    ui: linked ? { resourceUri: RESULT_VIEW_URI, visibility: ['model', 'app'] } : { visibility: ['model', 'app'] },
    'openai/widgetAccessible': true,
  };
  if (linked) meta['openai/outputTemplate'] = RESULT_VIEW_URI;
  const status = TOOL_STATUS[name];
  if (status) {
    meta['openai/toolInvocation/invoking'] = status[0];
    meta['openai/toolInvocation/invoked'] = status[1];
  }
  return meta;
}

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
