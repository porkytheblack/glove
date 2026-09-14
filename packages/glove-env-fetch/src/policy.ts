import { domainToASCII } from "node:url";
import { isIP } from "node:net";
import { isPublicAddress } from "./network";

export interface NetworkPolicy {
  /** Exact hostnames or *.example.com for subdomains only. Omit to allow all. Empty denies all. */
  allowedDomains?: string[];
  /** Deny takes precedence over allow. Same syntax as allowedDomains. */
  blockedDomains?: string[];
  /** Optional additional origin restriction, including scheme and port. */
  allowedOrigins?: string[];
  /** Explicit exact origins allowed to reach private/reserved IPs. Default none. */
  privateNetworkOrigins?: string[];
  /** Additional host-owned policy, called on every redirect as well as the initial request. */
  authorize?: (url: URL, method: string) => boolean | Promise<boolean>;
}

function hostname(value: string): string {
  return domainToASCII(value.toLowerCase().replace(/\.$/, ""));
}

function pattern(value: string) {
  if (typeof value !== "string") throw new TypeError("Domain rules must be strings");
  const wildcard = value.startsWith("*.");
  const raw = wildcard ? value.slice(2) : value;
  // Validate BEFORE IDNA conversion: domainToASCII silently drops /paths,
  // ?queries and #fragments. A mistyped deny rule must never weaken policy.
  const ipv6 = raw.startsWith("[") && raw.endsWith("]") && isIP(raw.slice(1, -1)) === 6;
  if (/[/*@\s?#%\\]/.test(raw) || (!ipv6 && raw.includes(":"))) {
    throw new TypeError("Domain rules must be hostnames or *.hostnames; use allowedOrigins for ports");
  }
  const name = hostname(raw);
  if (!name || (!ipv6 && !name.split(".").every(label => /^[a-z0-9_-]+$/.test(label))) || (wildcard && (ipv6 || isIP(name)))) {
    throw new TypeError("Invalid domain rule");
  }
  return (host: string) => wildcard ? host.endsWith(`.${name}`) : host === name;
}

export function origin(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new TypeError("Origins must be HTTP(S) scheme and host with optional port, without credentials, paths or queries");
  }
  url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  return url.origin;
}

export function createPolicy(policy: NetworkPolicy) {
  for (const key of ["allowedDomains", "blockedDomains", "allowedOrigins", "privateNetworkOrigins"] as const) {
    if (policy[key] !== undefined && (!Array.isArray(policy[key]) || policy[key]!.some(value => typeof value !== "string"))) {
      throw new TypeError(`${key} must be an array of strings`);
    }
  }
  if (policy.authorize !== undefined && typeof policy.authorize !== "function") throw new TypeError("authorize must be a function");
  const allowed = policy.allowedDomains?.map(pattern);
  const blocked = policy.blockedDomains?.map(pattern) ?? [];
  const origins = policy.allowedOrigins?.map(origin);
  const privateOrigins = new Set(policy.privateNetworkOrigins?.map(origin));
  const customAuthorize = policy.authorize;
  return async (input: string, method: string): Promise<URL> => {
    let url: URL;
    try { url = new URL(input); } catch { throw new Error("Request URL must be an absolute HTTP(S) URL"); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) {
      throw new Error("Only HTTP(S) URLs without embedded credentials are supported");
    }
    // Normalize DNS spelling before both matching and fetching.
    url.hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    url.hash = "";
    const host = hostname(url.hostname);
    const address = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(address) && !privateOrigins.has(url.origin) && !isPublicAddress(address)) {
      throw new Error("Request IP destination is blocked by the host network policy");
    }
    if (blocked.some(matches => matches(host)) || (allowed && !allowed.some(matches => matches(host))) ||
        (origins && !origins.includes(url.origin))) {
      throw new Error("Request destination is blocked by the host network policy");
    }
    if (customAuthorize) {
      let permitted = false;
      try { permitted = (await customAuthorize(new URL(url), method)) === true; } catch { /* do not leak provider errors */ }
      if (!permitted) throw new Error("Request destination is blocked by the host network policy");
    }
    return url;
  };
}
