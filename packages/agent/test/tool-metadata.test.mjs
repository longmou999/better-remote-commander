import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  callTool, closeBackend, listTools, STANDARD_MCP_VERSION,
} from '../dist/dispatcher.js';

let directClient = null;

async function directStandardTools() {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('@wonderwhy-er/desktop-commander/package.json');
  const entry = path.join(path.dirname(packageJson), 'dist', 'index.js');
  directClient = new Client({ name: 'brc-parity-test', version: '1' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry],
    stderr: 'ignore',
  });
  await directClient.connect(transport);
  return (await directClient.listTools()).tools;
}

after(async () => {
  await closeBackend();
  if (directClient) await directClient.close();
});

test('BRC agent tool surface exactly mirrors Desktop Commander standard MCP', async () => {
  const [published, standard] = await Promise.all([listTools(), directStandardTools()]);
  assert.equal(STANDARD_MCP_VERSION, '0.3.1');
  assert.equal(published.length, 25);
  assert.deepEqual(published, standard);
  assert.deepEqual(published.map((tool) => tool.name), [
    'get_config',
    'set_config_value',
    'read_file',
    'read_multiple_files',
    'write_file',
    'write_pdf',
    'create_directory',
    'list_directory',
    'move_file',
    'start_search',
    'get_more_search_results',
    'stop_search',
    'list_searches',
    'get_file_info',
    'edit_block',
    'start_process',
    'read_process_output',
    'interact_with_process',
    'force_terminate',
    'list_sessions',
    'list_processes',
    'kill_process',
    'get_usage_stats',
    'get_recent_tool_calls',
    'give_feedback_to_desktop_commander',
  ]);
  for (const retiredPrivateTool of ['prepare_file_transfer', 'send_file_transfer', 'receive_file_transfer']) {
    assert.equal(published.some((tool) => tool.name === retiredPrivateTool), false);
  }
});

test('BRC calls the standard backend rather than local copied handlers', async () => {
  const result = await callTool('get_config', { origin: 'llm' });
  assert.equal(result.isError ?? false, false);
  const text = JSON.stringify(result);
  assert.match(text, /0\.3\.1/);
  assert.doesNotMatch(text, /0\.2\.50/);
});
