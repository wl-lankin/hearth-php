import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peclZipName, pickLatest, validate } from '../lib/manifest.mjs';

import { example } from './fixtures.mjs';

const sha = 'a'.repeat(64);

test('the example manifest is valid', () => {
  assert.deepEqual(validate(example), []);
});

test('missing hashes and unknown schemas are reported', () => {
  const broken = structuredClone(example);
  delete broken.php[0].sha256;
  assert.ok(validate(broken).includes('php[0].sha256 missing'));
  assert.ok(validate({ ...example, schema: 2 }).includes('unknown schema 2'));
});

test('a downloadable extension needs url and sha256, a builtin one does not', () => {
  const broken = structuredClone(example);
  delete broken.php[0].extensions.redis.sha256;
  assert.ok(validate(broken).includes('php[0].extensions.redis.sha256 missing'));
});

test('pickLatest reads the php.net feed per minor with the right compiler', () => {
  const feed = {
    '8.0': { version: '8.0.30', 'nts-vs16-x64': { zip: { path: 'php-8.0.30-nts-Win32-vs16-x64.zip', sha256: sha, size: '25.0MB' } } },
    '8.3': { version: '8.3.36', 'nts-vs16-x64': { zip: { path: 'php-8.3.36-nts-Win32-vs16-x64.zip', sha256: sha, size: '31.5MB' } } },
    '8.4': { version: '8.4.27', 'nts-vs17-x64': { zip: { path: 'php-8.4.27-nts-Win32-vs17-x64.zip', sha256: sha, size: '33.66MB' } } },
  };
  assert.deepEqual(pickLatest(feed, ['8.3', '8.4', '8.5']), [
    { minor: '8.3', version: '8.3.36', vs: 'vs16', path: 'php-8.3.36-nts-Win32-vs16-x64.zip', sha256: sha, size: 33030144 },
    { minor: '8.4', version: '8.4.27', vs: 'vs17', path: 'php-8.4.27-nts-Win32-vs17-x64.zip', sha256: sha, size: 35295068 },
  ]);
});

test('PECL Windows zip names', () => {
  assert.equal(peclZipName('redis', '6.3.0', '8.4', 'vs17'), 'php_redis-6.3.0-8.4-nts-vs17-x64.zip');
  assert.equal(peclZipName('xdebug', '3.5.3', '8.5', 'vs17'), 'php_xdebug-3.5.3-8.5-nts-vs17-x64.zip');
});
