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
- **Honest pricing.** `get_price` quotes before you spend and names the inputs the quote was blind to (`unpriced_inputs`) instead of presenting a formula's floor as "the" price.

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Search the live catalog by text or modality type |
| `get_model_schema` | A model's real input schema (required, properties, defaults) |
| `run_model` | Submit + wait; `@path` inputs upload automatically; returns output URLs |
| `get_price` | Cost estimate with `unpriced_inputs` / `at_base_price` disclosure |
| `get_balance` | Account credit balance |
| `upload_file` | Local file → hosted URL (24h content-hash dedupe) |
| `get_prediction` | Recover status/outputs of any run by id |

If `run_model` hits its wait limit the task keeps running server-side — the error names the prediction id, and `get_prediction` picks it up.

## Setup

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
