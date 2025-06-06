# WavespeedMCP

## [English](README.md) ｜ [中文文档](README.zh.md)

WavespeedMCP is a Model Control Protocol (MCP) server implementation for WaveSpeed AI services. It provides a standardized interface for accessing WaveSpeed's image and video generation capabilities through the MCP protocol.

## Features

- **Advanced Image Generation**: Create high-quality images from text prompts with support for image-to-image generation, inpainting, and LoRA models
- **Dynamic Video Generation**: Transform static images into videos with customizable motion parameters
- **Optimized Performance**: Enhanced API polling with intelligent retry logic and detailed progress tracking
- **Flexible Resource Handling**: Support for URL, Base64, and local file output modes
- **Comprehensive Error Handling**: Specialized exception hierarchy for precise error identification and recovery
- **Robust Logging**: Detailed logging system for monitoring and debugging
- **Multiple Configuration Options**: Support for environment variables, command-line arguments, and configuration files

## Installation

### Prerequisites

- Python 3.11+
- WaveSpeed API key (obtain from [WaveSpeed AI](https://wavespeed.ai))

### Setup

Install directly from PyPI:

```bash
pip install wavespeed-mcp
```

### MCP Configuration

To use WavespeedMCP with your IDE or application, add the following configuration:

```json
{
  "mcpServers": {
    "Wavespeed": {
      "command": "wavespeed-mcp",
      "env": {
        "WAVESPEED_API_KEY": "wavespeedkey"
      }
    }
  }
}
```

## Usage

### Running the Server

Start the WavespeedMCP server:

```bash
wavespeed-mcp --api-key your_api_key_here
```

### Claude Desktop Integration

WavespeedMCP can be integrated with Claude Desktop. To generate the necessary configuration file:

```bash
python -m wavespeed_mcp --api-key your_api_key_here --config-path /path/to/claude/config
```

This command generates a `claude_desktop_config.json` file that configures Claude Desktop to use WavespeedMCP tools. After generating the configuration:

1. Start the WavespeedMCP server using the `wavespeed-mcp` command
2. Launch Claude Desktop, which will use the configured WavespeedMCP tools

## Configuration Options

WavespeedMCP can be configured through:

1. **Environment Variables**:

   - `WAVESPEED_API_KEY`: Your WaveSpeed API key (required)
   - `WAVESPEED_API_HOST`: API host URL (default: https://api.wavespeed.ai)
   - `WAVESPEED_MCP_BASE_PATH`: Base path for output files (default: ~/Desktop)
   - `WAVESPEED_API_RESOURCE_MODE`: Resource output mode (options: url, base64, local; default: url)
   - `WAVESPEED_LOG_LEVEL`: Logging level (options: DEBUG, INFO, WARNING, ERROR; default: INFO)
   - `WAVESPEED_API_TEXT_TO_IMAGE_ENDPOINT`: Custom endpoint for text-to-image generation (default: /wavespeed-ai/flux-dev)
   - `WAVESPEED_API_IMAGE_TO_IMAGE_ENDPOINT`: Custom endpoint for image-to-image generation (default: /wavespeed-ai/flux-kontext-pro)
   - `WAVESPEED_API_VIDEO_ENDPOINT`: Custom endpoint for video generation (default: /wavespeed-ai/wan-2.1/i2v-480p-lora)

2. **Command-line Arguments**:

   - `--api-key`: Your WaveSpeed API key
   - `--api-host`: API host URL
   - `--config`: Path to configuration file

3. **Configuration File** (JSON format):
   See `wavespeed_mcp_config_demo.json` for an example.

## Architecture

WavespeedMCP follows a clean, modular architecture:

- `server.py`: Core MCP server implementation with tool definitions
- `client.py`: Optimized API client with intelligent polling
- `utils.py`: Comprehensive utility functions for resource handling
- `exceptions.py`: Specialized exception hierarchy for error handling
- `const.py`: Constants and default configuration values

## Development

### Requirements

- Python 3.11+
- Development dependencies: `pip install -e ".[dev]"`

### Testing

Run the test suite:

```bash
pytest
```

Or with coverage reporting:

```bash
pytest --cov=wavespeed_mcp
```

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Support

For support or feature requests, please contact the WaveSpeed AI team at support@wavespeed.ai.
