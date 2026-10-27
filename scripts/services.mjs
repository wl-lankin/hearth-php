// The services Hearth runs (databases, Redis, search, S3), one catalog entry per kind, version
// line, OS and architecture. Every download is checked against what its publisher states (MD5,
// SHA-256 list, GitHub asset digest) before its SHA-256 goes into the signed catalog. Typesense
// publishes no hashes: its entries are hashed when the catalog is built and pinned by the signature.
//
// `peek(bytes, file)` returns the archive's top folder ('' for a single program).
import { createHash } from 'node:crypto';

const digest = (algo, buf) => createHash(algo).update(buf).digest('hex');
const fileOf = (url) => url.split('/').pop();
const lineOf = (version, parts) => version.split('.').slice(0, parts).join('.');

/** One checked entry: the download must hash to `expected` with `algo`. An entry the published
 * catalog already has for the same URL is reused only when the vendor states that same SHA-256
 * now (so a changed file or a tampered published entry is never carried over); without such a
 * vendor hash the file is downloaded and hashed again. */
async function entry({ kind, line, version, os, arch, format, url, algo, expected, fetchBytes, peek, known }) {
  const prior = known?.get(url);
  if (prior && algo === 'sha256' && expected && prior.sha256 === expected) return { ...prior };
  const bytes = await fetchBytes(url);
  const file = fileOf(url);
  if (expected !== undefined && digest(algo, bytes) !== expected) throw new Error(`${file}: checksum mismatch`);
  const root = format === 'binary' ? '' : await peek(bytes, file);
  return { kind, line, version, os, arch, url, sha256: digest('sha256', bytes), format, root };
}

/** "<hash>  <file>" lines (sha256sums.txt, checksums.txt, .md5, .sha256) as a map. */
function hashList(text) {
  return new Map(
    text.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2).map(([h, f]) => [f.replace(/^\*/, ''), h.toLowerCase()]),
  );
}

/** MySQL from Oracle's CDN; `versions` are pinned (Oracle offers no release feed). */
export async function mysqlEntries({ versions, fetchText, fetchBytes, peek, known }) {
  const out = [];
  for (const version of versions) {
    const line = lineOf(version, 2);
    const base = `https://cdn.mysql.com/Downloads/MySQL-${line}`;
    for (const [file, os, arch, format] of [
      [`mysql-${version}-winx64.zip`, 'windows', 'x64', 'zip'],
      [`mysql-${version}-macos15-arm64.tar.gz`, 'macos', 'arm64', 'tar.gz'],
      [`mysql-${version}-macos15-x86_64.tar.gz`, 'macos', 'x86_64', 'tar.gz'],
    ]) {
      const url = `${base}/${file}`;
      const expected = hashList(await fetchText(`${url}.md5`)).values().next().value;
      out.push(await entry({ kind: 'mysql', line, version, os, arch, format, url, algo: 'md5', expected, fetchBytes, peek, known }));
    }
  }
  return out;
}

/** MariaDB for Windows from MariaDB's archive; macOS builds come from this repo's own workflow. */
export async function mariadbEntries({ versions, fetchText, fetchBytes, peek, known }) {
  const out = [];
  for (const version of versions) {
    const dir = `https://archive.mariadb.org/mariadb-${version}/winx64-packages`;
    const file = `mariadb-${version}-winx64.zip`;
    const expected = hashList(await fetchText(`${dir}/sha256sums.txt`)).get(file);
    if (!expected) throw new Error(`${file} is not in sha256sums.txt`);
    out.push(await entry({
      kind: 'mariadb', line: lineOf(version, 2), version, os: 'windows', arch: 'x64', format: 'zip',
      url: `${dir}/${file}`, algo: 'sha256', expected, fetchBytes, peek, known,
    }));
  }
  return out;
}

const POSTGRES_TARGETS = [
  ['x86_64-pc-windows-msvc.zip', 'windows', 'x64', 'zip'],
  ['aarch64-apple-darwin.tar.gz', 'macos', 'arm64', 'tar.gz'],
  ['x86_64-apple-darwin.tar.gz', 'macos', 'x86_64', 'tar.gz'],
];

