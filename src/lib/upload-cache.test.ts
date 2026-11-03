import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { uploadCacheFile, uploadWithCache } from './upload-cache.js';

describe('uploadWithCache', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('reuses an upload for the same caller only', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-mcp-home-'));
    vi.stubEnv('HOME', home);
    const file = path.join(home, 'a.png');
    fs.writeFileSync(file, 'bytes');
    let n = 0;
    const upload = async () => `https://cdn/${++n}`;

    expect(await uploadWithCache(file, 'aaaa', upload)).toEqual({ url: 'https://cdn/1', cached: false });
    expect(await uploadWithCache(file, 'aaaa', upload)).toEqual({ url: 'https://cdn/1', cached: true });
    // Another API key (another cache id) uploads its own copy.
    expect(await uploadWithCache(file, 'bbbb', upload)).toEqual({ url: 'https://cdn/2', cached: false });
    expect(fs.existsSync(uploadCacheFile('aaaa'))).toBe(true);
    expect(path.basename(uploadCacheFile('bbbb'))).toBe('uploads-bbbb.json');
    fs.rmSync(home, { recursive: true, force: true });
  });
});
