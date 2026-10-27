import "server-only";
import { NextResponse } from "next/server";
import { HttpError } from "glove-foundry-web-kit/server";

/** A JSON object body, or a 400. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json().catch(() => undefined) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Send a JSON object.");
  return value as Record<string, unknown>;
}

/** A trimmed string field of at most `max` characters, or a 400. */
export function text(value: unknown, what: string, max: number, options: { readonly optional?: boolean } = {}): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed && !options.optional) throw new HttpError(400, `${what} is empty.`);
  if (trimmed.length > max) throw new HttpError(400, `${what} is longer than ${max} characters.`);
  return trimmed;
}

/** This app's address as the browser sees it: WEB_URL, or the request's forwarded host. */
export function origin(request: Request): string {
  if (process.env.WEB_URL) return process.env.WEB_URL.replace(/\/$/, "");
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

/** A 303 to a path on this app. The Location is relative, so it works behind any proxy. */
export function seeOther(path: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { location: path } });
}
