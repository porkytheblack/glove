---
"glove-env-fetch": minor
"glove-env-secret": minor
"glove-working-environment": patch
---

Add HTTP requests, VFS downloads and uploads with developer-controlled domain
allowlists/denylists, origin restrictions, redirect checks, JSON, URL-encoded
forms, multipart uploads, bounded response streaming and host-configured
credential aliases. Bound policy/credential resolution and HTTP work with host
deadlines and cancellation, recheck each redirect, and prevent late results or
overlapping requests from overwriting response files. Add a host-backed keystore
with per-environment in-memory defaults, a pluggable persistent-store contract,
scoped key names, references, and explicit opt-in for revealing or writing
secret values. Keep stored secrets out of VFS snapshots and permit fetch to
resolve credentials directly from the host keystore.

Block non-public IP destinations by default, validate every DNS answer at socket
lookup time, and require exact private-network origin opt-ins. Refuse HTTPS
downgrades and insecure credential configuration, bound headers/concurrency,
and expose a live AdapterContext.signal that aborts host capabilities when a
run ends, including timeout, worker failure and environment shutdown.

Ship HTTP and keystore recipes in the environment's /skills directory and a
host setup/persistence guide with the core package. Update repository skills,
Foundry documentation, website guides and LLM reference text to describe explicit
network capabilities, credential grants and cancellation consistently.
