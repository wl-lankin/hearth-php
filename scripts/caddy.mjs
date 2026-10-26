// Caddy, the web server Hearth runs, from its official GitHub release. Each file is checked against
// the SHA-512 in caddy_<version>_checksums.txt before its SHA-256 goes into the catalog.
import { createHash } from 'node:crypto';

const TARGETS = [
  { suffix: 'windows_amd64.zip', os: 'windows', arch: 'x64', format: 'zip', binary: 'caddy.exe' },
  { suffix: 'mac_arm64.tar.gz', os: 'macos', arch: 'arm64', format: 'tar.gz', binary: 'caddy' },
  { suffix: 'mac_amd64.tar.gz', os: 'macos', arch: 'x86_64', format: 'tar.gz', binary: 'caddy' },
];

const digest = (algo, buf) => createHash(algo).update(buf).digest('hex');

/** `fetchBytes(url)` downloads a file; `checksums` is the release's checksums.txt text. */
export async function caddyEntries({ release, checksums, fetchBytes }) {
  const version = release.tag_name.replace(/^v/, '');
  const published = new Map(
    checksums.split('\n').map((l) => l.trim().split(/\s+/)).filter((p) => p.length === 2).map(([h, f]) => [f, h]),
  );
  const entries = [];
  for (const t of TARGETS) {
    const name = `caddy_${version}_${t.suffix}`;
    const asset = release.assets.find((a) => a.name === name);
    if (!asset) throw new Error(`${name} is missing from the Caddy release`);
    const bytes = await fetchBytes(asset.browser_download_url);
    if (published.get(name) !== digest('sha512', bytes)) throw new Error(`${name}: checksum mismatch`);
    entries.push({
      os: t.os, arch: t.arch, version, url: asset.browser_download_url,
      sha256: digest('sha256', bytes), format: t.format, binary: t.binary,
    });
  }
  return entries;
}
