#!/usr/bin/env node
// One-shot setup for the coffee demo's glove-monitor instance.
//
//   1. Wait for gmonitor's Hono server to be up on http://127.0.0.1:4500.
//   2. If a "coffee-demo" project doesn't exist yet, create it and mint a
//      registration token.
//   3. Write `GLOVE_MONITOR_URL` and `GLOVE_MONITOR_REG_TOKEN` into
//      `.env.local` so the relay route handler picks them up.
//
// Idempotent: re-running detects the existing project + an unrevoked token
// from this same script (matched on `name = "coffee-demo-bootstrap"`) and
// reuses them. If the existing token's hash isn't in `.env.local`, you'll
// need to revoke it via the dashboard and re-run; tokens are only
// retrievable at creation time.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const COFFEE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const MONITOR_URL = process.env.GLOVE_MONITOR_URL ?? "http://127.0.0.1:4500"
const PROJECT_SLUG = "coffee-demo"
const PROJECT_NAME = "Coffee Demo"
const TOKEN_NAME = "coffee-demo-bootstrap"
const ENV_PATH = resolve(COFFEE_DIR, ".env.local")
const HEADERS = { "content-type": "application/json", "x-glove-project": PROJECT_SLUG }

async function main() {
  console.log(`[bootstrap] waiting for glove-monitor at ${MONITOR_URL}…`)
  await waitForHealth()

  console.log(`[bootstrap] looking for project "${PROJECT_SLUG}"…`)
  let project = await findProject()
  if (!project) {
    project = await createProject()
    console.log(`[bootstrap] created project ${project.id} (${project.slug})`)
  } else {
    console.log(`[bootstrap] reusing project ${project.id} (${project.slug})`)
  }

  console.log(`[bootstrap] checking existing tokens for "${TOKEN_NAME}"…`)
  const existing = await findUnrevokedToken(project.id)
  if (existing) {
    const envToken = readEnvVar(ENV_PATH, "GLOVE_MONITOR_REG_TOKEN")
    if (envToken && envToken.startsWith(existing.tokenPrefix)) {
      console.log(`[bootstrap] existing token ${existing.tokenPrefix}… already in .env.local — nothing to do.`)
      return
    }
    console.error(
      `[bootstrap] a "${TOKEN_NAME}" token already exists (${existing.tokenPrefix}…) but it's not in .env.local.\n` +
      `  Tokens are only retrievable at creation time. Either:\n` +
      `    - paste the token into .env.local manually, OR\n` +
      `    - revoke it in the dashboard and re-run \`pnpm monitor:bootstrap\`.`
    )
    process.exit(1)
  }

  console.log(`[bootstrap] minting registration token "${TOKEN_NAME}"…`)
  const token = await createToken(project.id)
  console.log(`[bootstrap] token: ${token.tokenPrefix}… (full value written to .env.local)`)

  writeEnv(ENV_PATH, {
    GLOVE_MONITOR_URL: MONITOR_URL,
    GLOVE_MONITOR_REG_TOKEN: token.token,
  })
  console.log(`[bootstrap] wrote ${ENV_PATH}`)
  console.log("[bootstrap] done. Now run \`pnpm dev\` in another terminal.")
}

async function waitForHealth() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${MONITOR_URL}/api/v1/health`)
      if (res.ok) return
    } catch { /* not up yet */ }
    await sleep(500)
  }
  console.error(`[bootstrap] timed out waiting for ${MONITOR_URL}.`)
  console.error("  Did you forget to run \`pnpm monitor\` in another terminal?")
  process.exit(1)
}

async function findProject() {
  const res = await fetch(`${MONITOR_URL}/api/v1/projects`, { headers: HEADERS })
  if (!res.ok) throw new Error(`listProjects ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body.data.find((p) => p.slug === PROJECT_SLUG) ?? null
}

async function createProject() {
  const res = await fetch(`${MONITOR_URL}/api/v1/projects`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ slug: PROJECT_SLUG, name: PROJECT_NAME }),
  })
  if (!res.ok) throw new Error(`createProject ${res.status}: ${await res.text()}`)
  return (await res.json()).data
}

async function findUnrevokedToken(projectId) {
  const res = await fetch(
    `${MONITOR_URL}/api/v1/projects/${encodeURIComponent(projectId)}/registration-tokens`,
    { headers: HEADERS },
  )
  if (!res.ok) throw new Error(`listTokens ${res.status}: ${await res.text()}`)
  const body = await res.json()
  return body.data.find((t) => t.name === TOKEN_NAME && !t.revoked) ?? null
}

async function createToken(projectId) {
  const res = await fetch(
    `${MONITOR_URL}/api/v1/projects/${encodeURIComponent(projectId)}/registration-tokens`,
    {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ name: TOKEN_NAME }),
    },
  )
  if (!res.ok) throw new Error(`createToken ${res.status}: ${await res.text()}`)
  return (await res.json()).data
}

// ─── .env.local helpers ───────────────────────────────────────────────

function readEnvVar(path, key) {
  if (!existsSync(path)) return null
  const text = readFileSync(path, "utf8")
  const re = new RegExp(`^${escapeRegex(key)}=(.*)$`, "m")
  const m = text.match(re)
  return m ? m[1].trim() : null
}

function writeEnv(path, updates) {
  mkdirSync(dirname(path), { recursive: true })
  let text = existsSync(path) ? readFileSync(path, "utf8") : ""
  for (const [key, val] of Object.entries(updates)) {
    const re = new RegExp(`^${escapeRegex(key)}=.*$`, "m")
    if (re.test(text)) {
      text = text.replace(re, `${key}=${val}`)
    } else {
      if (text.length > 0 && !text.endsWith("\n")) text += "\n"
      text += `${key}=${val}\n`
    }
  }
  writeFileSync(path, text, "utf8")
}

function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

main().catch((err) => {
  console.error("[bootstrap] failed:", err.message ?? err)
  process.exit(1)
})
