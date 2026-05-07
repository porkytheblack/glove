import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"

/**
 * Runtime proxy for `/api/*` and `/oauth/*` to the configured Hono server.
 *
 * `next.config.mjs`'s `rewrites()` bakes destinations into `routes-manifest.json`
 * at build time, so a runtime change to `GLOVE_MONITOR_API_URL` (e.g. when the
 * CLI's `start` command spawns the dashboard with a non-default Hono port)
 * is ignored. Middleware runs per-request and *does* read env at runtime, so
 * it's the right hook for runtime-configurable forwarding.
 *
 * The static `next.config.mjs` rewrites are still useful as the default
 * (when the env var is unset they get the same destination), but middleware
 * takes precedence when `GLOVE_MONITOR_API_URL` is set.
 */
export function middleware(req: NextRequest): NextResponse | undefined {
  const apiUrl = process.env.GLOVE_MONITOR_API_URL
  if (!apiUrl) return  // fall through to next.config rewrites

  const { pathname, search } = req.nextUrl
  if (pathname.startsWith("/api/") || pathname.startsWith("/oauth/")) {
    const target = new URL(apiUrl)
    target.pathname = pathname
    target.search = search
    return NextResponse.rewrite(target)
  }
  return
}

export const config = {
  matcher: ["/api/:path*", "/oauth/:path*"],
}
