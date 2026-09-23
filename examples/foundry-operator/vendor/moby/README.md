Moby default seccomp policy, unmodified.

Source: https://github.com/moby/profiles/blob/245180c51918481c0525424b3ee025d2b435d46c/seccomp/default.json

Apache-2.0; see LICENSE. Denies unlisted syscalls; Docker resolves architecture and capability conditions. Operator drops all Linux capabilities and runs as UID 1000. This explicit policy also works when Docker Desktop reports its daemon default as unconfined.
