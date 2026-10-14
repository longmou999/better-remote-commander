# Security

## Model
- The agent runs with the permissions of the OS user who started it. An authenticated AI client can use shell/process tools with that user's authority.
- `allowedDirectories` is enforced by BRC file APIs; it is **not a shell sandbox**. Shell/process tools can access paths the OS user can access.
- `blockedCommands` is a best-effort convenience guard, not a security boundary: shell syntax and interactive processes make command blacklists inherently incomplete. Use OS permissions, device pause/revocation, and client-side approval policy for hard boundaries.
- Remote BRC `read_file` is local-file only. Web/URL retrieval belongs to the MCP client web tool, which avoids turning the desktop agent into an SSRF-capable web proxy.
- The relay never stores device tokens or user passwords in plaintext (SHA-256 / scrypt). OAuth access tokens live 1 h, refresh tokens 30 d and rotate on use.
- Agents only make outbound connections. The relay is the only public endpoint.
- Per-call audit stores tool name, args hash, device, client, result and latency; arguments and outputs are not stored by the relay.

## Defaults you should keep
- `BRC_ADMIN_PASSWORD` strong; `BRC_SESSION_SECRET` random (32+ bytes).
- `PUBLIC_URL` uses HTTPS in real deployments.
- Login rate limiting and OAuth consent stay enabled.
- Pause or revoke a device/client when remote control is not needed.
- Use `--allow-dir` when file tools should be scoped, while remembering this does not restrict shell commands.

## Threat notes
- A compromised authenticated AI session can execute commands as the agent OS user on an unpaused device. Revoke the device or OAuth client to cut access.
- OAuth clients use S256 PKCE; ChatGPT and Claude register through relay OAuth metadata.
- Quick tunnels are testing-only because their hostname changes and invalidates OAuth registrations.

## Reporting
Open a private issue or email the maintainer. Include relay version (`/health`) and reproduction steps without secrets.
