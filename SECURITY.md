# Security

hook-stage is a local developer tool. It binds to loopback, sends webhooks only to loopback targets, and refuses redirects.

## Reporting

Please report vulnerabilities privately through [GitHub security advisories](https://github.com/bymustfa/hook-stage/security/advisories/new).

Do not open a public issue for a security report.

## What this version does not claim

- It does not redact every secret you paste into an event body. Treat the local SQLite file (`.hook-stage/`) as sensitive if your payloads are.
- It does not forge Stripe, GitHub, or Shopify signatures.
- It does not expose the tool on a public interface. Binding a non-loopback host is rejected.
- A confirmed fixture reset hook calls only the path you saved. The tool does not invent a wipe of your application database.
- Cancel does not undo a request the target already accepted.

## Hardening already in place

- Loopback listener and loopback targets only.
- Session token on API calls, plus an origin allowlist for browser requests.
- Body size, delivery timeout, verification timeout, and concurrency caps.
- No automatic retry and no resume after process restart.
