// Builds dist/manifest.json: Windows entries from php.net, macOS entries from macos-entries.json
// (written by the macOS build workflow), Composer and the CA bundle.
// Usage: node scripts/generate.mjs [--windows-only]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validate } from '../lib/manifest.mjs';
import { retrying } from '../lib/retry.mjs';
import { caddyEntries } from './caddy.mjs';
import { nodeEntries } from './node.mjs';
import { headersFor } from './plan.mjs';
import {
  githubDigestEntries,
  mariadbEntries,
  mysqlEntries,
  postgresEntries,
  siloEntries,
  typesenseEntries,
  withFallback,
} from './services.mjs';
import { QA, RELEASES, windowsEntries } from './windows.mjs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
// php.net answers an HTML page instead of JSON to requests without a User-Agent.
const HEADERS = { 'User-Agent': 'hearth-php manifest generator (+https://github.com/wl-lankin/hearth-php)' };

async function get(url) {
  // The GitHub token (rate limits) goes to the GitHub API only.
  const headers = { ...HEADERS, ...headersFor(url, process.env.GH_TOKEN), 'User-Agent': HEADERS['User-Agent'] };
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { status: res.status });
  return res;
}

// The whole read is tried again: a slow download can also drop halfway through the body.
const json = (url) => retrying(async () => (await get(url)).json());
const text = (url) => retrying(async () => (await get(url)).text());
const bytes = (url) => retrying(async () => Buffer.from(await (await get(url)).arrayBuffer()));
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function composer() {
  const { stable } = await json('https://getcomposer.org/versions');
  const version = stable[0].version;
  const url = `https://getcomposer.org/download/${version}/composer.phar`;
  const published = (await text(`${url}.sha256sum`)).trim().split(/\s+/)[0];
  const actual = sha256(await bytes(url));
  if (published !== actual) throw new Error(`composer ${version}: published hash does not match the download`);
  return { version, url, sha256: actual };
}

/** The CA bundle is re-hosted under its hash, so the URL in a manifest never changes content. */
async function cacert() {
  const pem = await bytes('https://curl.se/ca/cacert.pem');
  const published = (await text('https://curl.se/ca/cacert.pem.sha256')).trim().split(/\s+/)[0];
  const hash = sha256(pem);
  if (published !== hash) throw new Error('cacert.pem: published hash does not match the download');
  const file = `cacert-${hash.slice(0, 12)}.pem`;
  writeFileSync(`dist/${file}`, pem);
  return { file, url: `https://github.com/${REPO}/releases/download/manifest/${file}`, sha256: hash };
}

async function caddy() {
  const release = await json('https://api.github.com/repos/caddyserver/caddy/releases/latest');
  const version = release.tag_name.replace(/^v/, '');
  const sums = release.assets.find((a) => a.name === `caddy_${version}_checksums.txt`);
  if (!sums) throw new Error(`caddy ${version}: checksums.txt is missing`);
  const checksums = await text(sums.browser_download_url);
  return caddyEntries({ release, checksums, fetchBytes: bytes });
}

/** The archive's top folder, read with the runner's own unzip/tar ('' when files sit at the top). */
async function peek(buf, file) {
  const path = join(tmpdir(), `peek-${process.pid}-${file}`);
  writeFileSync(path, buf);
  try {
    const list = file.endsWith('.zip') ? execFileSync('unzip', ['-Z1', path]) : execFileSync('tar', ['-tzf', path]);
    const tops = new Set(list.toString().split('\n').filter(Boolean).map((p) => p.split('/')[0]));
    const [only] = tops;
    return tops.size === 1 && list.toString().includes(`${only}/`) ? only : '';
  } finally {
    rmSync(path, { force: true });
  }
}

/** The catalog published now ({} before the first one): its entries are reused instead of downloaded again. */
async function published() {
  try {
    return await json(`https://github.com/${REPO}/releases/download/manifest/manifest.json`);
  } catch {
    return {};
  }
}

const byUrl = (entries) => new Map((entries ?? []).map((e) => [e.url, e]));

