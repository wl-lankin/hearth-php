// Builds dist/manifest.json: Windows entries from php.net, macOS entries from macos-entries.json
// (written by the macOS build workflow), Composer and the CA bundle.
// Usage: node scripts/generate.mjs [--windows-only]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { validate } from '../lib/manifest.mjs';
import { QA, RELEASES, windowsEntries } from './windows.mjs';

const REPO = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
// php.net answers an HTML page instead of JSON to requests without a User-Agent.
const HEADERS = { 'User-Agent': 'hearth-php manifest generator (+https://github.com/wl-lankin/hearth-php)' };

async function get(url) {
  const res = await fetch(url, { headers: HEADERS, redirect: 'follow' });
  if (!res.ok) throw Object.assign(new Error(`${url}: HTTP ${res.status}`), { status: res.status });
  return res;
}

const json = async (url) => (await get(url)).json();
const bytes = async (url) => Buffer.from(await (await get(url)).arrayBuffer());
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

async function composer() {
  const { stable } = await json('https://getcomposer.org/versions');
  const version = stable[0].version;
  const url = `https://getcomposer.org/download/${version}/composer.phar`;
  const published = (await (await get(`${url}.sha256sum`)).text()).trim().split(/\s+/)[0];
  const actual = sha256(await bytes(url));
  if (published !== actual) throw new Error(`composer ${version}: published hash does not match the download`);
  return { version, url, sha256: actual };
}

/** The CA bundle is re-hosted under its hash, so the URL in a manifest never changes content. */
async function cacert() {
  const pem = await bytes('https://curl.se/ca/cacert.pem');
  const published = (await (await get('https://curl.se/ca/cacert.pem.sha256')).text()).trim().split(/\s+/)[0];
  const hash = sha256(pem);
  if (published !== hash) throw new Error('cacert.pem: published hash does not match the download');
  const file = `cacert-${hash.slice(0, 12)}.pem`;
  writeFileSync(`dist/${file}`, pem);
  return { file, url: `https://github.com/${REPO}/releases/download/manifest/${file}`, sha256: hash };
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
const manifest = {
  schema: 1,
  generated: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
  php: [...windows, ...macos],
  composer: await composer(),
  cacert: { url: ca.url, sha256: ca.sha256 },
};
const errors = validate(manifest);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
writeFileSync('dist/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`dist/manifest.json: ${manifest.php.length} PHP builds, composer ${manifest.composer.version}, ${ca.file}`);
