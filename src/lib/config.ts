// API key + base URL resolution.
//
// Precedence: WAVESPEED_API_KEY / WAVESPEED_BASE_URL env vars, then the
// wavespeed CLI's stored config (written by `wavespeed login`; location is
// per-platform, see cliConfigPath). Reading the CLI's store means one login
// covers both tools — the MCP server never implements its own auth flow.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const DEFAULT_BASE_URL = 'https://api.wavespeed.ai';

interface CliConfig {
  apiKey?: string;
  baseUrl?: string;
}

// Mirrors conf's env-paths resolution (projectName "wavespeed", suffix
// "nodejs"), which is per-platform — a Linux-only path would miss every
// `wavespeed login` done on macOS or Windows.
export function cliConfigPath(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const name = 'wavespeed-nodejs';
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Preferences', name, 'config.json');
  }
  if (platform === 'win32') {
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    return path.join(appData, name, 'Config', 'config.json');
  }
  const base = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(base, name, 'config.json');
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
