<div align="center">
  <a href="https://wavespeed.ai" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/wavespeed-logo-dark.svg">
      <img src="assets/wavespeed-logo-light.svg" alt="WaveSpeed" width="342" height="48"/>
    </picture>
  </a>
</div>

# WaveSpeed MCP Server

<p>
  <a href="https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=WaveSpeed&amp;connectorUrl=https%3A%2F%2Fapi.wavespeed.ai%2Fmcp"><img src="https://img.shields.io/badge/Add%20to%20Claude-D97757?style=for-the-badge&amp;logo=claude&amp;logoColor=white" alt="Add to Claude" height="28"/></a>
  <a href="https://chatgpt.com/plugins"><img src="https://img.shields.io/badge/Add%20to%20ChatGPT-10A37F?style=for-the-badge&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik05LjIwNSA4LjY1OHYtMi4yNmMwLS4xOS4wNzItLjMzMy4yMzgtLjQyOGw0LjU0My0yLjYxNmMuNjE5LS4zNTcgMS4zNTYtLjUyMyAyLjExNy0uNTIzIDIuODU0IDAgNC42NjIgMi4yMTIgNC42NjIgNC41NjYgMCAuMTY3IDAgLjM1Ny0uMDI0LjU0N2wtNC43MS0yLjc1OWEuNzk3Ljc5NyAwIDAwLS44NTYgMGwtNS45NyAzLjQ3M3ptMTAuNjA5IDguOFYxMi4wNmMwLS4zMzMtLjE0My0uNTctLjQyOS0uNzM3bC01Ljk3LTMuNDczIDEuOTUtMS4xMThhLjQzMy40MzMgMCAwMS40NzYgMGw0LjU0MyAyLjYxN2MxLjMwOS43NiAyLjE4OSAyLjM3OCAyLjE4OSAzLjk0OCAwIDEuODA4LTEuMDcgMy40NzMtMi43NiA0LjE2M3pNNy44MDIgMTIuNzAzbC0xLjk1LTEuMTQyYy0uMTY3LS4wOTUtLjIzOS0uMjM4LS4yMzktLjQyOFY1Ljg5OWMwLTIuNTQ1IDEuOTUtNC40NzIgNC41OTEtNC40NzIgMSAwIDEuOTI3LjMzMyAyLjcxMi45MjhMOC4yMyA1LjA2N2MtLjI4NS4xNjYtLjQyOC40MDQtLjQyOC43Mzd2Ni44OTh6TTEyIDE1LjEyOGwtMi43OTUtMS41N3YtMy4zM0wxMiA4LjY1OGwyLjc5NSAxLjU3djMuMzNMMTIgMTUuMTI4em0xLjc5NiA3LjIzYy0xIDAtMS45MjctLjMzMi0yLjcxMi0uOTI3bDQuNjg2LTIuNzEyYy4yODUtLjE2Ni40MjgtLjQwNC40MjgtLjczN3YtNi44OThsMS45NzQgMS4xNDJjLjE2Ny4wOTUuMjM4LjIzOC4yMzguNDI4djUuMjMzYzAgMi41NDUtMS45NzQgNC40NzItNC42MTQgNC40NzJ6bS01LjYzNy01LjMwM2wtNC41NDQtMi42MTdjLTEuMzA4LS43NjEtMi4xODgtMi4zNzgtMi4xODgtMy45NDhBNC40ODIgNC40ODIgMCAwMTQuMjEgNi4zMjd2NS40MjNjMCAuMzMzLjE0My41NzEuNDI4LjczOGw1Ljk0NyAzLjQ0OS0xLjk1IDEuMTE4YS40MzIuNDMyIDAgMDEtLjQ3NiAwem0tLjI2MiAzLjljLTIuNjg4IDAtNC42NjItMi4wMjEtNC42NjItNC41MTkgMC0uMTkuMDI0LS4zOC4wNDctLjU3bDQuNjg2IDIuNzFjLjI4Ni4xNjcuNTcxLjE2Ny44NTYgMGw1Ljk3LTMuNDQ4djIuMjZjMCAuMTktLjA3LjMzMy0uMjM3LjQyOGwtNC41NDMgMi42MTZjLS42MTkuMzU3LTEuMzU2LjUyMy0yLjExNy41MjN6bTUuODk5IDIuODNhNS45NDcgNS45NDcgMCAwMDUuODI3LTQuNzU2QzIyLjI4NyAxOC4zMzkgMjQgMTUuODQgMjQgMTMuMjk2YzAtMS42NjUtLjcxMy0zLjI4Mi0xLjk5OC00LjQ0OC4xMTktLjUuMTktLjk5OS4xOS0xLjQ5OCAwLTMuNDAxLTIuNzU5LTUuOTQ3LTUuOTQ2LTUuOTQ3LS42NDIgMC0xLjI2LjA5NS0xLjg4LjMxQTUuOTYyIDUuOTYyIDAgMDAxMC4yMDUgMGE1Ljk0NyA1Ljk0NyAwIDAwLTUuODI3IDQuNzU3QzEuNzEzIDUuNDQ3IDAgNy45NDUgMCAxMC40OWMwIDEuNjY2LjcxMyAzLjI4MyAxLjk5OCA0LjQ0OC0uMTE5LjUtLjE5IDEtLjE5IDEuNDk5IDAgMy40MDEgMi43NTkgNS45NDYgNS45NDYgNS45NDYuNjQyIDAgMS4yNi0uMDk1IDEuODgtLjMwOWE1Ljk2IDUuOTYgMCAwMDQuMTYyIDEuNzEzeiIvPjwvc3ZnPg%3D%3D&amp;logoColor=white" alt="Add to ChatGPT" height="28"/></a>
  <a href="https://cursor.com/install-mcp?name=wavespeed&amp;config=eyJ1cmwiOiJodHRwczovL2FwaS53YXZlc3BlZWQuYWkvbWNwIn0%3D"><img src="https://img.shields.io/badge/Add%20to%20Cursor-000000?style=for-the-badge&amp;logo=cursor&amp;logoColor=white" alt="Add to Cursor" height="28"/></a>
  <a href="https://vscode.dev/redirect/mcp/install?name=wavespeed&amp;config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.wavespeed.ai%2Fmcp%22%7D"><img src="https://img.shields.io/badge/Add%20to%20VS%20Code-0098FF?style=for-the-badge&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMC44NjM0IDEzLjkxOTVDMTAuNjU2OCAxNC4wMTk1IDEwLjQyMzMgMTQuMDI0NiAxMC4yMTg1IDEzLjk0NDRDMTAuMTE2MiAxMy45MDQ0IDEwLjAyMSAxMy44NDMgOS45Mzk5NyAxMy43NjE0TDQuODE2MTYgOS4wNjI2OEwyLjU4NDMzIDEwLjc2NTZDMi4zNzY1NyAxMC45MjQxIDIuMDg1OTcgMTAuOTExMSAxLjg5MzAxIDEwLjczNDdMMS4xNzcxOSAxMC4wODAyQzAuOTQxMTY4IDkuODY0MzcgMC45NDA4OTggOS40OTExMiAxLjE3NjYxIDkuMjc0OTZMMy4xMTIxMyA3LjVMMS4xNzY2MSA1LjcyNTA0QzAuOTQwODk4IDUuNTA4ODggMC45NDExNjggNS4xMzU2MyAxLjE3NzE5IDQuOTE5ODJMMS44OTMwMSA0LjI2NTNDMi4wODU5NyA0LjA4ODg3IDIuMzc2NTcgNC4wNzU4OCAyLjU4NDMzIDQuMjM0NEw0LjgxNjE2IDUuOTM3MzJMOS45Mzk5NyAxLjIzODU1QzkuOTcwMzcgMS4yMDc5NyAxMC4wMDI4IDEuMTgwMjMgMTAuMDM2OCAxLjE1NTM4QzEwLjI3NDggMC45ODE0MjkgMTAuNTkyMiAwLjk0OTI5OCAxMC44NjM0IDEuMDgwNDhMMTMuNTM5OSAyLjM3NTA3QzEzLjgyMTIgMi41MTExIDE0IDIuNzk3MjEgMTQgMy4xMTEwOVY4SDEwLjc1MlY0LjUzMzU2TDYuODY0MTkgNy41TDEwLjc1MiAxMC40NjY0VjhIMTRWMTEuODg4OUMxNCAxMi4yMDI4IDEzLjgyMTEgMTIuNDg4OSAxMy41Mzk5IDEyLjYyNUwxMC44NjM0IDEzLjkxOTVaIi8%2BPC9zdmc%2B&amp;logoColor=white" alt="Add to VS Code" height="28"/></a>