/** PostgreSQL from theseus-rs/postgresql-binaries: the newest stable release of each line. */
export async function postgresEntries({ releases, lines, fetchText, fetchBytes, peek, known }) {
  const out = [];
  for (const line of lines) {
    const release = releases
      .filter((r) => !r.prerelease && r.tag_name.split('.')[0] === line)
      .sort((a, b) => b.tag_name.localeCompare(a.tag_name, 'en', { numeric: true }))[0];
    if (!release) throw new Error(`no PostgreSQL ${line} release`);
    const version = release.tag_name;
    for (const [suffix, os, arch, format] of POSTGRES_TARGETS) {
      const file = `postgresql-${version}-${suffix}`;
      const asset = release.assets.find((a) => a.name === file);
      const sums = release.assets.find((a) => a.name === `${file}.sha256`);
      if (!asset || !sums) throw new Error(`${file} or its .sha256 is missing`);
      const expected = hashList(await fetchText(sums.browser_download_url)).values().next().value;
      out.push(await entry({ kind: 'postgresql', line, version, os, arch, format, url: asset.browser_download_url, algo: 'sha256', expected, fetchBytes, peek, known }));
    }
  }
  return out;
}

/** Entries from a GitHub release whose assets carry a `digest` ("sha256:<hex>"). */
export async function githubDigestEntries({ kind, release, targets, fetchBytes, peek, known }) {
  const version = release.tag_name.replace(/^v/, '');
  const out = [];
  for (const t of targets) {
    const file = t.asset(version);
    const asset = release.assets.find((a) => a.name === file);
    if (!asset) throw new Error(`${file} is missing from the ${kind} release`);
    const expected = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : undefined;
    if (!expected) throw new Error(`${file} has no published digest`);
    out.push(await entry({
      kind, line: lineOf(version, 1), version, os: t.os, arch: t.arch, format: t.format,
      url: asset.browser_download_url, algo: 'sha256', expected, fetchBytes, peek, known,
    }));
  }
  return out;
}

/** Silo (the MinIO fork) from its release, checked against checksums.txt. */
export async function siloEntries({ release, checksums, fetchBytes, peek, known }) {
  // Tags look like MinIO's (RELEASE.<date>); the files carry a number, which checksums.txt names.
  const sums = release.assets.map((a) => a.name.match(/^silo_(.+)_checksums\.txt$/)).find(Boolean);
  if (!sums) throw new Error('silo: checksums.txt is missing');
  const version = sums[1];
  const published = hashList(checksums);
  const out = [];
  for (const [suffix, os, arch, format] of [
    ['windows_amd64.zip', 'windows', 'x64', 'zip'],
    ['darwin_arm64.tar.gz', 'macos', 'arm64', 'tar.gz'],
    ['darwin_amd64.tar.gz', 'macos', 'x86_64', 'tar.gz'],
  ]) {
    const file = `silo_${version}_${suffix}`;
    const asset = release.assets.find((a) => a.name === file);
    if (!asset || !published.has(file)) throw new Error(`${file} or its checksum is missing`);
    out.push(await entry({
      kind: 'silo', line: 'current', version, os, arch, format,
      url: asset.browser_download_url, algo: 'sha256', expected: published.get(file), fetchBytes, peek, known,
    }));
  }
  return out;
}

/** Typesense for macOS (it has no native Windows build); `versions` are pinned. */
export async function typesenseEntries({ versions, fetchBytes, peek, known }) {
  const out = [];
  for (const version of versions) {
    for (const [arch, target] of [['arm64', 'darwin-arm64'], ['x86_64', 'darwin-amd64']]) {
      const url = `https://dl.typesense.org/releases/${version}/typesense-server-${version}-${target}.tar.gz`;
      out.push(await entry({ kind: 'typesense', line: lineOf(version, 1), version, os: 'macos', arch, format: 'tar.gz', url, fetchBytes, peek, known }));
    }
  }
  return out;
}
