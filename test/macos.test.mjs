import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/manifest.mjs';
import { macosEntry, mergeEntries } from '../scripts/macos-entry.mjs';

const sha = 'e'.repeat(64);
const entry = (version, arch) =>
  macosEntry({ version, arch, url: `https://x/${version}-${arch}.tar.gz`, sha256: sha, size: 31000000 });

test('a macOS build entry has the builtin redis and the shared xdebug', () => {
  assert.deepEqual(entry('8.4.27', 'arm64'), {
    minor: '8.4', version: '8.4.27', channel: 'stable', os: 'macos', arch: 'arm64',
    url: 'https://x/8.4.27-arm64.tar.gz', sha256: sha, size: 31000000, format: 'tar.gz', root: 'php-8.4.27',
    extensions: { redis: { kind: 'builtin' }, xdebug: { kind: 'zend_so', file: 'lib/xdebug.so' } },
  });
  const manifest = {
    schema: 1, generated: 'x', php: [entry('8.4.27', 'x86_64')],
    composer: { url: 'https://x', sha256: sha }, cacert: { url: 'https://x', sha256: sha },
  };
  assert.deepEqual(validate(manifest), []);
});

test('an RC version is marked as a preview', () => {
  assert.equal(entry('8.6.0RC4', 'arm64').channel, 'rc');
});

test('merging keeps one build per minor and arch, the newest version wins', () => {
  const old = [entry('8.4.26', 'arm64'), entry('8.4.26', 'x86_64'), entry('8.3.36', 'arm64')];
  const merged = mergeEntries(old, [entry('8.4.27', 'arm64')]);
  assert.deepEqual(
    merged.map((e) => `${e.version}/${e.arch}`),
    ['8.3.36/arm64', '8.4.26/x86_64', '8.4.27/arm64'],
  );
});
