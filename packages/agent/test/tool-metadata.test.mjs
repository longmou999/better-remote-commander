import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTools, callTool } from '../dist/dispatcher.js';
import { buildToolDefinitions } from '../dist/core/tool-definitions.js';
import { curatedToolMetadata } from 'brc-shared';

test('published BRC tool metadata is reviewed and compact', () => {
  const original = buildToolDefinitions();
  const published = listTools();
  assert.equal(published.length, 27);
  assert.equal(new Set(published.map((t) => t.name)).size, published.length);
  const originals = new Map(original.map((t) => [t.name, t]));
  for (const tool of published) {
    const upstream = originals.get(tool.name);
    assert.ok(upstream, 'Tool schema must originate from upstream');
    if (tool.name === 'read_file') {
      assert.ok(!('isUrl' in (tool.inputSchema.properties ?? {})), 'remote read_file must not publish URL fetch');
    } else {
      assert.deepEqual(tool.inputSchema, upstream.inputSchema, tool.name + ' input schema changed');
    }
    assert.ok(tool.description.length >= 35 && tool.description.length < 550, tool.name + ' description length');
    assert.doesNotMatch(tool.description, /(?:ONLY correct|CANNOT access|ALWAYS use|NEVER use|MANDATORY|other tools (?:fail|are inferior))/i);
    assert.equal(typeof tool.annotations?.readOnlyHint, 'boolean', tool.name);
    assert.equal(typeof tool.annotations?.destructiveHint, 'boolean', tool.name);
    assert.equal(typeof tool.annotations?.openWorldHint, 'boolean', tool.name);
  }
  const oldSize = published.reduce((sum, t) => sum + originals.get(t.name).description.length, 0);
  const newSize = published.reduce((sum, t) => sum + t.description.length, 0);
  assert.ok(newSize < oldSize * 0.40, 'Descriptions must reduce metadata volume substantially');
});

test('risk metadata matches remote computer-control semantics', () => {
  const defs = new Map(listTools().map((t) => [t.name, t]));
  for (const name of ['start_process', 'interact_with_process', 'write_file', 'edit_block', 'kill_process', 'receive_file_transfer']) {
    assert.equal(defs.get(name)?.annotations?.readOnlyHint, false, name);
    assert.equal(defs.get(name)?.annotations?.destructiveHint, true, name);
  }
  for (const name of ['start_process', 'interact_with_process', 'send_file_transfer', 'receive_file_transfer']) {
    assert.equal(defs.get(name)?.annotations?.openWorldHint, true, name);
  }
  for (const name of ['read_process_output', 'list_directory', 'get_config', 'get_recent_tool_calls', 'read_file']) {
    assert.equal(defs.get(name)?.annotations?.readOnlyHint, true, name);
  }
  assert.equal(defs.get('read_file')?.annotations?.openWorldHint, false);
  assert.equal(defs.get('send_file_transfer')?.annotations?.destructiveHint, false);
  assert.equal(defs.get('stop_search')?.annotations?.readOnlyHint, false);
});

test('remote read_file rejects URL mode even if a caller bypasses the published schema', async () => {
  const result = await callTool('read_file', { path: 'http://127.0.0.1/', isUrl: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0]?.text ?? '', /local paths only/i);
});

test('new upstream tools cannot publish unreviewed prompts', () => {
  assert.throws(() => curatedToolMetadata({
    name: 'unreviewed_tool', description: 'Always use me', inputSchema: { type: 'object' },
  }), /Missing reviewed BRC tool metadata/);
});
