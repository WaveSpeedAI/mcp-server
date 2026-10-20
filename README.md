<div align="center">
  <a href="https://wavespeed.ai" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/wavespeed-logo-dark.svg">
      <img src="assets/wavespeed-logo-light.svg" alt="WaveSpeed" width="342" height="48"/>
    </picture>
  </a>
</div>

# WaveSpeed MCP Server

<a href="https://cursor.com/install-mcp?name=wavespeed&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkB3YXZlc3BlZWQvbWNwIl0sImVudiI6eyJXQVZFU1BFRURfQVBJX0tFWSI6Indza18uLi4ifX0%3D">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/deeplink/mcp-install-light.svg">
    <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add wavespeed MCP server to Cursor" height="32"/>
  </picture>
</a>

<!-- mcp-name: ai.wavespeed/mcp -->

An MCP server for the [WaveSpeed](https://wavespeed.ai) platform: run any model on the **live catalog** — image, video, audio, 3D — from Claude Code, Claude Desktop, Cursor, Cline, or any MCP client.

Built on the same design as the open-source [`@wavespeed/cli`](https://github.com/WaveSpeedAI/wavespeed-cli):

- **No hardcoded models.** The catalog comes from the live API (1h cache); new platform models work the day they ship.
- **One generation verb.** `run_model` executes anything; `get_model_schema` tells the agent what inputs a model actually accepts, so it reads before it writes.
- **Inputs are never mutated.** The one explicit transform is the `@path` marker — a `"@./photo.jpg"` value inside `input` uploads the file and substitutes its hosted URL. Bare paths are passed through untouched.
- **Quote before you spend.** `get_price` takes the same input as `run_model` and returns an estimate; the amount actually charged for a run is authoritative.

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Search the live catalog by text or modality type |
| `get_model_schema` | A model's real input schema (required, properties, defaults), with a link to the model's `llms.txt` |
| `run_model` | Submit + wait; rejects input keys the model doesn't accept; `@path` inputs upload automatically; returns output URLs |
| `get_price` | Cost estimate for the inputs you pass (no charge), with a link to the model's `llms.txt` |
| `get_balance` | Account credit balance, with the top-up link |
| `list_predictions` | Run history (default last 24h); filter by model, status, time range |
| `list_billings` | Itemized charges and refunds (needs a Billing-access key) |
| `get_usage` | Spend, request counts and per-model breakdown (default last 7 days; needs a Billing-access key) |
| `delete_predictions` | Delete finished runs from the history (up to 100; needs `confirm: true`, cannot be undone from here) |
| `upload_file` | Local file → hosted URL (24h content-hash dedupe) |
| `get_prediction` | Status/outputs of any run by id; optional `wait_seconds` to wait for it |

Some generations take minutes to hours. `run_model` submits the run and returns the prediction id right away (`done: false`); the assistant then calls `get_prediction` with that id and `wait_seconds` (max 1800) until `done` is `true`. The task keeps running server-side, so a dropped connection loses nothing. Pass `wait_seconds` to `run_model` to wait for a quick model in the same call. While waiting, both tools send MCP progress notifications that carry the prediction id.

## Setup

### Remote (nothing to install)

The same server is hosted at:

```text
https://api.wavespeed.ai/mcp
```

- **Claude on the web / ChatGPT:** add a custom connector with that address and approve the connection on the WaveSpeed page that opens. Approving creates a dedicated API key (named `MCP · <app>`) that you can delete on the [API Keys](https://wavespeed.ai/accesskey) page to disconnect.
- **Claude Code:** `claude mcp add --transport http wavespeed https://api.wavespeed.ai/mcp`
- **Cursor:**
  <a href="https://cursor.com/install-mcp?name=wavespeed&config=eyJ1cmwiOiJodHRwczovL2FwaS53YXZlc3BlZWQuYWkvbWNwIn0%3D">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://cursor.com/deeplink/mcp-install-light.svg">
      <img src="https://cursor.com/deeplink/mcp-install-dark.svg" alt="Add the hosted wavespeed MCP server to Cursor" height="32"/>
    </picture>
  </a>
- **VS Code:** `code --add-mcp '{"name":"wavespeed","type":"http","url":"https://api.wavespeed.ai/mcp"}'`
- **Any other client that sends request headers:** point it at the URL with `Authorization: Bearer <your API key>`.

The hosted server has the same tools, with one difference for files: it cannot read files on your computer, so pass public URLs, use `create_upload` from a tool that can send HTTP requests (it returns a temporary upload address and the `download_url` to use as an input), or, in ChatGPT, attach the file to the chat (the `upload_attachment` tool, which only ChatGPT can fill, imports it and returns a `download_url`). Full guide: [wavespeed.ai/docs/mcp](https://wavespeed.ai/docs/mcp).

### Local (npx)

Auth resolves from `WAVESPEED_API_KEY`, or from the CLI's stored login (`wavespeed login`) — one login covers both tools. Keys: [wavespeed.ai/accesskey](https://wavespeed.ai/accesskey).

**Claude Code**

```bash
claude mcp add wavespeed -- npx -y @wavespeed/mcp
```

**Claude Desktop / other clients** (`mcpServers` config):

```json
{
  "mcpServers": {
    "wavespeed": {
      "command": "npx",
      "args": ["-y", "@wavespeed/mcp"],
      "env": { "WAVESPEED_API_KEY": "wsk_..." }
    }
  }
}
```

## Example prompts

- *"Generate a 16:9 hero image of a cyberpunk skyline at golden hour."*
- *"Take ./photo.jpg and replace the background with a sunlit kitchen."* (the agent passes `"@./photo.jpg"`)
- *"Animate ./hero.png with subtle parallax — check the price first."*

## Development

```bash
npm install
npm run dev        # run from source (stdio)
npm run lint       # typecheck
npm run build      # tsc → dist/
```

## License

[MIT](LICENSE)

---

**[WaveSpeed AI](https://wavespeed.ai/)** — AI image & video generation platform.
Try it in the browser: **[Image generator](https://wavespeed.ai/image-generator)** · **[Video generator](https://wavespeed.ai/video-generator)**
