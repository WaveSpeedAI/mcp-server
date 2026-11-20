#!/usr/bin/env node
// stdio entry point: `wavespeed-mcp` (or `npx -y @wavespeed/mcp@latest`).
// serveStdio answers both the 2026-07-28 protocol and the initialize-based
// revisions, chosen by how the client opens the connection.

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer } from './server.js';

serveStdio(() => createServer());
// stdout belongs to the MCP protocol; anything human goes to stderr.
console.error('wavespeed-mcp: serving on stdio');
