# brc-agent

Device agent for **Better Remote Commander** — self-hosted remote control of your computers from Claude and ChatGPT.
Runs on the machine you want to control and connects *outbound* to your own `brc-relay`. It starts the pinned
official Desktop Commander MCP backend locally and exposes that backend's exact standard tool surface (25 tools in
Desktop Commander 0.3.1) to any AI client authorized on the relay.

## Install

```bash
npm i -g brc-agent
```
Requires Node.js 22.13+ (Windows, macOS, Linux).

## Pair with your relay

```bash
brc-agent --relay https://brc.example.com --name "My PC"
```
The agent prints a pairing code and opens `https://brc.example.com/device/verify`. Sign in to the relay and approve.
Credentials are saved in `~/.brc/device.json`; later runs just need `brc-agent`.

## Start at login

```bash
brc-agent --install-service      # Windows Task Scheduler / systemd --user / launchd
brc-agent --uninstall-service
```

## Options

| Flag / env | Meaning |
|---|---|
| `--relay <url>` / `BRC_RELAY` | relay base URL |
| `--name <name>` / `BRC_NAME` | device name shown in clients (default: hostname) |
| `--allow-dir <path>` (repeatable) | restrict file tools to these directories |
| `--no-browser` | print the pairing URL instead of opening it |
| `--logout` | remove saved credentials |
| `--debug` / `BRC_DEBUG=1` | log every tool call |
| `BRC_HOME` | state directory (default `~/.brc`) |

## Docs

Full project, relay setup (Docker, Cloudflare Tunnel, VPS) and security notes:
https://github.com/shahidx0x/better-remote-commander

License MIT. Runtime tool backend: [Desktop Commander MCP](https://github.com/wonderwhy-er/DesktopCommanderMCP) 0.3.1 (MIT), used unmodified through standard MCP stdio.
