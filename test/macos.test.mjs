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

test('only entries pointing at this repo\'s own php release pass the check', async () => {
  const { checkEntry } = await import('../scripts/macos-entry.mjs');
  const repo = 'wl-lankin/hearth-php';
  const good = macosEntry({
    version: '8.4.27', arch: 'arm64', sha256: sha, size: 1,
    url: `https://github.com/${repo}/releases/download/php-8.4.27/php-8.4.27-macos-arm64.tar.gz`,
  });
  assert.doesNotThrow(() => checkEntry(repo, good));
  for (const url of [
    'https://evil.test/php-8.4.27-macos-arm64.tar.gz',
    `https://github.com/someone/else/releases/download/php-8.4.27/php-8.4.27-macos-arm64.tar.gz`,
    `https://github.com/${repo}/releases/download/php-8.4.26/php-8.4.27-macos-arm64.tar.gz`,
    `https://github.com/${repo}/releases/download/php-8.4.27/php-8.4.27-macos-x86_64.tar.gz`,
  ]) {
    assert.throws(() => checkEntry(repo, { ...good, url }), /not a hearth-php macOS build/, url);
  }
  assert.throws(() => checkEntry(repo, { ...good, os: 'windows' }), /not a hearth-php macOS build/);
});

test('entries come straight from the php-<version> releases', async () => {
  const { entriesFromReleases } = await import('../scripts/macos-entry.mjs');
  const repo = 'wl-lankin/hearth-php';
  const asset = (v, arch) => ({
    name: `php-${v}-macos-${arch}.tar.gz`, size: 31000000,
    browser_download_url: `https://github.com/${repo}/releases/download/php-${v}/php-${v}-macos-${arch}.tar.gz`,
  });
  const releases = [
    { tag_name: 'php-8.4.27', assets: [asset('8.4.27', 'arm64'), asset('8.4.27', 'x86_64')] },
    { tag_name: 'php-8.3.36', assets: [asset('8.3.36', 'arm64'), { name: 'notes.txt', browser_download_url: 'x', size: 1 }] },
    { tag_name: 'manifest', assets: [{ name: 'manifest.json', browser_download_url: 'y', size: 1 }] },
    { tag_name: 'php-8.2.35', assets: [asset('8.4.27', 'arm64')] },
  ];
  const hash = async () => 'e'.repeat(64);
  const entries = await entriesFromReleases(repo, releases, hash);
  assert.deepEqual(entries.map((e) => `${e.version}/${e.arch}`), ['8.3.36/arm64', '8.4.27/arm64', '8.4.27/x86_64']);
  assert.equal(entries[0].size, 31000000);
});
