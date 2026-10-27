import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entriesFromReleases, planBuilds } from '../scripts/services-macos.mjs';

const release = (tag, files) => ({
  tag_name: tag,
  assets: files.map((name) => ({ name, browser_download_url: `https://github.com/wl-lankin/hearth-php/releases/download/${tag}/${name}` })),
});

test('only versions without both macOS builds are planned', () => {
  const releases = [
    release('redis-8.10.3', ['redis-8.10.3-macos-arm64.tar.gz', 'redis-8.10.3-macos-x86_64.tar.gz']),
    release('mariadb-11.8.9', ['mariadb-11.8.9-macos-arm64.tar.gz']),
  ];
  assert.deepEqual(planBuilds({ redis: ['8.10.3'], mariadb: ['11.8.9', '12.3.3'], releases }), [
    { kind: 'mariadb', version: '11.8.9' },
    { kind: 'mariadb', version: '12.3.3' },
  ]);
});

test('the catalog entries come from the releases and are hashed', async () => {
  const releases = [
    release('redis-8.10.3', ['redis-8.10.3-macos-arm64.tar.gz', 'redis-8.10.3-macos-x86_64.tar.gz', 'notes.txt']),
    release('php-8.4.27', ['php-8.4.27-macos-arm64.tar.gz']),
    release('mariadb-12.3.3', ['mariadb-12.3.3-macos-arm64.tar.gz']),
  ];
  const hash = async (url) => `${url.length.toString(16).padStart(64, '0')}`;
  const entries = await entriesFromReleases({ releases, hash });
  assert.deepEqual(entries.map((e) => [e.kind, e.line, e.version, e.arch, e.root, e.format]), [
    ['redis', '8', '8.10.3', 'arm64', 'redis-8.10.3', 'tar.gz'],
    ['redis', '8', '8.10.3', 'x86_64', 'redis-8.10.3', 'tar.gz'],
    ['mariadb', '12.3', '12.3.3', 'arm64', 'mariadb-12.3.3', 'tar.gz'],
  ]);
  assert.ok(entries.every((e) => e.os === 'macos' && /^[0-9a-f]{64}$/.test(e.sha256)));
});
