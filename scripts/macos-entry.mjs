// Catalog entries for the macOS builds made by .github/workflows/macos.yml.
//   node scripts/macos-entry.mjs entry <version> <arch> <url> <archive>   prints one entry as JSON
//   node scripts/macos-entry.mjs merge <out.json> <in.json...>            merges entry lists into out.json
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const byVersion = (a, b) => a.localeCompare(b, 'en', { numeric: true });

export function macosEntry({ version, arch, url, sha256, size }) {
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
    extensions: { redis: { kind: 'builtin' }, xdebug: { kind: 'zend_so', file: 'lib/xdebug.so' } },
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
    const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    console.log(JSON.stringify(macosEntry({ version, arch, url, sha256, size: statSync(archive).size })));
  } else if (command === 'merge') {
    const [out, ...inputs] = args;
    const read = (f) => (existsSync(f) ? [].concat(JSON.parse(readFileSync(f, 'utf8'))) : []);
    const merged = mergeEntries(...inputs.map(read));
    const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
    merged.forEach((e) => checkEntry(repo, e));
    writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  } else {
    console.error('usage: macos-entry.mjs entry <version> <arch> <url> <archive> | merge <out> <in...>');
    process.exit(2);
  }
}
