#!/usr/bin/env node
// Verify and decrypt this repository's secret-controller bundle.
//
// Adapted from wavespeed-blog's decrypt-kubeconfig-bundle.mjs with the
// contract narrowed to mcp-server's single file: the MCP Registry DNS-auth
// key (prod/mcp-registry-dns-key.pem). Same envelope format: Ed25519-signed,
// RSA-OAEP-SHA256-wrapped AES-256-GCM.
//
// Usage: decrypt-secret-bundle.mjs <bundle> <recipient-private-key> <signing-public-key> <output-dir>

import {
  constants,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  verify,
} from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const [bundlePath, privateKeyPath, signingKeyPath, outputDir] = process.argv.slice(2);
const service = (process.env.GITHUB_REPOSITORY || '').split('/')[1];
if (service !== 'mcp-server') fail('unsupported repository identity');
if (![bundlePath, privateKeyPath, signingKeyPath, outputDir].every(Boolean)) fail('missing path argument');

const EXPECTED_FILES = ['prod/mcp-registry-dns-key.pem'];

const envelope = JSON.parse(await readFile(bundlePath, 'utf8'));
const fields = ['schema', 'service', 'source_revision', 'key_algorithm', 'cipher_algorithm', 'wrapped_key', 'iv', 'auth_tag', 'ciphertext', 'signature_algorithm', 'signature'];
if (!isObject(envelope) || Object.keys(envelope).sort().join('\n') !== fields.sort().join('\n')) fail('invalid envelope fields');
if (envelope.schema !== 1 || envelope.service !== service || !/^[0-9a-f]{40}$/.test(envelope.source_revision)) fail('bundle identity mismatch');
if (envelope.key_algorithm !== 'RSA-OAEP-SHA256' || envelope.cipher_algorithm !== 'AES-256-GCM' || envelope.signature_algorithm !== 'Ed25519') fail('unsupported cryptographic contract');

const unsigned = { ...envelope };
delete unsigned.signature_algorithm;
delete unsigned.signature;
const signingKeys = parseSigningKeys(await readFile(signingKeyPath, 'utf8'));
if (!signingKeys.some((key) => verify(null, Buffer.from(canonicalize(unsigned)), key, decode(envelope.signature, 'signature', 64)))) fail('bundle signature verification failed');

const privateKey = createPrivateKey(await readFile(privateKeyPath));
if (privateKey.asymmetricKeyType !== 'rsa') fail('invalid recipient private key');
const dataKey = privateDecrypt({
  key: privateKey,
  padding: constants.RSA_PKCS1_OAEP_PADDING,
  oaepHash: 'sha256',
}, decode(envelope.wrapped_key, 'wrapped_key', 1024));
if (dataKey.length !== 32) fail('invalid unwrapped key');
const decipher = createDecipheriv('aes-256-gcm', dataKey, decode(envelope.iv, 'iv', 12));
decipher.setAuthTag(decode(envelope.auth_tag, 'auth_tag', 16));
const plaintext = Buffer.concat([
  decipher.update(decode(envelope.ciphertext, 'ciphertext', 16 * 1024 * 1024)),
  decipher.final(),
]);
const payload = JSON.parse(plaintext.toString('utf8'));
if (!isObject(payload) || payload.schema !== 1 || payload.service !== service || payload.source_revision !== envelope.source_revision || !isObject(payload.files)) fail('payload identity mismatch');
if (Object.keys(payload.files).sort().join('\n') !== [...EXPECTED_FILES].sort().join('\n')) fail('unexpected payload file set');

await mkdir(outputDir, { recursive: true, mode: 0o700 });
const stat = await lstat(outputDir);
if (!stat.isDirectory() || stat.isSymbolicLink()) fail('unsafe output directory');
for (const sourceName of EXPECTED_FILES) {
  const value = decode(payload.files[sourceName], sourceName, 1024 * 1024);
  await writeFile(path.join(outputDir, path.basename(sourceName)), value, { mode: 0o600, flag: 'wx' });
}
process.stdout.write(`bundle verified for ${service} at source revision ${envelope.source_revision}\n`);

function parseSigningKeys(value) {
  const blocks = value.match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g);
  if (!blocks?.length) fail('missing signing public key');
  const keys = blocks.map((block) => createPublicKey(block));
  if (keys.some((key) => key.asymmetricKeyType !== 'ed25519')) fail('invalid signing public key');
  return keys;
}
function decode(value, label, limit) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) fail(`${label}: invalid base64`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.length === 0 || decoded.length > limit || decoded.toString('base64') !== value) fail(`${label}: invalid size or encoding`);
  return decoded;
}
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function fail(message) { throw new Error(message); }
