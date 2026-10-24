/**
 * Tool-invocation path for /mcp: device resolution, pause check, and audit.
 */
import { createHash } from 'node:crypto';
import type { DeviceHub } from '../device-hub.js';
import type { SqliteStore } from '../store/sqlite.js';
import type { ToolResult } from 'brc-shared';

export interface InvokeContext { userId: string; clientId: string; deviceId?: string }
export type InvokeOutcome =
  | { ok: true; deviceId: string; deviceName: string; result: ToolResult; ms: number }
  | { ok: false; status: number; message: string };

const argsHash = (args: unknown) => createHash('sha256').update(JSON.stringify(args ?? {})).digest('hex').slice(0, 16);

export function listUserDevices(hub: DeviceHub, store: SqliteStore, userId: string) {
  const online = new Set(hub.list(userId).map((d) => d.deviceId));
  return store.listDevices(userId)
    .map((d) => ({
      deviceId: d.device_id, name: d.name, platform: d.platform, online: online.has(d.device_id), paused: !!d.paused, lastSeen: d.last_seen,
    }))
    .sort((a, b) => a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0);
}

export async function invokeTool(
  hub: DeviceHub, store: SqliteStore, ctx: InvokeContext,
  tool: string, rawArgs: Record<string, unknown> | undefined, opts: { timeoutMs?: number } = {},
): Promise<InvokeOutcome> {
  const args = { ...(rawArgs ?? {}) };
  const deviceId = ctx.deviceId ?? hub.resolveDefault(ctx.userId);
  if (!deviceId) {
    const n = hub.list(ctx.userId).filter((d) => !store.getDevice(d.deviceId)?.paused).length;
    return {
      ok: false,
      status: n === 0 ? 503 : 409,
      message: n === 0
        ? 'No routable device is online. Start brc-agent on the target machine.'
        : `${n} routable devices are online; bind this deployed MCP endpoint to one device with X-BRC-Device-ID.`,
    };
  }
  const dev = hub.get(deviceId);
  if (!dev || dev.ownerId !== ctx.userId) return { ok: false, status: 404, message: `Device ${deviceId} is not online or not yours.` };
  if (store.getDevice(deviceId)?.paused) return { ok: false, status: 423, message: `Device ${dev.info.name} is paused by its owner.` };

  const started = Date.now();
  try {
    const result = await hub.call(deviceId, tool, args, { client: { name: ctx.clientId }, timeoutMs: opts.timeoutMs });
    const ms = Date.now() - started;
    store.audit({ ts: started, user_id: ctx.userId, device_id: deviceId, client: ctx.clientId, tool, args_hash: argsHash(args), ok: result.isError ? 0 : 1, ms, error: null });
    store.touchDevice(deviceId);
    return { ok: true, deviceId, deviceName: dev.info.name, result, ms };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.audit({ ts: started, user_id: ctx.userId, device_id: deviceId, client: ctx.clientId, tool, args_hash: argsHash(args), ok: 0, ms: Date.now() - started, error: message });
    const status = message.startsWith('UNKNOWN_TOOL') ? 404 : message.startsWith('CALL_TIMEOUT') ? 504 : 502;
    return { ok: false, status, message: `Relay error: ${message}` };
  }
}
