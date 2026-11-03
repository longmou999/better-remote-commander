import { afterEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { callTool, closeBackend } from '../dist/dispatcher.js';

afterEach(async () => {
  await closeBackend();
  mock.restoreAll();
});

const ok = { content: [{ type: 'text', text: 'ok' }] };

test('a failed mutating call is never replayed automatically', async () => {
  const clients = [];
  const requests = [];
  mock.method(Client.prototype, 'connect', async function () { clients.push(this); });
  mock.method(Client.prototype, 'close', async function () {});
  mock.method(Client.prototype, 'listTools', async () => ({ tools: [] }));
  mock.method(Client.prototype, 'callTool', async function (request) {
    requests.push(request);
    if (clients.indexOf(this) === 0) throw new Error('Not connected');
    return ok;
  });

  await assert.rejects(callTool('write_file', { path: 'x', content: 'y' }), /Not connected/);
  assert.equal(requests.length, 1, 'the original write must not be replayed after an unknown outcome');

  assert.deepEqual(await callTool('get_config'), ok);
  assert.equal(clients.length, 2, 'the next request gets a fresh backend');
});

test('real stdio child death is detected and the next request recreates the backend', { timeout: 20000 }, async (t) => {
  const transports = [];
  const connect = Client.prototype.connect;
  mock.method(Client.prototype, 'connect', function (transport, ...args) {
    transports.push(transport);
    return connect.call(this, transport, ...args);
  });

  assert.equal((await callTool('get_config')).isError ?? false, false);
  const deadPid = transports[0].pid;
  assert.ok(deadPid > 0);

  process.kill(deadPid);
  const deadline = Date.now() + 5000;
  while (transports[0].pid !== null && Date.now() < deadline) await delay(20);
  assert.equal(transports[0].pid, null, 'the old Desktop Commander child must exit');

  assert.equal((await callTool('get_config')).isError ?? false, false);
  assert.equal(transports.length, 2);
  assert.ok(transports[1].pid > 0 && transports[1].pid !== deadPid);
  t.diagnostic(`killed=${deadPid}; replacement=${transports[1].pid}`);
});

test('the proxied Desktop Commander receives the device environment and remote marker', { timeout: 15000 }, async () => {
  process.env.BRC_TEST_DEVICE_ENV = 'visible-to-child';
  try {
    const result = await callTool('start_process', {
      command: 'node -e "console.log([process.env.BRC_TEST_DEVICE_ENV,process.env.DC_REMOTE_DEVICE].join(\"/\"))"',
      timeout_ms: 10000,
    });
    assert.equal(result.isError ?? false, false);
    const text = result.content?.map((part) => part.type === 'text' ? part.text : '').join('\n') ?? '';
    assert.match(text, /visible-to-child\/true/);
  } finally {
    delete process.env.BRC_TEST_DEVICE_ENV;
  }
});
