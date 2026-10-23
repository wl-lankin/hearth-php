import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minorsToBuild } from '../scripts/plan.mjs';

const assets = (v) => [`php-${v}-macos-arm64.tar.gz`, `php-${v}-macos-x86_64.tar.gz`];

test('only minors whose newest patch has no complete macOS release are built', () => {
  const latest = { '8.3': '8.3.36', '8.4': '8.4.27', '8.5': '8.5.12' };
  const releases = {
    'php-8.3.36': assets('8.3.36'),
    'php-8.4.26': assets('8.4.26'),
    'php-8.5.12': ['php-8.5.12-macos-arm64.tar.gz'],
  };
  assert.deepEqual(minorsToBuild(latest, releases), ['8.4', '8.5']);
});

test('nothing to build when every newest patch is released for both architectures', () => {
  assert.deepEqual(minorsToBuild({ '8.4': '8.4.27' }, { 'php-8.4.27': assets('8.4.27') }), []);
});

test('the GitHub token is only sent to the GitHub API', async () => {
  const { headersFor } = await import('../scripts/plan.mjs');
  assert.equal(headersFor('https://api.github.com/repos/x/y/releases', 'secret').Authorization, 'Bearer secret');
  assert.equal(headersFor('https://www.php.net/releases/?json&version=8.4', 'secret').Authorization, undefined);
  assert.equal(headersFor('https://api.github.com.evil.test/x', 'secret').Authorization, undefined);
  assert.equal(headersFor('https://api.github.com/x', undefined).Authorization, undefined);
});
