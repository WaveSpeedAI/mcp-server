import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliConfigPath } from './config.js';

// Must match where the CLI's `conf` store lands on each platform.
describe('cliConfigPath', () => {
  it('uses ~/Library/Preferences on macOS', () => {
    expect(cliConfigPath('darwin', {}, '/Users/a')).toBe(
      path.join('/Users/a', 'Library', 'Preferences', 'wavespeed-nodejs', 'config.json'),
    );
  });

  it('uses %APPDATA%\\<name>\\Config on Windows', () => {
    expect(cliConfigPath('win32', { APPDATA: 'C:/Users/a/AppData/Roaming' }, 'C:/Users/a')).toBe(
      path.join('C:/Users/a/AppData/Roaming', 'wavespeed-nodejs', 'Config', 'config.json'),
    );
  });

  it('honors XDG_CONFIG_HOME on Linux and falls back to ~/.config', () => {
    expect(cliConfigPath('linux', { XDG_CONFIG_HOME: '/x' }, '/home/a')).toBe(
      path.join('/x', 'wavespeed-nodejs', 'config.json'),
    );
    expect(cliConfigPath('linux', {}, '/home/a')).toBe(
      path.join('/home/a', '.config', 'wavespeed-nodejs', 'config.json'),
    );
  });
});
