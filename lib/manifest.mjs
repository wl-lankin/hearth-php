// The Hearth PHP catalog (manifest.json, schema 1): every artifact Hearth may download, with its
// SHA-256. See README.md for the format.

const SHA256 = /^[0-9a-f]{64}$/;
const KINDS = new Set(['builtin', 'dll', 'zend_dll', 'zend_so']);

/** Returns the problems found in a manifest; an empty list means it is valid. */
export function validate(m) {
  const errors = [];
  const need = (obj, key, where) => {
    if (obj?.[key] === undefined || obj[key] === '') errors.push(`${where}.${key} missing`);
  };
  const hash = (obj, where) => {
    if (obj?.sha256 === undefined) return errors.push(`${where}.sha256 missing`);
    if (!SHA256.test(obj.sha256)) errors.push(`${where}.sha256 is not a SHA-256`);
  };
  if (m?.schema !== 1) errors.push(`unknown schema ${m?.schema}`);
  if (!Array.isArray(m?.php) || m.php.length === 0) errors.push('php is empty');
  (m?.php ?? []).forEach((b, i) => {
    const at = `php[${i}]`;
    for (const key of ['minor', 'version', 'channel', 'os', 'arch', 'url', 'format']) need(b, key, at);
    hash(b, at);
    if (!['windows', 'macos'].includes(b.os)) errors.push(`${at}.os ${b.os} unknown`);
    if (!['zip', 'tar.gz'].includes(b.format)) errors.push(`${at}.format ${b.format} unknown`);
    for (const [name, ext] of Object.entries(b.extensions ?? {})) {
      const where = `${at}.extensions.${name}`;
      if (!KINDS.has(ext.kind)) errors.push(`${where}.kind ${ext.kind} unknown`);
      if (ext.kind === 'dll' || ext.kind === 'zend_dll') {
        need(ext, 'url', where);
        need(ext, 'file', where);
        hash(ext, where);
      }
      if (ext.kind === 'zend_so') need(ext, 'file', where);
    }
  });
  (m?.tools?.caddy ?? []).forEach((t, i) => {
    const at = `tools.caddy[${i}]`;
    for (const key of ['os', 'arch', 'version', 'url', 'format', 'binary']) need(t, key, at);
    hash(t, at);
  });
  for (const key of ['composer', 'cacert']) {
    need(m?.[key], 'url', key);
    hash(m?.[key], key);
  }
  return errors;
}

/** "33.66MB" as the php.net feed writes it, in bytes. */
function bytes(size) {
  const match = /^([\d.]+)\s*MB$/i.exec(String(size));
  return match ? Math.round(Number(match[1]) * 1024 * 1024) : 0;
}

/** The newest NTS x64 zip per requested minor from the php.net Windows feed (minors it lacks are skipped). */
export function pickLatest(feed, minors) {
  const picked = [];
  for (const minor of minors) {
    const release = feed[minor];
    if (!release) continue;
    const key = Object.keys(release).find((k) => /^nts-vs\d+-x64$/.test(k));
    if (!key) continue;
    const zip = release[key].zip;
    picked.push({ minor, version: release.version, vs: key.split('-')[1], path: zip.path, sha256: zip.sha256, size: bytes(zip.size) });
  }
  return picked;
}

/** The file name of an official PECL Windows build, e.g. php_redis-6.3.0-8.4-nts-vs17-x64.zip. */
export function peclZipName(ext, extVersion, minor, vs) {
  return `php_${ext}-${extVersion}-${minor}-nts-${vs}-x64.zip`;
}
