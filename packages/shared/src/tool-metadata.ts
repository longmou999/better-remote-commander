/**
 * MCP-facing tool metadata for BRC. Keep upstream tool schemas and handlers intact.
 * Descriptions communicate capabilities and risks, never instructions for choosing
 * this tool over unrelated tools. This file survives scripts/extract-tools.mjs.
 */
type ToolShape = {
  name: string;
  description: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
};

type Policy = {
  description: string;
  readOnly: boolean;
  destructive?: boolean;
  openWorld?: boolean;
};

const TOOL_POLICIES: Record<string, Policy> = {
  get_config: {
    description: 'Read the paired device agent configuration, including its default shell, directory filters, command block list, and diagnostics. Does not expose relay authentication secrets.',
    readOnly: true,
  },
  read_file: {
    description: 'Read a local file on a paired device with optional offset/length paging. Supports text, PDFs, DOCX, spreadsheets and images. Relative paths depend on the agent working directory; use the client web tool for URLs.',
    readOnly: true,
  },
  read_multiple_files: {
    description: 'Read several known local paths in one remote request, reducing round trips versus individual reads. Returns per-file content and errors; failures do not stop other reads. File access follows the agent directory configuration.',
    readOnly: true,
  },
  write_file: {
    description: 'Create, replace (mode=rewrite), or append (mode=append) content to a file on a paired device. Rewriting replaces previous contents. Text and supported spreadsheet formats are handled by the agent.',
    readOnly: false, destructive: true,
  },
  write_pdf: {
    description: 'Create a PDF from supplied content or modify a PDF on a paired device. Writes the output path and may change an existing PDF depending on mode; check the arguments before executing.',
    readOnly: false, destructive: true,
  },
  create_directory: {
    description: 'Create a directory and missing parent directories on a paired device. Does not remove existing directories; limited by the agent directory configuration.',
    readOnly: false,
  },
  list_directory: {
    description: 'List files and directories on a paired device, optionally recursively with depth. Entries include their relative paths and types; large nested directories may be truncated.',
    readOnly: true,
  },
  move_file: {
    description: 'Move or rename a file or directory on a paired device. Changes the source path and potentially the destination filesystem state.',
    readOnly: false, destructive: true,
  },
  get_file_info: {
    description: 'Read local file or directory metadata on a paired device: type, size, timestamps, permissions, and supported text/spreadsheet details. Does not edit files.',
    readOnly: true,
  },
  edit_block: {
    description: 'Apply an exact, targeted edit to a file on a paired device. Text/DOCX use old_string/new_string; spreadsheets support range updates. Can modify or invalidate existing content.',
    readOnly: false, destructive: true,
  },
  start_search: {
    description: 'Start an asynchronous filename or file-content search on a paired device. searchType=files searches names; searchType=content searches text. Pattern is a regex unless literalSearch=true. Returns a search ID for pagination.',
    readOnly: true,
  },
  get_more_search_results: {
    description: 'Read a page of results from a search previously started on a paired device. Use its search ID and offset/length to retrieve additional matches and completion status.',
    readOnly: true,
  },
  stop_search: {
    description: 'Stop an active background search on a paired device without changing searched files. Final results may remain available temporarily.',
    readOnly: false,
  },
  list_searches: {
    description: 'List active and recent search sessions on a paired device, including IDs, patterns, status and runtime. Does not modify searched files.',
    readOnly: true,
  },
  start_process: {
    description: 'Start a command-line process on a paired device. Requires timeout_ms in milliseconds; DOOM defaults to Windows PowerShell. Returns PID, state and initial output; read_process_output can follow long-running tasks. Commands may modify files or access networks.',
    readOnly: false, destructive: true, openWorld: true,
  },
  read_process_output: {
    description: 'Read additional output and state from a terminal process previously started on a paired device. offset=0 reads new output; positive/negative offsets support paging. Does not send commands.',
    readOnly: true,
  },
  interact_with_process: {
    description: 'Send input or a command to an existing terminal/REPL process on a paired device using its PID. Input may execute code or commands with the permissions of that process.',
    readOnly: false, destructive: true, openWorld: true,
  },
  force_terminate: {
    description: 'Force-stop a BRC-managed terminal session on a paired device by PID. Unsaved process state may be lost.',
    readOnly: false, destructive: true,
  },
  list_sessions: {
    description: 'List BRC-managed terminal sessions on a paired device with PID, running/waiting state, and runtime. Does not terminate or interact with sessions.',
    readOnly: true,
  },
  list_processes: {
    description: 'Read the operating-system process list on a paired device, including process IDs and available resource usage. Does not alter processes.',
    readOnly: true,
  },
  kill_process: {
    description: 'Forcefully terminate an operating-system process on a paired device using its PID. Can interrupt unrelated work and cause data loss.',
    readOnly: false, destructive: true,
  },
  get_usage_stats: {
    description: 'Read local BRC agent tool usage statistics, failure counts and recent performance summary. Does not alter configuration.',
    readOnly: true,
  },
  prepare_file_transfer: {
    description: 'Create an expiring in-memory receiving key and receiveId on the destination BRC device. Use the returned recipientPublicKey when encrypting a cross-device transfer; no file is transferred yet.',
    readOnly: false,
  },
  send_file_transfer: {
    description: 'Encrypt a source file (up to 99 MB) on the sending BRC device and upload ciphertext to tmpfiles.org using the destination recipientPublicKey. The source file is unchanged; returns a transfer token for the receiver.',
    readOnly: false, openWorld: true,
  },
  receive_file_transfer: {
    description: 'Download a BRC encrypted transfer from tmpfiles.org, authenticate and decrypt it using a destination receiveId, then write the destination file. Existing files are replaced only with overwrite=true.',
    readOnly: false, destructive: true, openWorld: true,
  },
};

/** Fail closed when an upstream update adds an unreviewed remotely callable tool. */
export function curatedToolMetadata<T extends ToolShape>(tool: T): T {
  const policy = Object.hasOwn(TOOL_POLICIES, tool.name) ? TOOL_POLICIES[tool.name] : undefined;
  if (!policy) throw new Error('Missing reviewed BRC tool metadata for ' + tool.name);
  const next: ToolShape = {
    ...tool,
    description: policy.description,
    annotations: {
      ...tool.annotations,
      readOnlyHint: policy.readOnly,
      destructiveHint: policy.destructive ?? false,
      openWorldHint: policy.openWorld ?? false,
    },
  };
  // Remote BRC is a computer-control surface, not a second web client.
  // Removing URL fetch from the published schema drops an unnecessary SSRF/open-world path.
  if (tool.name === 'read_file' && tool.inputSchema && typeof tool.inputSchema === 'object') {
    const schema = { ...(tool.inputSchema as Record<string, unknown>) };
    const properties = schema.properties && typeof schema.properties === 'object'
      ? { ...(schema.properties as Record<string, unknown>) }
      : undefined;
    if (properties) {
      delete properties.isUrl;
      schema.properties = properties;
    }
    if (Array.isArray(schema.required)) {
      schema.required = schema.required.filter((name) => name !== 'isUrl');
    }
    next.inputSchema = schema;
  }
  return next as T;
}

