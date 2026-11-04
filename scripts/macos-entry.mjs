// Catalog entries for the macOS builds made by .github/workflows/macos.yml.
//   node scripts/macos-entry.mjs entry <version> <arch> <url> <archive>   prints one entry as JSON
//   node scripts/macos-entry.mjs releases <out.json>                      entries of every released macOS build
//   node scripts/macos-entry.mjs merge <out.json> <in.json...>            merges entry lists into out.json
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true });

/**
 * Whether the tar.gz in `gz` holds a regular file at `path`. Reads ustar headers (with their
 * prefix field) and pax `path` records, which is what macOS tar writes.
 */
export function tarHas(gz, path) {
  const tar = gunzipSync(gz);
  const text = (from, len) => tar.subarray(from, from + len).toString('utf8').replace(/\0.*$/s, '');
  let paxPath = null;
  for (let at = 0; at + 512 <= tar.length; ) {
    if (tar.subarray(at, at + 512).every((b) => b === 0)) break;
    const size = parseInt(text(at + 124, 12).trim() || '0', 8);
    const type = text(at + 156, 1) || '0';
    const prefix = text(at + 257, 6) === 'ustar' ? text(at + 345, 155) : '';
    const body = tar.subarray(at + 512, at + 512 + size);
    if (type === 'x') {
      // Records "<length> key=value\n": only the path matters here.
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(`\n${body.toString('utf8')}`)?.[1] ?? null;
    } else {
      const name = paxPath ?? (prefix ? `${prefix}/${text(at, 100)}` : text(at, 100));
      paxPath = null;
      if (type === '0' && name.replace(/^\.\//, '') === path) return true;
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return false;
}

/** The SHA-256 of a PHP archive and whether it has SPX (`<root>/lib/spx.so`). */
export function archiveFacts(gz, root) {
  return { sha256: createHash('sha256').update(gz).digest('hex'), spx: tarHas(gz, `${root}/lib/spx.so`) };
}

export function macosEntry({ version, arch, url, sha256, size, spx = false }) {
  const extensions = { redis: { kind: 'builtin' }, xdebug: { kind: 'zend_so', file: 'lib/xdebug.so' } };
  // Only builds from before SPX was added lack it: their entries must not promise it.
  if (spx) extensions.spx = { kind: 'so', file: 'lib/spx.so' };
  return {
    minor: version.split('.').slice(0, 2).join('.'),
    version,
    channel: /(RC|alpha|beta)\d*$/i.test(version) ? 'rc' : 'stable',
    os: 'macos',
    arch,
    url,
    sha256,
    size,
    format: 'tar.gz',
    root: `php-${version}`,
    extensions,
  };
}

/**
 * Throws unless `e` is a macOS build released by this repo: the list of earlier builds is read back
 * from a release asset before it is signed again, so it must not be able to point anywhere else.
 */
export function checkEntry(repo, e) {
  const expected = `https://github.com/${repo}/releases/download/php-${e.version}/php-${e.version}-macos-${e.arch}.tar.gz`;
  if (e.os !== 'macos' || e.url !== expected || !/^[0-9a-f]{64}$/.test(e.sha256 ?? '')) {
    throw new Error(`${e.url} is not a hearth-php macOS build`);
  }
}

/**
 * The catalog entries of every macOS build already released here: archives named
 * php-<version>-macos-<arch>.tar.gz in the release php-<version>. `inspect(url)` returns an
 * archive's `archiveFacts`. The releases are the source of truth, so no entry depends on an earlier
 * catalog.
 */
export async function entriesFromReleases(repo, releases, inspect) {
  const entries = [];
  for (const release of releases) {
    const version = release.tag_name.startsWith('php-') ? release.tag_name.slice(4) : null;
    if (!version) continue;
    for (const asset of release.assets) {
      const match = /^php-(.+)-macos-(arm64|x86_64)\.tar\.gz$/.exec(asset.name);
      if (!match || match[1] !== version) continue;
      const url = `https://github.com/${repo}/releases/download/php-${version}/${asset.name}`;
      const { sha256, spx } = await inspect(url);
      entries.push(macosEntry({ version, arch: match[2], url, sha256, spx, size: asset.size }));
    }
  }
  return mergeEntries(entries);
}

/** One entry per minor and arch (the newest version wins), sorted by version, then arch. */
export function mergeEntries(...lists) {
  const best = new Map();
  for (const e of lists.flat()) {
    const key = `${e.minor}/${e.arch}`;
    const current = best.get(key);
    if (!current || byVersion(e.version, current.version) > 0) best.set(key, e);
  }
  return [...best.values()].sort((a, b) => byVersion(a.version, b.version) || a.arch.localeCompare(b.arch));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'entry') {
    const [version, arch, url, archive] = args;
    const { sha256, spx } = archiveFacts(readFileSync(archive), `php-${version}`);
    console.log(JSON.stringify(macosEntry({ version, arch, url, sha256, spx, size: statSync(archive).size })));
  } else if (command === 'releases') {
    const [out] = args;
    const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
    const { headersFor } = await import('./plan.mjs');
    const api = `https://api.github.com/repos/${repo}/releases?per_page=100`;
    const releases = await (await fetch(api, { headers: headersFor(api, process.env.GH_TOKEN) })).json();
    const inspect = async (url) => {
      const res = await fetch(url, { headers: { 'User-Agent': 'hearth-php' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
      const version = /\/php-([^/]+)\/php-/.exec(url)[1];
      return archiveFacts(Buffer.from(await res.arrayBuffer()), `php-${version}`);
    };
    const entries = await entriesFromReleases(repo, Array.isArray(releases) ? releases : [], inspect);
    entries.forEach((e) => checkEntry(repo, e));
    writeFileSync(out, `${JSON.stringify(entries, null, 2)}\n`);
    console.log(`${out}: ${entries.length} macOS builds`);
  } else if (command === 'merge') {
    const [out, ...inputs] = args;
    const read = (f) => (existsSync(f) ? [].concat(JSON.parse(readFileSync(f, 'utf8'))) : []);
    const merged = mergeEntries(...inputs.map(read));
    const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
    merged.forEach((e) => checkEntry(repo, e));
    writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  } else {
    console.error('usage: macos-entry.mjs entry <version> <arch> <url> <archive> | releases <out> | merge <out> <in...>');
    process.exit(2);
  }
}
