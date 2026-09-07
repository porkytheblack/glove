# Security model

`env:fetch` lets untrusted environment scripts exercise network access granted
by a trusted host. Mounting it is a capability grant: absent domain/origin
restrictions, scripts can contact public HTTP(S) services. Prefer an exact
`allowedOrigins` list and an `authorize(url, method)` callback for narrower API
paths or methods. No script argument can change host policy, private-network
grants, transport configuration, credential aliases, or host resource ceilings.

## Native transport

- Literal IPs and every DNS answer must be public. Loopback, private, link-local,
  carrier-grade NAT, multicast, unspecified, reserved, IPv4-mapped/transition
  IPv6, and known metadata/platform ranges are blocked. IPv6 must also fall in
  global unicast space. Mixed public/private DNS answers fail closed.
- DNS validation is the socket's lookup operation. The connector consumes the
  checked addresses directly, without resolving the hostname again. A new
  connection checks fresh answers; reuse stays on a previously checked socket.
- Redirects are manual internally. Each target passes the URL policy and the
  connection checks. HTTPS downgrades are refused. Cross-origin hops drop all
  headers and cannot replay bodies; POST 301/302 and applicable 303 hops become
  GET before following.
- TLS certificate and hostname verification stay enabled. A request-scoped
  Undici dispatcher avoids ambient global dispatchers/proxies and is destroyed
  when the request finishes or aborts. There is no cookie jar or automatic retry.
- Only an exact `privateNetworkOrigins` host grant permits non-public addresses.
  It does not bypass domain/origin denials. Use it only for an intended internal
  service; the host is deliberately trusting that origin's DNS and endpoint.

This follows the [OWASP SSRF prevention guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
on validating all resolved addresses and enforcing redirect policy. Network
firewalls remain useful defense in depth, especially with unusual routing,
custom NAT64 prefixes, or internal services assigned public address space.

## Credentials and data

Aliases are restricted to exact origins. Host secret values are resolved only
when needed and never deliberately returned in metadata, errors or snapshots.
HTTP credential origins require explicit `allowInsecureHttp` opt-in. Transport
routing/framing headers are refused even if supplied through a credential.

An authorized endpoint receives the configured credential and may echo it back
or return other sensitive data. URL queries, script source/arguments, response
files, and explicitly exposed response headers can persist in history. Use the
host keystore and aliases rather than embedding secrets in scripts. Endpoint
authorization and remote data handling remain application responsibilities.

Uploads only read guarded VFS paths, and responses only write through the guarded
VFS. Size limits count encoded uploads and actual decoded responses. Headers,
redirects, concurrent requests and HTTP work are bounded. No response file is
committed until consumption succeeds. HTTP deadlines and active run termination
abort pending work; late callbacks cannot send another hop or write a result.
Already-sent HTTP effects cannot be rolled back. Filesystem commits already in
progress are awaited and remain subject to the VFS's run-abandonment checks.

Downloaded content is untrusted input. The adapter does not establish that a
document, executable, or instruction in a response is safe to open or act on.
Public-network access also permits data transmission to allowed destinations;
SSRF protection is not a data-loss prevention policy.

## Host extension boundary

A custom `fetch` function is trusted host code. It replaces the native transport
and therefore owns DNS/IP checks, connection pinning, TLS verification, proxy
behavior, response-header limits, and cancellation of actual network effects.
The adapter still applies URL policies, literal-IP restrictions, redirect rules,
body limits, deadlines and VFS guards, but cannot enforce how arbitrary host code
opens sockets. Only supply an audited transport appropriate to the deployment.

Secret stores and authorization callbacks are also trusted host code. Their
errors are sanitized, and their latency falls within the request deadline, but
the adapter cannot forcibly terminate an arbitrary host callback's own work.

## Regression coverage

The tests exercise numeric/encoded/mapped IP forms, metadata destinations, mixed
DNS answers, changed DNS answers on new connections, blocked redirect sockets,
private-origin scoping, TLS downgrade policy, credential scope/redaction, framing
headers, stream expansion/truncation, concurrent output collisions, and run
cancellation, timeout and shutdown. Local HTTP servers verify the socket path;
tests do not probe real internal services or cloud metadata endpoints.
