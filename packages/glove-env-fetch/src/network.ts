import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import type { LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, Pool, fetch, type RequestInit as UndiciRequestInit } from "undici";

/** Fail closed for non-public, mapped, transition and reserved addresses. */
export function isPublicAddress(address: string): boolean {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  if (parsed.kind() === "ipv4") {
    // Azure's platform/metadata virtual IP sits outside the private ranges.
    return parsed.range() === "unicast" && address !== "168.63.129.16";
  }
  return parsed.range() === "unicast" && parsed.match(ipaddr.parse("2000::"), 3);
}

type Resolver = (hostname: string) => Promise<LookupAddress[]>;
const resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true });

/** The socket consumes these exact answers: no separate preflight DNS lookup. */
export function guardedLookup(allowPrivate: boolean, resolver: Resolver = resolve): LookupFunction {
  return (hostname, options, callback) => {
    void (async () => {
      let addresses: LookupAddress[];
      try {
        addresses = await resolver(hostname);
        if (!addresses.length || addresses.some(({ address, family }) =>
          !isIP(address) || isIP(address) !== family || (!allowPrivate && !isPublicAddress(address)))) {
          throw new Error();
        }
        const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
        if (family) addresses = addresses.filter(address => address.family === family);
        if (!addresses.length) throw new Error();
      } catch {
        callback(new Error("DNS destination is unavailable or blocked by network policy"), []);
        return;
      }
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    })();
  };
}

/** A request-scoped dispatcher cannot inherit an ambient proxy/global dispatcher. */
export function createTransport(privateOrigins: ReadonlySet<string>, resolver?: Resolver) {
  const dispatcher = new Agent({
    factory(origin, options) {
      const url = new URL(origin);
      const allowPrivate = privateOrigins.has(url.origin);
      const address = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(address) && !allowPrivate && !isPublicAddress(address)) {
        throw new Error("IP destination is blocked by network policy");
      }
      return new Pool(origin, {
        ...options,
        connections: 1,
        maxHeaderSize: 16 * 1024,
        autoSelectFamily: true,
        connect: { lookup: guardedLookup(allowPrivate, resolver), rejectUnauthorized: true },
      });
    },
  });
  return {
    async fetch(url: string, init: RequestInit): Promise<Response> {
      // Both are WHATWG requests/responses; Undici's declarations additionally
      // support Node streams and differ from the ambient DOM declarations.
      return await fetch(url, { ...init, dispatcher } as UndiciRequestInit) as unknown as Response;
    },
    async close() { await dispatcher.destroy(); },
  };
}
