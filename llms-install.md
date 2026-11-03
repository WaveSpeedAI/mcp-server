# Installing the WaveSpeed MCP server (for AI agents)

## Option 1: remote server (no install, no API key to copy)

If the client can add a server by URL, use the hosted server:

```text
https://api.wavespeed.ai/mcp
```

On first use the user approves the connection in their browser; that creates a
dedicated API key named `MCP · <app>` on their account. If the client can only
start local commands, connect through `mcp-remote`, which opens the same
browser approval:

```json
{
  "mcpServers": {
    "wavespeed": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://api.wavespeed.ai/mcp"]
    }
  }
}
```

The remote server cannot read files on the user's computer; inputs must be
public URLs. Use option 2 when the user wants to pass local files.

## Option 2: local server

One command, no build step:

```bash
npx -y @wavespeed/mcp@latest
```

MCP client config (Cline / Claude Desktop / any `mcpServers` consumer):

```json
{
  "mcpServers": {
    "wavespeed": {
      "command": "npx",
      "args": ["-y", "@wavespeed/mcp@latest"],
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