</p>

<!-- mcp-name: ai.wavespeed/mcp -->

An MCP server for the [WaveSpeed](https://wavespeed.ai) platform: run any model on the **live catalog** — image, video, audio, 3D — from ChatGPT, Claude, Claude Code, Codex, Cursor, Cline, or any MCP client.

Built on the same design as the open-source [`@wavespeed/cli`](https://github.com/WaveSpeedAI/wavespeed-cli):

- **No hardcoded models for `run_model`.** The catalog comes from the live API (1h cache); new platform models work the day they ship.
- **One general verb, five shortcuts.** `run_model` executes anything; `get_model_schema` tells the agent what inputs a model actually accepts, so it reads before it writes. `generate_image`, `edit_image`, `generate_video`, `edit_video` and `extend_video` skip that: they use the same models as the [WaveSpeed /chat](https://wavespeed.ai/chat) page, pick the endpoint for what you give them and fit the request to its live schema.
- **Inputs are never mutated.** The one explicit transform is the `@path` marker — a `"@./photo.jpg"` value inside `input` uploads the file and substitutes its hosted URL. Bare paths are passed through untouched. The shortcut tools (`generate_image` etc.) are the exception: they pick the endpoint and fit the request to the model, and report what they changed in `notes`.
- **Quote before you spend.** `get_price` takes the same input as `run_model` and returns an estimate; the amount actually charged for a run is authoritative.

## Tools

| Tool | What it does |
|---|---|
| `list_models` | Search the live catalog by text or modality type |
| `get_model_schema` | A model's real input schema (required, properties, defaults), with a link to the model's playground page |
| `run_model` | Submit + wait; rejects input keys the model doesn't accept; `@path` inputs upload automatically; returns output URLs |
| `generate_image` | Image from a prompt with the /chat image models (default Seedream 5.5); reference images use the model's edit endpoint |
| `edit_image` | Edit, restyle or combine existing images with the same models |
| `generate_video` | Video from a prompt, a first/last frame or reference images/videos/audio, with the /chat video models (default Seedance 2.5); the mode (text, image, reference) is picked from the inputs |
| `edit_video` | Edit an existing video, optionally with reference images/audio |
| `extend_video` | Continue an existing video with new footage |
| `get_price` | Cost estimate for the inputs you pass (no charge), with a link to the model's playground page |
| `get_balance` | Account credit balance, with the top-up link |
| `list_predictions` | Run history (default last 24h); filter by model, status, time range |
| `list_billings` | Itemized charges and refunds (needs a Billing-access key) |
| `get_usage` | Spend, request counts and per-model breakdown (default last 7 days; needs a Billing-access key) |
| `delete_predictions` | Delete finished runs from the history (up to 100; needs `confirm: true`, cannot be undone from here) |
| `upload_file` | Local file → hosted URL (24h content-hash dedupe) |
| `get_prediction` | Status/outputs of any run by id; optional `wait_seconds` to wait for it |

The five shortcut tools take `wait_seconds` like `run_model`, and `estimate_only: true` returns the price and the exact request that would run without submitting or charging anything. In their prompts, media is named `@image 1`, `@video 1`, `@audio 1` (in the order given); it is renamed to what each model expects. Models and defaults follow /chat: an unknown `model` is rejected, and a named model is never switched.

Some generations take minutes to hours. `run_model` submits the run and returns the prediction id right away (`done: false`); the assistant then calls `get_prediction` with that id and `wait_seconds` (max 1800) until `done` is `true`. The task keeps running server-side, so a dropped connection loses nothing. Pass `wait_seconds` to `run_model` to wait for a quick model in the same call. While waiting, both tools send MCP progress notifications that carry the prediction id.

Clients that speak MCP protocol revision 2026-07-28 and declare the tasks extension (for example Claude Code) get a run that is still going back as an MCP task instead: the client follows it on its own and hands the assistant the result when the run ends, so nobody has to keep calling `get_prediction`. Older clients keep the behavior above.

## Setup

### Remote (nothing to install)

The same server is hosted at:

```text
https://api.wavespeed.ai/mcp
```

- **Claude (web / Desktop):**
  <a href="https://claude.ai/customize/connectors?modal=add-custom-connector&amp;connectorName=WaveSpeed&amp;connectorUrl=https%3A%2F%2Fapi.wavespeed.ai%2Fmcp"><img src="https://img.shields.io/badge/Add%20to%20Claude-D97757?style=for-the-badge&amp;logo=claude&amp;logoColor=white" alt="Add to Claude" height="28"/></a>

  The button opens the add-connector dialog with the address filled in (or add a custom connector by hand). Approve the connection on the WaveSpeed page that opens. Approving creates a dedicated API key (named `MCP · <app>`) that you can delete on the [API Keys](https://wavespeed.ai/accesskey) page to disconnect.
- **ChatGPT:**
  <a href="https://chatgpt.com/plugins"><img src="https://img.shields.io/badge/Add%20to%20ChatGPT-10A37F?style=for-the-badge&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik05LjIwNSA4LjY1OHYtMi4yNmMwLS4xOS4wNzItLjMzMy4yMzgtLjQyOGw0LjU0My0yLjYxNmMuNjE5LS4zNTcgMS4zNTYtLjUyMyAyLjExNy0uNTIzIDIuODU0IDAgNC42NjIgMi4yMTIgNC42NjIgNC41NjYgMCAuMTY3IDAgLjM1Ny0uMDI0LjU0N2wtNC43MS0yLjc1OWEuNzk3Ljc5NyAwIDAwLS44NTYgMGwtNS45NyAzLjQ3M3ptMTAuNjA5IDguOFYxMi4wNmMwLS4zMzMtLjE0My0uNTctLjQyOS0uNzM3bC01Ljk3LTMuNDczIDEuOTUtMS4xMThhLjQzMy40MzMgMCAwMS40NzYgMGw0LjU0MyAyLjYxN2MxLjMwOS43NiAyLjE4OSAyLjM3OCAyLjE4OSAzLjk0OCAwIDEuODA4LTEuMDcgMy40NzMtMi43NiA0LjE2M3pNNy44MDIgMTIuNzAzbC0xLjk1LTEuMTQyYy0uMTY3LS4wOTUtLjIzOS0uMjM4LS4yMzktLjQyOFY1Ljg5OWMwLTIuNTQ1IDEuOTUtNC40NzIgNC41OTEtNC40NzIgMSAwIDEuOTI3LjMzMyAyLjcxMi45MjhMOC4yMyA1LjA2N2MtLjI4NS4xNjYtLjQyOC40MDQtLjQyOC43Mzd2Ni44OTh6TTEyIDE1LjEyOGwtMi43OTUtMS41N3YtMy4zM0wxMiA4LjY1OGwyLjc5NSAxLjU3djMuMzNMMTIgMTUuMTI4em0xLjc5NiA3LjIzYy0xIDAtMS45MjctLjMzMi0yLjcxMi0uOTI3bDQuNjg2LTIuNzEyYy4yODUtLjE2Ni40MjgtLjQwNC40MjgtLjczN3YtNi44OThsMS45NzQgMS4xNDJjLjE2Ny4wOTUuMjM4LjIzOC4yMzguNDI4djUuMjMzYzAgMi41NDUtMS45NzQgNC40NzItNC42MTQgNC40NzJ6bS01LjYzNy01LjMwM2wtNC41NDQtMi42MTdjLTEuMzA4LS43NjEtMi4xODgtMi4zNzgtMi4xODgtMy45NDhBNC40ODIgNC40ODIgMCAwMTQuMjEgNi4zMjd2NS40MjNjMCAuMzMzLjE0My41NzEuNDI4LjczOGw1Ljk0NyAzLjQ0OS0xLjk1IDEuMTE4YS40MzIuNDMyIDAgMDEtLjQ3NiAwem0tLjI2MiAzLjljLTIuNjg4IDAtNC42NjItMi4wMjEtNC42NjItNC41MTkgMC0uMTkuMDI0LS4zOC4wNDctLjU3bDQuNjg2IDIuNzFjLjI4Ni4xNjcuNTcxLjE2Ny44NTYgMGw1Ljk3LTMuNDQ4djIuMjZjMCAuMTktLjA3LjMzMy0uMjM3LjQyOGwtNC41NDMgMi42MTZjLS42MTkuMzU3LTEuMzU2LjUyMy0yLjExNy41MjN6bTUuODk5IDIuODNhNS45NDcgNS45NDcgMCAwMDUuODI3LTQuNzU2QzIyLjI4NyAxOC4zMzkgMjQgMTUuODQgMjQgMTMuMjk2YzAtMS42NjUtLjcxMy0zLjI4Mi0xLjk5OC00LjQ0OC4xMTktLjUuMTktLjk5OS4xOS0xLjQ5OCAwLTMuNDAxLTIuNzU5LTUuOTQ3LTUuOTQ2LTUuOTQ3LS42NDIgMC0xLjI2LjA5NS0xLjg4LjMxQTUuOTYyIDUuOTYyIDAgMDAxMC4yMDUgMGE1Ljk0NyA1Ljk0NyAwIDAwLTUuODI3IDQuNzU3QzEuNzEzIDUuNDQ3IDAgNy45NDUgMCAxMC40OWMwIDEuNjY2LjcxMyAzLjI4MyAxLjk5OCA0LjQ0OC0uMTE5LjUtLjE5IDEtLjE5IDEuNDk5IDAgMy40MDEgMi43NTkgNS45NDYgNS45NDYgNS45NDYuNjQyIDAgMS4yNi0uMDk1IDEuODgtLjMwOWE1Ljk2IDUuOTYgMCAwMDQuMTYyIDEuNzEzeiIvPjwvc3ZnPg%3D%3D&amp;logoColor=white" alt="Add to ChatGPT" height="28"/></a>

  The button opens **Plugins**; select the plus button and choose **Add custom MCP server**. Set the server URL to that address (keep the `/mcp`), choose **OAuth**, approve the connection on the WaveSpeed page that opens, then install it before starting a chat. Custom MCP servers are available on selected ChatGPT plans; see OpenAI's [help article](https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt).
- **Claude Code:** `claude mcp add --transport http wavespeed https://api.wavespeed.ai/mcp`
- **Codex:** `codex mcp add wavespeed --url https://api.wavespeed.ai/mcp`, then `codex mcp login wavespeed` to approve in your browser. To use an API key instead, add `--bearer-token-env-var WAVESPEED_API_KEY` to the `add` command.
- **Cursor:**
  <a href="https://cursor.com/install-mcp?name=wavespeed&amp;config=eyJ1cmwiOiJodHRwczovL2FwaS53YXZlc3BlZWQuYWkvbWNwIn0%3D"><img src="https://img.shields.io/badge/Add%20to%20Cursor-000000?style=for-the-badge&amp;logo=cursor&amp;logoColor=white" alt="Add to Cursor" height="28"/></a>
- **VS Code:**
  <a href="https://vscode.dev/redirect/mcp/install?name=wavespeed&amp;config=%7B%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fapi.wavespeed.ai%2Fmcp%22%7D"><img src="https://img.shields.io/badge/Add%20to%20VS%20Code-0098FF?style=for-the-badge&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiI%2BPHBhdGggZmlsbD0id2hpdGUiIGQ9Ik0xMC44NjM0IDEzLjkxOTVDMTAuNjU2OCAxNC4wMTk1IDEwLjQyMzMgMTQuMDI0NiAxMC4yMTg1IDEzLjk0NDRDMTAuMTE2MiAxMy45MDQ0IDEwLjAyMSAxMy44NDMgOS45Mzk5NyAxMy43NjE0TDQuODE2MTYgOS4wNjI2OEwyLjU4NDMzIDEwLjc2NTZDMi4zNzY1NyAxMC45MjQxIDIuMDg1OTcgMTAuOTExMSAxLjg5MzAxIDEwLjczNDdMMS4xNzcxOSAxMC4wODAyQzAuOTQxMTY4IDkuODY0MzcgMC45NDA4OTggOS40OTExMiAxLjE3NjYxIDkuMjc0OTZMMy4xMTIxMyA3LjVMMS4xNzY2MSA1LjcyNTA0QzAuOTQwODk4IDUuNTA4ODggMC45NDExNjggNS4xMzU2MyAxLjE3NzE5IDQuOTE5ODJMMS44OTMwMSA0LjI2NTNDMi4wODU5NyA0LjA4ODg3IDIuMzc2NTcgNC4wNzU4OCAyLjU4NDMzIDQuMjM0NEw0LjgxNjE2IDUuOTM3MzJMOS45Mzk5NyAxLjIzODU1QzkuOTcwMzcgMS4yMDc5NyAxMC4wMDI4IDEuMTgwMjMgMTAuMDM2OCAxLjE1NTM4QzEwLjI3NDggMC45ODE0MjkgMTAuNTkyMiAwLjk0OTI5OCAxMC44NjM0IDEuMDgwNDhMMTMuNTM5OSAyLjM3NTA3QzEzLjgyMTIgMi41MTExIDE0IDIuNzk3MjEgMTQgMy4xMTEwOVY4SDEwLjc1MlY0LjUzMzU2TDYuODY0MTkgNy41TDEwLjc1MiAxMC40NjY0VjhIMTRWMTEuODg4OUMxNCAxMi4yMDI4IDEzLjgyMTEgMTIuNDg4OSAxMy41Mzk5IDEyLjYyNUwxMC44NjM0IDEzLjkxOTVaIi8%2BPC9zdmc%2B&amp;logoColor=white" alt="Add to VS Code" height="28"/></a>

  Or run `code --add-mcp '{"name":"wavespeed","type":"http","url":"https://api.wavespeed.ai/mcp"}'`
- **Clients that only start local commands:** connect through [`mcp-remote`](https://www.npmjs.com/package/mcp-remote), which opens the same browser approval on first start:

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

- **Any other client that sends request headers:** point it at the URL with `Authorization: Bearer <your API key>`.

The hosted server has the same tools, with one difference for files: it cannot read files on your computer, so pass public URLs, use `create_upload` from a tool that can send HTTP requests (it returns a temporary upload address and the `download_url` to use as an input), or, in ChatGPT, attach the file to the chat (the `upload_attachment` tool, which only ChatGPT can fill, imports it and returns a `download_url`). Full guide: [wavespeed.ai/docs/mcp](https://wavespeed.ai/docs/mcp).

### Local (npx)

`@latest` makes npx fetch the newest release on each start; without it, npx runs a globally installed `@wavespeed/mcp` if one exists, however old.

Auth resolves from `WAVESPEED_API_KEY`, or from the CLI's stored login (`wavespeed login`) — one login covers both tools. Keys: [wavespeed.ai/accesskey](https://wavespeed.ai/accesskey).

**Claude Code**

```bash
claude mcp add wavespeed -- npx -y @wavespeed/mcp@latest
```

**Codex**

```bash
codex mcp add wavespeed --env WAVESPEED_API_KEY=wsk_... -- npx -y @wavespeed/mcp@latest
```

**Claude Desktop / other clients** (`mcpServers` config):

```json
{
  "mcpServers": {
    "wavespeed": {
      "command": "npx",
      "args": ["-y", "@wavespeed/mcp@latest"],
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
