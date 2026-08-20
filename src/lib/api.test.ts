import { describe, it, expect, afterEach } from 'vitest';
import { clientAttributionHeaders } from './api.js';

const ORIGINAL_ENV = process.env.WAVESPEED_CLIENT_NAME;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.WAVESPEED_CLIENT_NAME;
  } else {
    process.env.WAVESPEED_CLIENT_NAME = ORIGINAL_ENV;
  }
});

describe('clientAttributionHeaders', () => {
  it('reports the MCP server name, package version, and OS', () => {
    delete process.env.WAVESPEED_CLIENT_NAME;
    const headers = clientAttributionHeaders();
    expect(headers['X-Client-Name']).toBe('wavespeed-mcp');
    expect(headers['X-Client-Version']).toMatch(/^\d+\.\d+\.\d+/);
    expect(['darwin', 'linux', 'windows']).toContain(headers['X-Client-OS']);
  });

  it('lets WAVESPEED_CLIENT_NAME override the client name', () => {
    process.env.WAVESPEED_CLIENT_NAME = 'claude-plugin';
    expect(clientAttributionHeaders()['X-Client-Name']).toBe('claude-plugin');
  });
});
