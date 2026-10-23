// Decides which PHP minors need a new macOS build: those whose newest patch (per php.net) has no
// release php-<version> with both architectures yet. Prints the minors as a JSON list.
import { pathToFileURL } from 'node:url';
import { SUPPORTED } from './windows.mjs';

export function minorsToBuild(latest, releases) {
  return Object.entries(latest)
    .filter(([, version]) => {
      const files = releases[`php-${version}`] ?? [];
      return !['arm64', 'x86_64'].every((arch) => files.includes(`php-${version}-macos-${arch}.tar.gz`));
    })
    .map(([minor]) => minor);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
  const headers = { 'User-Agent': 'hearth-php', ...(process.env.GH_TOKEN ? { Authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) };
  const latest = {};
  for (const minor of SUPPORTED) {
    const res = await fetch(`https://www.php.net/releases/?json&version=${minor}`, { headers });
    latest[minor] = (await res.json()).version;
  }
  const releases = {};
  const list = await (await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, { headers })).json();
  for (const r of Array.isArray(list) ? list : []) releases[r.tag_name] = r.assets.map((a) => a.name);
  console.log(JSON.stringify(minorsToBuild(latest, releases)));
}
