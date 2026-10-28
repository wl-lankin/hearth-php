import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retrying } from '../lib/retry.mjs';

const networkError = () => Object.assign(new TypeError('fetch failed'), { cause: new Error('other side closed') });

test('a dropped connection is tried again', async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    if (calls < 3) throw networkError();
    return 'bytes';
  };
  assert.equal(await retrying(run, { attempts: 3, wait: 0 }), 'bytes');
  assert.equal(calls, 3);
});

test('an HTTP error is not tried again', async () => {
  let calls = 0;
  const run = async () => {
    calls += 1;
    throw Object.assign(new Error('HTTP 404'), { status: 404 });
  };
  await assert.rejects(retrying(run, { attempts: 3, wait: 0 }), /HTTP 404/);
  assert.equal(calls, 1);
});

test('the last failure names its cause', async () => {
  await assert.rejects(retrying(async () => { throw networkError(); }, { attempts: 2, wait: 0 }), /fetch failed \(other side closed\)/);
});
