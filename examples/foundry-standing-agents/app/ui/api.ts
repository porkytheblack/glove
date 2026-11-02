/** Calls the app's own API; an error's message is the server's, which is safe to show. */
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "That didn't work. Try again.");
  return body;
}

export const postJson = <T>(url: string, body: unknown, method = "POST") => request<T>(url, { method, body: JSON.stringify(body) });
export const getJson = <T>(url: string) => request<T>(url, { cache: "no-store" });
