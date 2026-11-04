import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { validate } from '../lib/manifest.mjs';
import { archiveFacts, macosEntry, mergeEntries, tarHas } from '../scripts/macos-entry.mjs';

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

test('spx is listed only for a build that has it', () => {
  assert.equal(entry('8.4.27', 'arm64').extensions.spx, undefined);
  const withSpx = macosEntry({ version: '8.4.27', arch: 'arm64', url: 'https://x', sha256: sha, size: 1, spx: true });
  assert.deepEqual(withSpx.extensions.spx, { kind: 'so', file: 'lib/spx.so' });
});

/** A tar.gz of `entries` ({name, type: '0' file or '5' folder, body}), with an optional pax header. */
function tarGz(entries) {
  const blocks = [];
  const header = (name, type, size) => {
    const h = Buffer.alloc(512);
    h.write(name.slice(0, 100), 0);
    h.write('0000644\0', 100);
    h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
    h.write(type, 156);
    h.write('ustar\0', 257);
    h.write('00', 263);
    return h;
  };
  for (const e of entries) {
    const body = Buffer.from(e.body ?? '');
    blocks.push(header(e.name, e.type ?? '0', body.length), body, Buffer.alloc((512 - (body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test('tarHas finds a file in a tar.gz, also behind a pax path and after other files', () => {
  // A pax record is "<length> path=<path>\n", the length counting its own digits.
  const pax = (path) => {
    const body = ` path=${path}\n`;
    let len = body.length + 1;
    while (String(len).length + body.length !== len) len += 1;
    return `${len}${body}`;
  };
  const archive = tarGz([
    { name: 'php-8.4.27/', type: '5' },
    { name: 'php-8.4.27/bin/php', body: 'x'.repeat(700) },
    { name: 'PaxHeader/spx', type: 'x', body: pax('php-8.4.27/lib/spx.so') },
    { name: 'php-8.4.27/lib/sp', body: 'so' },
    { name: 'php-8.4.27/lib/xdebug.so', body: 'so' },
  ]);
  assert.equal(tarHas(archive, 'php-8.4.27/lib/spx.so'), true);
  assert.equal(tarHas(archive, 'php-8.4.27/lib/xdebug.so'), true);
  assert.equal(tarHas(archive, 'php-8.4.27/lib/sp'), false, 'the pax path replaced this name');
  assert.equal(tarHas(archive, 'php-8.4.27/lib/redis.so'), false);
  assert.equal(tarHas(archive, 'php-8.4.27'), false, 'a folder is not a file');
});

test('entries from releases list spx only where the archive holds it', async () => {
  const { entriesFromReleases } = await import('../scripts/macos-entry.mjs');
  const repo = 'wl-lankin/hearth-php';
  const asset = (v, arch) => ({ name: `php-${v}-macos-${arch}.tar.gz`, size: 1 });
  const releases = [
    { tag_name: 'php-8.4.27', assets: [asset('8.4.27', 'arm64')] },
    { tag_name: 'php-8.3.36', assets: [asset('8.3.36', 'arm64')] },
  ];
  const archives = {
    '8.4.27': tarGz([{ name: 'php-8.4.27/lib/spx.so', body: 'so' }]),
    '8.3.36': tarGz([{ name: 'php-8.3.36/lib/xdebug.so', body: 'so' }]),
  };
  const inspect = async (url) => {
    const version = /php-([^/]+)\/php-/.exec(url)[1];
    return archiveFacts(archives[version], `php-${version}`);
  };
  const entries = await entriesFromReleases(repo, releases, inspect);
  assert.deepEqual(entries.map((e) => `${e.version}:${e.extensions.spx?.kind ?? '-'}`), ['8.3.36:-', '8.4.27:so']);
  assert.match(entries[0].sha256, /^[0-9a-f]{64}$/);
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
  const inspect = async () => ({ sha256: 'e'.repeat(64), spx: false });
  const entries = await entriesFromReleases(repo, releases, inspect);
  assert.deepEqual(entries.map((e) => `${e.version}/${e.arch}`), ['8.3.36/arm64', '8.4.27/arm64', '8.4.27/x86_64']);
  assert.equal(entries[0].size, 31000000);
});
