/** BRC agent library entry: self-hosted remote transport around standard MCP. */
export {
  callTool, closeBackend, hasTool, listTools, setAllowedDirectories,
  STANDARD_MCP_PACKAGE, STANDARD_MCP_VERSION,
} from './dispatcher.js';
export { WsClient, type WsClientOptions } from './transport/ws-client.js';
