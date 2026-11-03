/**
 * BRC tool backend: thin proxy to the pinned standard Desktop Commander MCP server.
 *
 * BRC owns remote authentication/device routing only. Tool definitions and tool
 * execution come directly from Desktop Commander over MCP stdio.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { ToolDefinition, ToolResult } from 'brc-shared';

export const STANDARD_MCP_PACKAGE = '@wonderwhy-er/desktop-commander';
export const STANDARD_MCP_VERSION = '0.3.1';

let client: Client | null = null;
let currentTransport: StdioClientTransport | null = null;
let opening: Promise<Client> | null = null;
let cachedTools: ToolDefinition[] | null = null;
let restartFailures = 0;
let nextRestartAt = 0;

function backendEntry(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve(`${STANDARD_MCP_PACKAGE}/package.json`);
  return path.join(path.dirname(packageJson), 'dist', 'index.js');
}

function childEnvironment(): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
    DC_REMOTE_DEVICE: 'true',
  };
}

const restartBackoffMs = (attempt: number) =>
  Math.min(5_000, 250 * 2 ** Math.min(attempt, 5));

function isConnectionLoss(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === -32000 || error.message === 'Not connected' || /connection closed/i.test(error.message);
}

async function discard(failed: Client): Promise<void> {
  if (client === failed) {
    client = null;
    currentTransport = null;
    cachedTools = null;
  }
  await failed.close().catch(() => undefined);
}

async function openBackend(): Promise<Client> {
  const next = new Client(
    { name: 'brc-standard-mcp-proxy', version: '2.0.2' },
    { capabilities: {} },
  );
  const nextTransport = new StdioClientTransport({
    command: process.execPath,
    args: [backendEntry()],
    stderr: 'ignore',
    env: childEnvironment(),
  });

  try {
    await next.connect(nextTransport);

    next.onclose = () => {
      if (client !== next) return;
      client = null;
      currentTransport = null;
      cachedTools = null;
    };
    next.onerror = () => {
      // Protocol-level errors are not proof that the stdio child died.
      // The SDK's onclose is the authoritative lifecycle signal.
    };

    // A completed MCP handshake only proves protocol compatibility. Do not
    // publish this backend as ready until its tool layer answers a real request.
    const verified = await next.listTools();
    cachedTools = verified.tools.map((tool) => ({ ...tool })) as ToolDefinition[];
    client = next;
    currentTransport = nextTransport;
    return next;
  } catch (error) {
    await next.close().catch(() => undefined);
    await nextTransport.close().catch(() => undefined);
    throw error;
  }
}

async function backend(): Promise<Client> {
  if (client) return client;
  if (opening) return opening;

  const waitMs = nextRestartAt - Date.now();
  if (waitMs > 0) {
    throw new Error(`Desktop Commander backend restart is cooling down for ${Math.ceil(waitMs / 1000)}s`);
  }

  const attempt = openBackend();
  opening = attempt;
  try {
    const ready = await attempt;
    restartFailures = 0;
    nextRestartAt = 0;
    return ready;
  } catch (error) {
    restartFailures++;
    nextRestartAt = Date.now() + restartBackoffMs(restartFailures);
    throw error;
  } finally {
    if (opening === attempt) opening = null;
  }
}

export async function listTools(): Promise<ToolDefinition[]> {
  if (!client || !cachedTools) await backend();
  return (cachedTools ?? []).map((tool) => ({ ...tool }));
}

export async function hasTool(name: string): Promise<boolean> {
  return (await listTools()).some((tool) => tool.name === name);
}

export async function callTool(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const standard = await backend();
  try {
    return await standard.callTool({ name, arguments: args }) as ToolResult;
  } catch (error) {
    // A disconnected transport gives an unknown execution outcome. Never replay
    // the original tool call automatically: writes/process starts may already
    // have happened. Drop the dead backend so the NEXT request gets a fresh one.
    if (isConnectionLoss(error)) await discard(standard);
    throw error;
  }
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
  restartFailures = 0;
  nextRestartAt = 0;
  const current = client;
  const transport = currentTransport;
  client = null;
  currentTransport = null;
  opening = null;
  if (current) await current.close().catch(() => undefined);
  else if (transport) await transport.close().catch(() => undefined);
}
