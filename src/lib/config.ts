// API key + base URL resolution.
//
// Precedence: WAVESPEED_API_KEY / WAVESPEED_BASE_URL env vars, then the
// wavespeed CLI's stored config (~/.config/wavespeed-nodejs/config.json,
// written by `wavespeed login`). Reading the CLI's store means one login
// covers both tools — the MCP server never implements its own auth flow.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_BASE_URL = 'https://api.wavespeed.ai';

interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

function cliConfigPath(): string {
  // conf@N with projectName "wavespeed" resolves to <config>/wavespeed-nodejs/config.json
  const base =
    process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME !== ''
      ? process.env.XDG_CONFIG_HOME
      : path.join(os.homedir(), '.config');
  return path.join(base, 'wavespeed-nodejs', 'config.json');
}

function readCliConfig(): CliConfig {
  try {
    return JSON.parse(fs.readFileSync(cliConfigPath(), 'utf8')) as CliConfig;
  } catch {
    return {};
  }
}

export function getApiKey(): string | undefined {
  return process.env.WAVESPEED_API_KEY || readCliConfig().apiKey || undefined;
}

export function getBaseUrl(): string {
  return process.env.WAVESPEED_BASE_URL || readCliConfig().baseUrl || DEFAULT_BASE_URL;
}

export function requireApiKey(): string {
  const key = getApiKey();
  if (!key) {
    throw new Error(
      'No WaveSpeed API key configured. Set WAVESPEED_API_KEY, or install the CLI ' +
        '(npm i -g @wavespeed/cli) and run `wavespeed login`. Keys: https://wavespeed.ai/accesskey',
    );
  }
  return key;
}
