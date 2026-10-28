import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validate } from '../lib/manifest.mjs';
import {
  githubDigestEntries,
  withFallback,
  mariadbEntries,
  mysqlEntries,
  postgresEntries,
  siloEntries,
  typesenseEntries,
} from '../scripts/services.mjs';
import { example } from './fixtures.mjs';

const body = (name) => Buffer.from(`archive ${name}`);
const sha = (algo, buf) => createHash(algo).update(buf).digest('hex');
const name = (url) => url.split('/').pop();
const fetchBytes = async (url) => body(name(url));
// What the archive's top folder would be, as the generator reads it from the file.
const peek = async (_bytes, file) => file.replace(/\.(zip|tar\.gz)$/, '');

test('MySQL from Oracle, checked against the published MD5', async () => {
  const fetchText = async (url) => `${sha('md5', body(name(url.replace(/\.md5$/, ''))))}  ${name(url.replace(/\.md5$/, ''))}\n`;
  const entries = await mysqlEntries({ versions: ['8.4.11'], fetchText, fetchBytes, peek });
  assert.deepEqual(entries.map((e) => [e.os, e.arch, e.line, e.version, e.format, e.root]), [
    ['windows', 'x64', '8.4', '8.4.11', 'zip', 'mysql-8.4.11-winx64'],
    ['macos', 'arm64', '8.4', '8.4.11', 'tar.gz', 'mysql-8.4.11-macos15-arm64'],
    ['macos', 'x86_64', '8.4', '8.4.11', 'tar.gz', 'mysql-8.4.11-macos15-x86_64'],
  ]);
  assert.equal(entries[0].url, 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.11-winx64.zip');
  assert.equal(entries[0].kind, 'mysql');
  assert.equal(entries[0].sha256, sha('sha256', body('mysql-8.4.11-winx64.zip')));
  const wrong = async () => `${'0'.repeat(32)}  x\n`;
  await assert.rejects(mysqlEntries({ versions: ['8.4.11'], fetchText: wrong, fetchBytes, peek }), /mysql-8\.4\.11-winx64\.zip: checksum mismatch/);
});

test('MariaDB for Windows from the archive, checked against sha256sums.txt', async () => {
  const file = 'mariadb-11.8.9-winx64.zip';
  // The archive's list names every file as ./<file>.
  const fetchText = async () => `${sha('sha256', body(file))}  ./${file}\n${'b'.repeat(64)}  ./other.msi\n`;
  const [entry] = await mariadbEntries({ versions: ['11.8.9'], fetchText, fetchBytes, peek });
  assert.deepEqual([entry.kind, entry.line, entry.os, entry.arch, entry.root], ['mariadb', '11.8', 'windows', 'x64', 'mariadb-11.8.9-winx64']);
  assert.equal(entry.url, 'https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip');
});

test('PostgreSQL: the newest release of each line, checked against its .sha256', async () => {
  const assets = (v) => ['x86_64-pc-windows-msvc.zip', 'aarch64-apple-darwin.tar.gz', 'x86_64-apple-darwin.tar.gz', 'x86_64-unknown-linux-gnu.tar.gz']
    .flatMap((t) => [`postgresql-${v}-${t}`, `postgresql-${v}-${t}.sha256`])
    .map((n) => ({ name: n, browser_download_url: `https://github.com/theseus-rs/postgresql-binaries/releases/download/${v}/${n}` }));
  const releases = ['18.6.1', '18.5.0', '17.11.0'].map((v) => ({ tag_name: v, prerelease: false, assets: assets(v) }));
  const fetchText = async (url) => `${sha('sha256', body(name(url.replace(/\.sha256$/, ''))))}  ${name(url)}\n`;
  const entries = await postgresEntries({ releases, lines: ['18', '17'], fetchText, fetchBytes, peek });
  assert.deepEqual(entries.map((e) => [e.line, e.version, e.os, e.arch]), [
    ['18', '18.6.1', 'windows', 'x64'], ['18', '18.6.1', 'macos', 'arm64'], ['18', '18.6.1', 'macos', 'x86_64'],
    ['17', '17.11.0', 'windows', 'x64'], ['17', '17.11.0', 'macos', 'arm64'], ['17', '17.11.0', 'macos', 'x86_64'],
  ]);
});

test('Redis for Windows and Meilisearch from GitHub releases, checked against the asset digest', async () => {
  const asset = (n, tag) => ({
    name: n,
    browser_download_url: `https://github.com/x/y/releases/download/${tag}/${n}`,
    digest: `sha256:${sha('sha256', body(n))}`,
  });
  const redis = { tag_name: '8.10.3', assets: [asset('Redis-8.10.3-Windows-x64-msys2.zip', '8.10.3'), asset('Redis-8.10.3-Windows-x64-cygwin.zip', '8.10.3')] };
  const [r] = await githubDigestEntries({
    kind: 'redis', release: redis, fetchBytes, peek,
    targets: [{ asset: (v) => `Redis-${v}-Windows-x64-msys2.zip`, os: 'windows', arch: 'x64', format: 'zip' }],
  });
  assert.deepEqual([r.kind, r.line, r.version, r.format, r.root], ['redis', '8', '8.10.3', 'zip', 'Redis-8.10.3-Windows-x64-msys2']);
  const meili = { tag_name: 'v1.56.0', assets: ['meilisearch-windows-amd64.exe', 'meilisearch-macos-apple-silicon', 'meilisearch-enterprise-windows-amd64.exe'].map((n) => asset(n, 'v1.56.0')) };
  const [m] = await githubDigestEntries({
    kind: 'meilisearch', release: meili, fetchBytes, peek,
    targets: [{ asset: () => 'meilisearch-windows-amd64.exe', os: 'windows', arch: 'x64', format: 'binary' }],
  });
  assert.deepEqual([m.line, m.version, m.format, m.root], ['1', '1.56.0', 'binary', '']);
  const tampered = async () => Buffer.from('tampered');
  await assert.rejects(
    githubDigestEntries({ kind: 'meilisearch', release: meili, fetchBytes: tampered, peek, targets: [{ asset: () => 'meilisearch-windows-amd64.exe', os: 'windows', arch: 'x64', format: 'binary' }] }),
    /meilisearch-windows-amd64\.exe: checksum mismatch/,
  );
});

test('a published entry is reused only when the vendor still states the same SHA-256', async () => {
  const n = 'meilisearch-windows-amd64.exe';
  const url = `https://github.com/x/y/releases/download/v1.56.0/${n}`;
  const vendor = sha('sha256', body(n));
  const release = { tag_name: 'v1.56.0', assets: [{ name: n, browser_download_url: url, digest: `sha256:${vendor}` }] };
  const targets = [{ asset: () => n, os: 'windows', arch: 'x64', format: 'binary' }];
  let downloads = 0;
  const counting = async (u) => {
    downloads += 1;
    return fetchBytes(u);
  };
  const entry = (hash) => ({ kind: 'meilisearch', line: '1', version: '1.56.0', os: 'windows', arch: 'x64', url, sha256: hash, format: 'binary', root: '' });
  const same = await githubDigestEntries({ kind: 'meilisearch', release, targets, fetchBytes: counting, peek, known: new Map([[url, entry(vendor)]]) });
  assert.equal(downloads, 0, 'the vendor hash vouches for the published entry');
  assert.deepEqual(same[0], entry(vendor));
  // A published entry that the vendor's hash does not back (tampered, or the file changed) is redone.
  const redone = await githubDigestEntries({ kind: 'meilisearch', release, targets, fetchBytes: counting, peek, known: new Map([[url, entry('c'.repeat(64))]]) });
  assert.equal(downloads, 1);
  assert.equal(redone[0].sha256, vendor);
  // Without any vendor hash (Typesense) there is nothing to vouch for a published entry.
  const ts = 'https://dl.typesense.org/releases/30.2/typesense-server-30.2-darwin-arm64.tar.gz';
  const tsEntry = { kind: 'typesense', line: '30', version: '30.2', os: 'macos', arch: 'arm64', url: ts, sha256: 'c'.repeat(64), format: 'tar.gz', root: '' };
  await typesenseEntries({ versions: ['30.2'], fetchBytes: counting, peek, known: new Map([[ts, tsEntry]]) });
  assert.equal(downloads, 3, 'both Typesense builds were downloaded again');
});

test('Silo from its release, checked against checksums.txt; its files carry their own version', async () => {
  // Silo tags like MinIO (RELEASE.<date>) but names its files with a number: read it from checksums.txt.
  const v = '20261026000000.0.0';
  const files = ['windows_amd64.zip', 'darwin_arm64.tar.gz', 'darwin_amd64.tar.gz'].map((s) => `silo_${v}_${s}`);
  const tag = 'RELEASE.2026-10-26T00-00-00Z';
  const release = { tag_name: tag, assets: [...files, `silo_${v}_checksums.txt`, `silo_${v}_amd64.deb`].map((n) => ({ name: n, browser_download_url: `https://github.com/pgsty/silo/releases/download/${tag}/${n}` })) };
  const checksums = files.map((f) => `${sha('sha256', body(f))}  ${f}`).join('\n');
  const entries = await siloEntries({ release, checksums, fetchBytes, peek });
  assert.deepEqual(entries.map((e) => [e.kind, e.line, e.version, e.os, e.arch, e.format]), [
    ['silo', 'current', v, 'windows', 'x64', 'zip'], ['silo', 'current', v, 'macos', 'arm64', 'tar.gz'], ['silo', 'current', v, 'macos', 'x86_64', 'tar.gz'],
  ]);
});

test('Typesense for macOS only, hashed when the catalog is built', async () => {
  const entries = await typesenseEntries({ versions: ['30.2'], fetchBytes, peek });
  assert.deepEqual(entries.map((e) => [e.line, e.os, e.arch]), [['30', 'macos', 'arm64'], ['30', 'macos', 'x86_64']]);
  assert.equal(entries[0].url, 'https://dl.typesense.org/releases/30.2/typesense-server-30.2-darwin-arm64.tar.gz');
});

test('the catalog accepts services and checks them', async () => {
  const entries = await typesenseEntries({ versions: ['30.2'], fetchBytes, peek });
  assert.deepEqual(validate({ ...example, services: entries }), []);
  const broken = structuredClone(entries);
  broken[0].kind = 'oracle';
  delete broken[1].sha256;
  const errors = validate({ ...example, services: broken });
  assert.ok(errors.includes('services[0].kind oracle unknown'), errors.join('\n'));
  assert.ok(errors.includes('services[1].sha256 missing'), errors.join('\n'));
});

test('a source that fails keeps its published entries, without the own macOS builds', async () => {
  const known = new Map([
    ['https://cdn.mysql.com/a.zip', { kind: 'mysql', url: 'https://cdn.mysql.com/a.zip' }],
    ['https://github.com/wl-lankin/hearth-php/releases/download/redis-8/r.tar.gz', { kind: 'redis', url: 'https://github.com/wl-lankin/hearth-php/releases/download/redis-8/r.tar.gz' }],
    ['https://github.com/redis-windows/r.zip', { kind: 'redis', url: 'https://github.com/redis-windows/r.zip' }],
  ]);
  const warnings = [];
  const failing = async () => {
    throw new Error('HTTP 503');
  };
  const redis = await withFallback('redis', failing, known, (w) => warnings.push(w));
  assert.deepEqual(redis.map((e) => e.url), ['https://github.com/redis-windows/r.zip']);
  assert.match(warnings[0], /redis: HTTP 503; keeping the published entries/);
  const fine = await withFallback('mysql', async () => [{ kind: 'mysql', url: 'new' }], known, () => {});
  assert.deepEqual(fine.map((e) => e.url), ['new']);
});