/** Every release of a repo: the API lists them by date, not by version, so one page is not enough. */
async function allReleases(repo) {
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await json(`https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

async function services(pins, current) {
  const known = byUrl(current.services);
  const common = { fetchBytes: bytes, peek, known };
  const latest = (repo) => json(`https://api.github.com/repos/${repo}/releases/latest`);
  // One source failing (a vendor down, a release still uploading) keeps its published entries.
  const each = (kind, run) => withFallback(kind, run, known);
  // Redis and MariaDB for macOS: this repo's own builds (services-macos.yml).
  const own = existsSync('services-macos-entries.json') ? JSON.parse(readFileSync('services-macos-entries.json', 'utf8')) : [];
  const groups = await Promise.all([
    each('mysql', () => mysqlEntries({ versions: pins.mysql, fetchText: text, ...common })),
    each('mariadb', () => mariadbEntries({ versions: pins.mariadb, fetchText: text, ...common })),
    each('postgresql', async () => postgresEntries({
      releases: await allReleases('theseus-rs/postgresql-binaries'),
      lines: ['18', '17'], fetchText: text, ...common,
    })),
    each('redis', async () => githubDigestEntries({
      kind: 'redis', release: await latest('redis-windows/redis-windows'), ...common,
      targets: [{ asset: (v) => `Redis-${v}-Windows-x64-msys2.zip`, os: 'windows', arch: 'x64', format: 'zip' }],
    })),
    each('meilisearch', async () => githubDigestEntries({
      kind: 'meilisearch', release: await latest('meilisearch/meilisearch'), ...common,
      targets: [
        { asset: () => 'meilisearch-windows-amd64.exe', os: 'windows', arch: 'x64', format: 'binary' },
        { asset: () => 'meilisearch-macos-apple-silicon', os: 'macos', arch: 'arm64', format: 'binary' },
        { asset: () => 'meilisearch-macos-amd64', os: 'macos', arch: 'x86_64', format: 'binary' },
      ],
    })),
    each('typesense', () => typesenseEntries({ versions: pins.typesense, ...common })),
    each('silo', async () => {
      const silo = await latest('pgsty/silo');
      const sums = silo.assets.find((a) => /_checksums\.txt$/.test(a.name));
      if (!sums) throw new Error('checksums.txt is missing');
      return siloEntries({ release: silo, checksums: await text(sums.browser_download_url), ...common });
    }),
  ]);
  return [...groups.flat(), ...own];
}

/** Node.js; when nodejs.org fails, the published entries are kept. */
async function node(minMajor, current) {
  try {
    return await nodeEntries({ index: await json('https://nodejs.org/dist/index.json'), minMajor, fetchText: text, fetchBytes: bytes, known: byUrl(current.node) });
  } catch (e) {
    console.warn(`node: ${e.message}; keeping the published entries`);
    return current.node ?? [];
  }
}

mkdirSync('dist', { recursive: true });
const windowsOnly = process.argv.includes('--windows-only');
const pins = JSON.parse(readFileSync('pins.json', 'utf8'));
const windows = await windowsEntries({
  feed: await json(`${RELEASES}/releases.json`),
  qaFeed: await json(`${QA}/releases.json`),
  pins,
  hash: async (url) => sha256(await bytes(url)),
});
const macos = !windowsOnly && existsSync('macos-entries.json') ? JSON.parse(readFileSync('macos-entries.json', 'utf8')) : [];
const ca = await cacert();
const current = windowsOnly ? {} : await published();
const manifest = {
  schema: 1,
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  php: [...windows, ...macos],
  composer: await composer(),
  cacert: { url: ca.url, sha256: ca.sha256 },
  tools: { caddy: await caddy() },
  services: windowsOnly ? [] : await services(pins.services, current),
  node: windowsOnly ? [] : await node(pins.node.minMajor, current),
};
const errors = validate(manifest);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`dist/manifest.json: ${manifest.php.length} PHP builds, composer ${manifest.composer.version}, ${ca.file}`);
