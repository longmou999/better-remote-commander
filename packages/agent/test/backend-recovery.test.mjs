import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryNotConnectedOnce } from '../dist/backend-recovery.js';

test('backend recovery invalidates a stale client and retries Not connected exactly once', async () => {
  const clients = [{ id: 1 }, { id: 2 }];
  let acquireCount = 0;
  const invalidated = [];
  const result = await retryNotConnectedOnce(
    async () => clients[acquireCount++],
    async (client) => { invalidated.push(client.id); },
    async (client) => {
      if (client.id === 1) throw new Error('Not connected');
      return 'ok';
    },
  );
  assert.equal(result, 'ok');
  assert.equal(acquireCount, 2);
  assert.deepEqual(invalidated, [1]);
});

test('backend recovery does not retry ordinary tool errors', async () => {
  let acquireCount = 0;
  let invalidateCount = 0;
  await assert.rejects(
    retryNotConnectedOnce(
      async () => ({ id: ++acquireCount }),
      async () => { invalidateCount++; },
      async () => { throw new Error('tool failed'); },
    ),
    /tool failed/,
  );
  assert.equal(acquireCount, 1);
  assert.equal(invalidateCount, 0);
});

test('backend recovery never retries more than once', async () => {
  let acquireCount = 0;
  let invalidateCount = 0;
  await assert.rejects(
    retryNotConnectedOnce(
      async () => ({ id: ++acquireCount }),
      async () => { invalidateCount++; },
      async () => { throw new Error('Not connected'); },
    ),
    /Not connected/,
  );
  assert.equal(acquireCount, 2);
  assert.equal(invalidateCount, 1);
});
