/**
 * Vendored argv parser. Matches station-kit's pattern (no external deps —
 * commander/yargs would be overkill for a handful of flags). Supports:
 *
 *   gmonitor [start|server|dashboard] [--config path] [--port n]
 *            [--dashboard-port n] [--host s] [--dir path]
 *            [--api-url url] [--no-open] [-h|--help]
 *
 * No args: same as `start`.
 */

export type Subcommand = "start" | "server" | "dashboard"

export interface CliArgs {
  command: Subcommand
  configPath?: string
  port?: number
  dashboardPort?: number
  host?: string
  dataDir?: string
  apiUrl?: string
  noOpen?: boolean
  help?: boolean
  /** Anything left over (positional or unknown) — surfaced for error reporting. */
  unknown: string[]
}

const SUBCOMMANDS = new Set<Subcommand>(["start", "server", "dashboard"])

export function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { command: "start", unknown: [] }
  const args = [...argv]

  // First positional, if it looks like a known subcommand, sets the mode.
  if (args[0] && SUBCOMMANDS.has(args[0] as Subcommand)) {
    out.command = args.shift() as Subcommand
  }

  while (args.length > 0) {
    const a = args.shift()!
    switch (a) {
      case "-h":
      case "--help":
        out.help = true
        break
      case "--config":
        out.configPath = expect(args, "--config")
        break
      case "--port": {
        const v = expect(args, "--port")
        const n = Number(v)
        if (!Number.isFinite(n)) throw new Error(`--port: not a number (${v})`)
        out.port = n
        break
      }
      case "--dashboard-port": {
        const v = expect(args, "--dashboard-port")
        const n = Number(v)
        if (!Number.isFinite(n)) throw new Error(`--dashboard-port: not a number (${v})`)
        out.dashboardPort = n
        break
      }
      case "--host":
        out.host = expect(args, "--host")
        break
      case "--dir":
        out.dataDir = expect(args, "--dir")
        break
      case "--api-url":
        out.apiUrl = expect(args, "--api-url")
        break
      case "--no-open":
        out.noOpen = true
        break
      default:
        out.unknown.push(a)
    }
  }
  return out
}

function expect(args: string[], flag: string): string {
  const v = args.shift()
  if (v == null || v.startsWith("-")) throw new Error(`${flag} requires a value`)
  return v
}

export const HELP_TEXT = `glove-monitor — observability dashboard for Glove agents

Usage:
  gmonitor [command] [options]

Commands:
  start        Boot Hono server and Next.js dashboard together (default).
  server       Boot the Hono API server only.
  dashboard    Boot the Next.js dashboard only (use --api-url to point at a remote server).

Options:
  --config <path>            Path to a config file (default: ./gmonitor.config.{ts,js,mjs}).
  --port <n>                 Hono API server port (default: 4500).
  --dashboard-port <n>       Next.js dashboard port (default: 3000).
  --host <hostname>          Hono bind host (default: localhost).
  --dir <path>               Data directory (default: ./.glove-monitor).
  --api-url <url>            Where the dashboard rewrites /api/* (default: http://host:port).
  --no-open                  Do not open the dashboard in a browser on start.
  -h, --help                 Show this help.

Environment:
  PORT, HOST, GLOVE_MONITOR_DASHBOARD_PORT, GLOVE_MONITOR_API_URL,
  GLOVE_MONITOR_AUTH_USERNAME, GLOVE_MONITOR_AUTH_PASSWORD,
  GLOVE_MONITOR_SESSION_SECRET, GLOVE_MONITOR_ACCESS_TOKEN_SECRET,
  GLOVE_MONITOR_ALLOW_ANONYMOUS_ADMIN

Config file:
  Drop a \`gmonitor.config.ts\` (or .js / .mjs) in your project root. Use
  \`defineConfig\` from "glove-monitor" for type completion. CLI flags
  override env vars, which override the config file, which overrides defaults.
`
