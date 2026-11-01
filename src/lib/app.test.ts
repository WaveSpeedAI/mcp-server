import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.js';
import { APP_MIME_TYPE, RESULT_VIEW_URI, insufficientCreditsResult, isInsufficientCredits, topUpLink } from './app.js';

describe('top-up hint', () => {
  it('recognises the platform wording', () => {
    expect(isInsufficientCredits('Insufficient credits. Please top up your account to continue.')).toBe(true);
    expect(isInsufficientCredits('A top-up is required. Please add credits to your account to use this feature.')).toBe(true);
    expect(isInsufficientCredits('Prediction failed')).toBe(false);
  });

  it('carries the link in the text and the data', () => {
    const r = insufficientCreditsResult('Insufficient credits.', 'acme/img');
    const link = 'https://wavespeed.ai/top-up?tab=top-up&source=mcp&model=acme%2Fimg';
    expect(topUpLink('acme/img')).toBe(link);
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain(link);
    expect(r.structuredContent.top_up_url).toBe(link);
  });
});

describe('result card', () => {
  it('is linked from the run tools and served as a resource', async () => {
    const server = createServer();
    const client = new Client({ name: 't', version: '0' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);

    const { tools } = await client.listTools();
    const linked = tools.filter((t) => (t._meta as any)?.ui?.resourceUri === RESULT_VIEW_URI).map((t) => t.name);
    expect(linked.sort()).toEqual(
      ['edit_image', 'edit_video', 'extend_video', 'generate_image', 'generate_video', 'run_model'],
    );

    // get_prediction opens no card of its own but may be called from it, in both vocabularies.
    const poll = tools.find((t) => t.name === 'get_prediction')!._meta as any;
    expect(poll.ui.resourceUri).toBeUndefined();
    expect(poll.ui.visibility).toEqual(['model', 'app']);
    expect(poll['openai/widgetAccessible']).toBe(true);
    const run = tools.find((t) => t.name === 'run_model')!._meta as any;
    expect(run['openai/outputTemplate']).toBe(RESULT_VIEW_URI);
    expect(run['openai/toolInvocation/invoking'].length).toBeLessThanOrEqual(64);

    const res = await client.readResource({ uri: RESULT_VIEW_URI });
    expect(res.contents[0].mimeType).toBe(APP_MIME_TYPE);
    expect(String(res.contents[0].text)).toContain('ui/initialize');
    await client.close();
  });
});
