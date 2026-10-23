import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validate } from '../lib/manifest.mjs';
import { caddyEntries } from '../scripts/caddy.mjs';
import { example } from './fixtures.mjs';

const body = (name) => Buffer.from(`archive ${name}`);
const sha = (algo, buf) => createHash(algo).update(buf).digest('hex');
const files = ['caddy_2.11.7_windows_amd64.zip', 'caddy_2.11.7_mac_arm64.tar.gz', 'caddy_2.11.7_mac_amd64.tar.gz'];
const release = {
  tag_name: 'v2.11.7',
  assets: [...files, 'caddy_2.11.7_linux_amd64.tar.gz'].map((name) => ({
    name,
    browser_download_url: `https://github.com/caddyserver/caddy/releases/download/v2.11.7/${name}`,
  })),
};
const checksums = files.map((f) => `${sha('sha512', body(f))}  ${f}`).join('\n');
const fetchBytes = async (url) => body(url.split('/').pop());

test('one Caddy entry per supported OS and architecture, hashed for the catalog', async () => {
  const entries = await caddyEntries({ release, checksums, fetchBytes });
  assert.deepEqual(entries.map((e) => [e.os, e.arch, e.format, e.binary]), [
    ['windows', 'x64', 'zip', 'caddy.exe'],
    ['macos', 'arm64', 'tar.gz', 'caddy'],
    ['macos', 'x86_64', 'tar.gz', 'caddy'],
  ]);
  assert.equal(entries[0].version, '2.11.7');
  assert.equal(entries[0].sha256, sha('sha256', body(files[0])));
});

test('a download that does not match the published SHA-512 is refused', async () => {
  const bad = async () => Buffer.from('tampered');
  await assert.rejects(caddyEntries({ release, checksums, fetchBytes: bad }), /caddy_2\.11\.7_windows_amd64\.zip: checksum mismatch/);
});

test('the catalog accepts tools.caddy and checks its hashes', async () => {
  const entries = await caddyEntries({ release, checksums, fetchBytes });
  assert.deepEqual(validate({ ...example, tools: { caddy: entries } }), []);
  const broken = structuredClone(entries);
  delete broken[1].sha256;
  assert.ok(validate({ ...example, tools: { caddy: broken } }).includes('tools.caddy[1].sha256 missing'));
});
