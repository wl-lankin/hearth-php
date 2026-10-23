// The Windows part of the catalog: official php.net NTS x64 zips plus the official PECL Windows
// builds of redis and xdebug. php.net publishes hashes for PHP; PECL does not, so those are hashed here.
import { peclZipName, pickLatest } from '../lib/manifest.mjs';

export const RELEASES = 'https://downloads.php.net/~windows/releases';
export const QA = 'https://downloads.php.net/~windows/qa';
export const PECL = 'https://downloads.php.net/~windows/pecl/releases';
export const SUPPORTED = ['8.1', '8.2', '8.3', '8.4', '8.5'];

const EXTENSIONS = [
  { name: 'redis', kind: 'dll' },
  { name: 'xdebug', kind: 'zend_dll' },
];

const minorNumber = (m) => Number(m.replace('.', '.0'));

/** Previews: QA releases (RC, alpha, beta; never -dev snapshots) of minors newer than every stable one. */
function previews(feed, qaFeed) {
  const newestStable = Math.max(...Object.keys(feed).map(minorNumber));
  const minors = Object.keys(qaFeed).filter(
    (m) => minorNumber(m) > newestStable && /(RC|alpha|beta)\d*$/i.test(qaFeed[m].version),
  );
  return pickLatest(qaFeed, minors);
}

/**
 * Catalog entries for Windows. `hash(url)` downloads a file and resolves to its SHA-256; it rejects
 * with `status: 404` when the file does not exist, which drops only that extension.
 */
export async function windowsEntries({ feed, qaFeed, pins, hash }) {
  const builds = [
    ...pickLatest(feed, SUPPORTED).map((b) => ({ ...b, channel: 'stable', url: `${RELEASES}/${b.path}` })),
    ...previews(feed, qaFeed).map((b) => ({ ...b, channel: 'rc', url: `${QA}/${b.path}` })),
  ];
  const entries = [];
  for (const b of builds) {
    const extensions = {};
    for (const { name, kind } of EXTENSIONS) {
      const version = pins[name];
      const url = `${PECL}/${name}/${version}/${peclZipName(name, version, b.minor, b.vs)}`;
      try {
        extensions[name] = { version, kind, file: `php_${name}.dll`, sha256: await hash(url), url };
      } catch (e) {
        if (e.status !== 404) throw e;
      }
    }
    entries.push({
      minor: b.minor, version: b.version, channel: b.channel, os: 'windows', arch: 'x64',
      url: b.url, sha256: b.sha256, size: b.size, format: 'zip', root: '', extensions,
    });
  }
  return entries;
}
