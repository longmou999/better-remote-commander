/**
 * MCP server factory: one low-level Server per HTTP request (stateless Streamable HTTP).
 * Tools = `list_devices` + exact standard MCP tools reported by the selected agent.
 * Device routing stays outside tool schemas/arguments. Invocation goes through invoke.ts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from 'brc-shared';
import type { DeviceHub } from '../device-hub.js';
import type { SqliteStore } from '../store/sqlite.js';
import { invokeTool, listUserDevices, type InvokeContext } from './invoke.js';

export type McpContext = InvokeContext;

export const LIST_DEVICES_TOOL = {
  name: 'list_devices',
  description: 'List devices paired to this relay. Standard Desktop Commander tool schemas stay untouched; multi-device deployments bind routing outside tool arguments with X-BRC-Device-ID.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  outputSchema: {
    type: 'object',
    properties: {
      devices: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deviceId: { type: 'string' },
            name: { type: 'string' },
            platform: { type: ['string', 'null'] },
            online: { type: 'boolean' },
            paused: { type: 'boolean' },
            lastSeen: { type: ['number', 'null'] },
          },
          required: ['deviceId', 'name', 'online', 'paused'],
          additionalProperties: false,
        },
      },
    },
    required: ['devices'],
    additionalProperties: false,
  },
  annotations: {
    title: 'List devices',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

/** Live standard MCP tool set. BRC never rewrites tool metadata or schemas. */
export function liveTools(hub: DeviceHub, store: SqliteStore, userId: string, deviceId?: string) {
  const routable = hub.list(userId).filter((d) => !store.getDevice(d.deviceId)?.paused);
  const selected = deviceId
    ? routable.filter((d) => d.deviceId === deviceId)
    : routable.length === 1 ? routable : [];
  const merged = new Map<string, ToolDefinition>();
  for (const d of selected) {
    for (const tool of hub.get(d.deviceId)?.tools ?? []) {
      if (!merged.has(tool.name)) merged.set(tool.name, tool);
    }
  }
  const tools = [...merged.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { online: routable.length, tools };
}

export function createMcpServer(hub: DeviceHub, store: SqliteStore, ctx: McpContext, relayVersion: string): Server {
  const server = new Server({ name: 'brc', version: relayVersion }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = liveTools(hub, store, ctx.userId, ctx.deviceId);
    return { tools: [LIST_DEVICES_TOOL, ...tools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === 'list_devices') {
      const structuredContent = { devices: listUserDevices(hub, store, ctx.userId) };
      return {
        content: [{ type: 'text', text: JSON.stringify(structuredContent, null, 2) }],
        structuredContent,
      };
    }
    const out = await invokeTool(hub, store, ctx, name, args as Record<string, unknown> | undefined);
    if (!out.ok) return { content: [{ type: 'text', text: out.message }], isError: true };
    return out.result as never;
  });

  return server;
}
