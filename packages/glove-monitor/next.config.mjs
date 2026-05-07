/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output keeps the production deploy footprint small (we ship
  // it from the CLI binary in `dist/cli.js`).
  output: "standalone",
  // The Hono server runs on :4500 (`dev:server`); the Next dashboard runs on
  // :3000 (`dev:dashboard`). Rewrite `/api/*` to the Hono server so they share
  // an origin from the browser's perspective — keeps cookie-based session auth
  // simple, no CORS dance.
  async rewrites() {
    const apiUrl = process.env.GLOVE_MONITOR_API_URL ?? "http://localhost:4500"
    return [
      { source: "/api/:path*",   destination: `${apiUrl}/api/:path*` },
      { source: "/oauth/:path*", destination: `${apiUrl}/oauth/:path*` },
    ]
  },
  // tsup builds the library; Next builds the dashboard. Don't let Next try to
  // bundle the optional native dep that the SQLite adapter pulls in via
  // `createRequire`.
  serverExternalPackages: ["better-sqlite3"],
}

export default nextConfig
