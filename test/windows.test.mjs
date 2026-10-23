import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../lib/manifest.mjs';
import { PECL, RELEASES, windowsEntries } from '../scripts/windows.mjs';

const sha = (c) => c.repeat(64);
const zip = (path) => ({ zip: { path, sha256: sha('a'), size: '30.0MB' } });

const feed = {
  '8.0': { version: '8.0.30', 'nts-vs16-x64': zip('php-8.0.30-nts-Win32-vs16-x64.zip') },
  '8.4': { version: '8.4.27', 'nts-vs17-x64': zip('php-8.4.27-nts-Win32-vs17-x64.zip') },
  '8.5': { version: '8.5.12', 'nts-vs17-x64': zip('php-8.5.12-nts-Win32-vs17-x64.zip') },
};
const qaFeed = {
  '8.4': { version: '8.4.28RC1', 'nts-vs17-x64': zip('php-8.4.28RC1-nts-Win32-vs17-x64.zip') },
  '8.5': { version: '8.5.13-dev', 'nts-vs17-x64': zip('php-8.5.13-dev-nts-Win32-vs17-x64.zip') },
  '8.6': { version: '8.6.0RC4', 'nts-vs18-x64': zip('php-8.6.0RC4-nts-Win32-vs18-x64.zip') },
};
const pins = { redis: '6.3.0', xdebug: '3.5.3' };

/** A fake downloader: known PECL zips hash to 'b...', anything else is a 404. */
function fakeHash(missing = []) {
  return async (url) => {
    if (missing.some((m) => url.endsWith(m))) throw Object.assign(new Error('404'), { status: 404 });
    return sha('b');
  };
}

const base = (doc) => ({
  schema: 1, generated: 'x', php: doc,
  composer: { url: 'https://x', sha256: sha('c') }, cacert: { url: 'https://x', sha256: sha('d') },
});

test('one entry per supported stable minor plus the newest preview', async () => {
  const entries = await windowsEntries({ feed, qaFeed, pins, hash: fakeHash() });
  assert.deepEqual(entries.map((e) => [e.minor, e.version, e.channel]), [
    ['8.4', '8.4.27', 'stable'],
    ['8.5', '8.5.12', 'stable'],
    ['8.6', '8.6.0RC4', 'rc'],
  ]);
  assert.equal(entries[0].url, `${RELEASES}/archives/php-8.4.27-nts-Win32-vs17-x64.zip`);
  assert.equal(entries[2].url, 'https://downloads.php.net/~windows/qa/archives/php-8.6.0RC4-nts-Win32-vs18-x64.zip');
  assert.deepEqual(validate(base(entries)), []);
});

test('extensions point at the official PECL builds with a hash', async () => {
  const [e84] = await windowsEntries({ feed, qaFeed, pins, hash: fakeHash() });
  assert.deepEqual(e84.extensions.redis, {
    version: '6.3.0', kind: 'dll', file: 'php_redis.dll', sha256: sha('b'),
    url: `${PECL}/redis/6.3.0/php_redis-6.3.0-8.4-nts-vs17-x64.zip`,
  });
  assert.equal(e84.extensions.xdebug.kind, 'zend_dll');
});

test('a missing PECL build drops only that extension', async () => {
  const entries = await windowsEntries({
    feed, qaFeed, pins, hash: fakeHash(['php_redis-6.3.0-8.6-nts-vs18-x64.zip']),
  });
  const e86 = entries.find((e) => e.minor === '8.6');
  assert.equal(e86.extensions.redis, undefined);
  assert.equal(e86.extensions.xdebug.version, '3.5.3');
});

test('other download errors are not swallowed', async () => {
  const hash = async () => { throw Object.assign(new Error('boom'), { status: 500 }); };
  await assert.rejects(windowsEntries({ feed, qaFeed, pins, hash }), /boom/);
});
