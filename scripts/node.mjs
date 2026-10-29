// Node.js from nodejs.org: the newest release of every major from `minMajor` up. Each file is
// checked against the release's SHASUMS256.txt (fetched over TLS; its GPG signature is not
// checked) before it goes into the signed catalog.
import { createHash } from 'node:crypto';

const TARGETS = [
  { file: 'win-x64-zip', suffix: 'win-x64', ext: 'zip', os: 'windows', arch: 'x64', format: 'zip' },
  { file: 'osx-arm64-tar', suffix: 'darwin-arm64', ext: 'tar.gz', os: 'macos', arch: 'arm64', format: 'tar.gz' },
  { file: 'osx-x64-tar', suffix: 'darwin-x64', ext: 'tar.gz', os: 'macos', arch: 'x86_64', format: 'tar.gz' },
];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** `index` is nodejs.org/dist/index.json (newest first). `known` maps a published URL to its entry:
 * it is reused only when SHASUMS256.txt states the same hash, otherwise the file is downloaded and
 * checked again. */
export async function nodeEntries({ index, minMajor, fetchText, fetchBytes, known }) {
  const newest = new Map();
  for (const release of index) {
    const major = Number(release.version.replace(/^v/, '').split('.')[0]);
    if (major >= minMajor && !newest.has(major)) newest.set(major, release);
  }
  const entries = [];
  for (const [major, release] of newest) {
    const version = release.version.replace(/^v/, '');
    const base = `https://nodejs.org/dist/v${version}`;
    const sums = new Map(
      (await fetchText(`${base}/SHASUMS256.txt`)).split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2).map(([h, f]) => [f, h.toLowerCase()]),
    );
    for (const t of TARGETS.filter((t) => release.files.includes(t.file))) {
      const root = `node-v${version}-${t.suffix}`;
      const file = `${root}.${t.ext}`;
      const url = `${base}/${file}`;
      const expected = sums.get(file);
      if (!expected) throw new Error(`${file} is not in SHASUMS256.txt`);
      const prior = known.get(url);
      if (prior && prior.sha256 === expected) {
        entries.push({ ...prior });
        continue;
      }
      if (sha256(await fetchBytes(url)) !== expected) throw new Error(`${file}: checksum mismatch`);
      entries.push({ major, version, lts: release.lts || null, os: t.os, arch: t.arch, url, sha256: expected, format: t.format, root });
    }
  }
  return entries;
}
