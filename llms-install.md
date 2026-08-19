# Installing the WaveSpeed MCP server (for AI agents)

One command, no build step:

```bash
npx -y @wavespeed/mcp
```

MCP client config (Cline / Claude Desktop / any `mcpServers` consumer):

```json
{
  "mcpServers": {
    "wavespeed": {
      "command": "npx",
      "args": ["-y", "@wavespeed/mcp"],
      "env": { "WAVESPEED_API_KEY": "<key from https://wavespeed.ai/accesskey>" }
    }
  }
}
```

Notes:

- Requires Node.js ≥ 18.
- `WAVESPEED_API_KEY` is the only configuration. If the user has the
  `@wavespeed/cli` installed and ran `wavespeed login`, the env var can be
  omitted — the server reuses the CLI's stored login.
- Ask the user to get their key from https://wavespeed.ai/accesskey rather
  than guessing; never hardcode a placeholder key into the config.
- Verify the install by calling the `get_balance` tool: a number confirms
  auth works. Then `list_models` → `get_model_schema` → `run_model` is the
  intended usage pattern.
