#!/usr/bin/env node
// stdio entry point: `wavespeed-mcp` (or `npx -y @wavespeed/mcp`).

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout belongs to the MCP protocol; anything human goes to stderr.
  console.error('wavespeed-mcp: connected (stdio)');
}

main().catch((err) => {
  console.error(`wavespeed-mcp: fatal: ${err?.message ?? err}`);
  process.exit(1);
});
