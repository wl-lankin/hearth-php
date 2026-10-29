import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validate } from '../lib/manifest.mjs';
import { nodeEntries } from '../scripts/node.mjs';
import { example } from './fixtures.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const body = (file) => Buffer.from(`archive ${file}`);
const files = (v) => [`node-v${v}-win-x64.zip`, `node-v${v}-darwin-arm64.tar.gz`, `node-v${v}-darwin-x64.tar.gz`];

// An excerpt of https://nodejs.org/dist/index.json: newest first, `lts` a codename or false.
const index = [
  { version: 'v25.1.0', lts: false, files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v25.0.0', lts: false, files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v24.11.0', lts: 'Krypton', files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v22.21.1', lts: 'Jod', files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v22.21.0', lts: 'Jod', files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v20.19.5', lts: 'Iron', files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
  { version: 'v18.20.8', lts: 'Hydrogen', files: ['win-x64-zip', 'osx-arm64-tar', 'osx-x64-tar'] },
];

const shasums = (v, hash = sha) => `${files(v).map((f) => `${hash(body(f))}  ${f}`).join('\n')}\nabc  node-v${v}.tar.gz\n`;

function fakeNet() {
  const downloads = [];
  return {
    downloads,
    fetchText: async (url) => shasums(/\/v([\d.]+)\//.exec(url)[1]),
    fetchBytes: async (url) => {
      downloads.push(url);
      return body(url.split('/').pop());
    },
  };
}

test('the newest release of every major from minMajor up, for three targets', async () => {
  const net = fakeNet();
  const entries = await nodeEntries({ index, minMajor: 20, ...net, known: new Map() });
  assert.deepEqual([...new Set(entries.map((e) => e.version))], ['25.1.0', '24.11.0', '22.21.1', '20.19.5']);
  const v22 = entries.filter((e) => e.major === 22);
  assert.deepEqual(v22.map((e) => [e.os, e.arch, e.format, e.root]), [
    ['windows', 'x64', 'zip', 'node-v22.21.1-win-x64'],
    ['macos', 'arm64', 'tar.gz', 'node-v22.21.1-darwin-arm64'],
    ['macos', 'x86_64', 'tar.gz', 'node-v22.21.1-darwin-x64'],
  ]);
  assert.equal(v22[0].url, 'https://nodejs.org/dist/v22.21.1/node-v22.21.1-win-x64.zip');
  assert.equal(v22[0].sha256, sha(body('node-v22.21.1-win-x64.zip')));
  assert.equal(v22[0].lts, 'Jod');
  assert.equal(entries.find((e) => e.major === 25).lts, null, 'a current release has no LTS name');
});

test('a download that does not match SHASUMS256.txt is refused', async () => {
  const net = { ...fakeNet(), fetchBytes: async () => Buffer.from('tampered') };
  await assert.rejects(nodeEntries({ index, minMajor: 24, ...net, known: new Map() }), /node-v25\.1\.0-win-x64\.zip: checksum mismatch/);
});

test('a file missing from SHASUMS256.txt is named', async () => {
  const net = { ...fakeNet(), fetchText: async () => 'abc  node-v25.1.0.tar.gz\n' };
  await assert.rejects(nodeEntries({ index, minMajor: 25, ...net, known: new Map() }), /node-v25\.1\.0-win-x64\.zip is not in SHASUMS256\.txt/);
});

test('a published entry with the same hash is reused without a download', async () => {
  const first = await nodeEntries({ index, minMajor: 24, ...fakeNet(), known: new Map() });
  const known = new Map(first.map((e) => [e.url, e]));
  const net = fakeNet();
  assert.deepEqual(await nodeEntries({ index, minMajor: 24, ...net, known }), first);
  assert.deepEqual(net.downloads, []);
  // A published entry whose hash no longer matches what nodejs.org states is downloaded again.
  known.get(first[0].url).sha256 = 'b'.repeat(64);
  await nodeEntries({ index, minMajor: 24, ...net, known });
  assert.deepEqual(net.downloads, [first[0].url]);
});

test('the catalog accepts node and checks its fields', async () => {
  const entries = await nodeEntries({ index, minMajor: 24, ...fakeNet(), known: new Map() });
  assert.deepEqual(validate({ ...example, node: entries }), []);
  const broken = structuredClone(entries);
  delete broken[1].sha256;
  broken[2].os = 'linux';
  delete broken[0].root;
  const errors = validate({ ...example, node: broken });
  for (const e of ['node[1].sha256 missing', 'node[2].os linux unknown', 'node[0].root missing']) assert.ok(errors.includes(e), errors.join('\n'));
});
