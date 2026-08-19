<div align="center">
  <a href="https://wavespeed.ai" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/wavespeed-logo-dark.svg">
      <img src="assets/wavespeed-logo-light.svg" alt="WaveSpeed" width="342" height="48"/>
    </picture>
  </a>
</div>

# WaveSpeed MCP Server

[English](README.md)

[WaveSpeed](https://wavespeed.ai) 平台的 MCP server：在 Claude Code、Claude Desktop、Cursor、Cline 或任何 MCP 客户端里运行**实时目录**上的任意模型——图像、视频、音频、3D。

与开源的 [`@wavespeed/cli`](https://github.com/WaveSpeedAI/wavespeed-cli) 共享同一套设计：

- **不硬编码模型。** 目录来自实时 API（1 小时缓存）；平台新上的模型当天即可用。
- **一个生成动词。** `run_model` 执行一切；`get_model_schema` 告诉 agent 模型真正接受哪些输入——先读后写，不靠猜参数名。
- **绝不改写输入。** 唯一的显式转换是 `@path` 标记——`input` 里的 `"@./photo.jpg"` 会上传文件并替换成托管 URL。裸路径原样透传。
- **诚实报价。** `get_price` 在花钱前报价，并列出报价没有看到的输入（`unpriced_inputs`），而不是把公式的下限当成"价格"。

## 工具

| 工具 | 作用 |
|---|---|
| `list_models` | 按文本或模态类型搜索实时目录 |
| `get_model_schema` | 模型的真实输入 schema（必填项、属性、默认值） |
| `run_model` | 提交并等待；`@path` 输入自动上传；返回输出 URL |
| `get_price` | 成本预估，附 `unpriced_inputs` / `at_base_price` 披露 |
| `get_balance` | 账户余额 |
| `upload_file` | 本地文件 → 托管 URL（24 小时内容哈希去重） |
| `get_prediction` | 按 id 找回任意一次运行的状态与输出 |

`run_model` 达到等待上限时任务在服务端继续跑——报错会给出 prediction id，用 `get_prediction` 接着取即可。

## 配置

认证按 `WAVESPEED_API_KEY` 环境变量，或复用 CLI 的登录状态（`wavespeed login`）——登录一次两个工具都能用。密钥：[wavespeed.ai/accesskey](https://wavespeed.ai/accesskey)。

**Claude Code**

```bash
claude mcp add wavespeed -- npx -y @wavespeed/mcp
```

**Claude Desktop / 其他客户端**（`mcpServers` 配置）：

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

## 示例提示词

- *「生成一张 16:9 的赛博朋克天际线主图，黄金时刻光线。」*
- *「把 ./photo.jpg 的背景换成阳光厨房。」*（agent 会传 `"@./photo.jpg"`）
- *「让 ./hero.png 动起来，轻微视差——先查一下价格。」*

## 开发

```bash
npm install
npm run dev        # 源码直跑（stdio）
npm run lint       # 类型检查
npm run build      # tsc → dist/
```

## 许可

[MIT](LICENSE)
