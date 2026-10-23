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

/** Request headers for `url`: the GitHub token goes to the GitHub API only, never to other hosts. */
export function headersFor(url, token) {
  const headers = { 'User-Agent': 'hearth-php' };
  if (token && new URL(url).hostname === 'api.github.com') headers.Authorization = `Bearer ${token}`;
  return headers;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = process.env.GITHUB_REPOSITORY ?? 'wl-lankin/hearth-php';
  const get = (url) => fetch(url, { headers: headersFor(url, process.env.GH_TOKEN) });
  const latest = {};
  for (const minor of SUPPORTED) {
    latest[minor] = (await (await get(`https://www.php.net/releases/?json&version=${minor}`)).json()).version;
  }
  const releases = {};
  const list = await (await get(`https://api.github.com/repos/${repo}/releases?per_page=100`)).json();
  for (const r of Array.isArray(list) ? list : []) releases[r.tag_name] = r.assets.map((a) => a.name);
  console.log(JSON.stringify(minorsToBuild(latest, releases)));
}
