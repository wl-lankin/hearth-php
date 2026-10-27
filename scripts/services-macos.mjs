// Hearth's own macOS builds of the services that ship none (Redis, MariaDB), built by
// services-macos.yml into releases `<kind>-<version>` with `<kind>-<version>-macos-<arch>.tar.gz`.
//
//   node scripts/services-macos.mjs plan               JSON list of {kind, version} still to build
//   node scripts/services-macos.mjs releases <out>     catalog entries from the releases, hashed
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const ARCHES = ['arm64', 'x86_64'];
const LINE_PARTS = { redis: 1, mariadb: 2 };
const asset = (kind, version, arch) => `${kind}-${version}-macos-${arch}.tar.gz`;

/** The (kind, version) pairs whose release lacks a build for an architecture. */
export function planBuilds({ releases, ...wanted }) {
  const plan = [];
  for (const [kind, versions] of Object.entries(wanted)) {
    for (const version of versions) {
      const release = releases.find((r) => r.tag_name === `${kind}-${version}`);
      const names = new Set((release?.assets ?? []).map((a) => a.name));
      if (!ARCHES.every((arch) => names.has(asset(kind, version, arch)))) plan.push({ kind, version });
    }
  }
  return plan;
}

/** Catalog entries for every build in the releases; `hash(url)` returns its SHA-256. */
export async function entriesFromReleases({ releases, hash }) {
  const out = [];
  for (const release of releases) {
    const match = release.tag_name.match(/^(redis|mariadb)-(\d[\w.]*)$/);
    if (!match) continue;
    const [, kind, version] = match;
    for (const arch of ARCHES) {
      const file = release.assets.find((a) => a.name === asset(kind, version, arch));
      if (!file) continue;
      out.push({
        kind,
        line: version.split('.').slice(0, LINE_PARTS[kind]).join('.'),
        version,
        os: 'macos',
        arch,
        url: file.browser_download_url,
        sha256: await hash(file.browser_download_url),
        format: 'tar.gz',
        root: `${kind}-${version}`,
      });
    }
  }
  return out;
}

async function main([command, out]) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
  const headers = { 'User-Agent': 'hearth-php services', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  const api = async (path) => (await fetch(`https://api.github.com/${path}`, { headers })).json();
  // Every page: the php-<version> releases alone outgrow one page of 100.
  const releases = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await api(`repos/${repo}/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  if (command === 'plan') {
    const pins = JSON.parse(readFileSync('pins.json', 'utf8')).services;
    const redis = (await api('repos/redis/redis/releases/latest')).tag_name;
    console.log(JSON.stringify(planBuilds({ releases, redis: [redis], mariadb: pins.mariadb })));
  } else if (command === 'releases') {
    const hash = async (url) => createHash('sha256').update(Buffer.from(await (await fetch(url)).arrayBuffer())).digest('hex');
    writeFileSync(out, `${JSON.stringify(await entriesFromReleases({ releases, hash }), null, 2)}\n`);
  } else {
    throw new Error('usage: services-macos.mjs plan | releases <out>');
  }
}

if (process.argv[1]?.endsWith('services-macos.mjs')) await main(process.argv.slice(2));
