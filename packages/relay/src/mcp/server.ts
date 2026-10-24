/**
 * MCP server factory: one low-level Server per HTTP request (stateless Streamable HTTP).
 * Tools = `list_devices` + union of tools reported by the user's online agents,
 * each augmented with an optional `deviceId` argument. Invocation goes through invoke.ts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { ToolDefinition } from 'brc-shared';
import type { DeviceHub } from '../device-hub.js';
import type { SqliteStore } from '../store/sqlite.js';
import { invokeTool, listUserDevices, type InvokeContext } from './invoke.js';

export type McpContext = InvokeContext;

export const DEVICE_ID_PROP = {
  deviceId: { type: 'string', description: 'Target device id (from list_devices). Required when more than one device is online; may be omitted when only one device is connected.' },
};

export function withDeviceId(schema: unknown): Record<string, unknown> {
  const s = (schema && typeof schema === 'object' ? { ...(schema as Record<string, unknown>) } : {}) as Record<string, unknown>;
  s.type = 'object';
  s.properties = { ...((s.properties as Record<string, unknown>) ?? {}), ...DEVICE_ID_PROP };
  return s;
}

export const LIST_DEVICES_TOOL = {
  name: 'list_devices',
  description: 'List devices paired to this relay, with online/paused state and stable device ids.',
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

/** Live tool set for a user: union across online, non-paused devices (with deviceId prop). */
export function liveTools(hub: DeviceHub, store: SqliteStore, userId: string) {
  const online = hub.list(userId).filter((d) => !store.getDevice(d.deviceId)?.paused);
  const merged = new Map<string, ToolDefinition>();
  for (const d of online) {
    for (const tool of hub.get(d.deviceId)?.tools ?? []) {
      if (!merged.has(tool.name)) {
        // Preserve the exact standard MCP tool object. The only relay extension is
        // an optional deviceId routing property added to the input schema.
        merged.set(tool.name, { ...tool, inputSchema: withDeviceId(tool.inputSchema) });
      }
    }
  }
  const tools = [...merged.values()].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  return { online: online.length, tools };
}

export function createMcpServer(hub: DeviceHub, store: SqliteStore, ctx: McpContext, relayVersion: string): Server {
  const server = new Server({ name: 'brc', version: relayVersion }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const { tools } = liveTools(hub, store, ctx.userId);
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
    return {
      ...out.result,
      _meta: {
        ...(out.result._meta ?? {}),
        brc: { deviceId: out.deviceId, deviceName: out.deviceName },
      },
    } as never;
  });

  return server;
}
