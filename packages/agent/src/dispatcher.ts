/**
 * BRC tool backend: exact proxy to the pinned standard Desktop Commander MCP server.
 *
 * BRC owns remote authentication/device routing only. Tool definitions and tool
 * execution come directly from Desktop Commander over MCP stdio so the BRC
 * surface cannot silently fork schemas, descriptions, annotations or behavior.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition, ToolResult } from 'brc-shared';

export const STANDARD_MCP_PACKAGE = '@wonderwhy-er/desktop-commander';
export const STANDARD_MCP_VERSION = '0.3.1';

let client: Client | null = null;
let transport: StdioClientTransport | null = null;
let opening: Promise<Client> | null = null;
let cachedTools: ToolDefinition[] | null = null;

function backendEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve(`${STANDARD_MCP_PACKAGE}/package.json`);
  return path.join(path.dirname(packageJson), 'dist', 'index.js');
}

async function backend(): Promise<Client> {
  if (client) return client;
  if (!opening) {
    opening = (async () => {
      const next = new Client(
        { name: 'brc-standard-mcp-proxy', version: '2.0.2' },
        { capabilities: {} },
      );
      const nextTransport = new StdioClientTransport({
        command: process.execPath,
        args: [backendEntry()],
        stderr: 'ignore',
      });
      await next.connect(nextTransport);
      client = next;
      transport = nextTransport;
      return next;
    })().catch((error) => {
      opening = null;
      throw error;
    });
  }
  return opening;
}

export async function listTools(): Promise<ToolDefinition[]> {
  if (!cachedTools) {
    const standard = await (await backend()).listTools();
    // Preserve the upstream MCP Tool objects byte-for-byte at the semantic
    // object level. Relay routing may add optional deviceId later.
    cachedTools = standard.tools.map((tool) => ({ ...tool })) as ToolDefinition[];
  }
  return cachedTools.map((tool) => ({ ...tool }));
}

export async function hasTool(name: string): Promise<boolean> {
  return (await listTools()).some((tool) => tool.name === name);
}

export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const standard = await backend();
  const result = await standard.callTool({ name, arguments: args });
  return result as ToolResult;
}

export async function setAllowedDirectories(paths: string[]): Promise<void> {
  const result = await callTool('set_config_value', {
    key: 'allowedDirectories',
    value: paths,
    origin: 'ui',
  });
  if (result.isError) {
    const detail = result.content?.map((item) => ('text' in item ? item.text : '')).filter(Boolean).join('\n');
    throw new Error(detail || 'Desktop Commander rejected allowedDirectories');
  }
  cachedTools = null;
}

export async function closeBackend(): Promise<void> {
  cachedTools = null;
  const current = client;
  client = null;
  opening = null;
  transport = null;
  if (current) await current.close();
}
