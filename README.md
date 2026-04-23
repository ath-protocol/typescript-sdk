# ATH TypeScript SDK

> TypeScript SDK for the [Agent Trust Handshake (ATH) Protocol](https://github.com/ath-protocol/agent-trust-handshake-protocol) — build trusted agent-to-service interactions in minutes.

## Overview

This is the official TypeScript SDK for the ATH protocol. It provides both **client** and **server** packages so you can:

- **Build agents** that register, authenticate, and call services through an ATH gateway or directly via native mode.
- **Build gateways/services** that implement ATH endpoints (register, authorize, token, proxy, revoke).

The SDK implements ATH Protocol v0.1 including:

- ES256 JWT attestation with `jti` replay protection
- Two-phase trusted handshake (Phase A: app-side registration, Phase B: user-side OAuth consent)
- PKCE (RFC 7636) with S256 challenge method
- Scope intersection enforcement: `Effective = Agent Approved ∩ User Consented ∩ Requested`
- Resource Indicators (RFC 8707)
- Token revocation with client authentication (RFC 7009)

## Packages

| Package | Description |
|---------|-------------|
| `@ath-protocol/client` | Client SDK — `ATHGatewayClient` and `ATHNativeClient` |
| `@ath-protocol/server` | Server SDK — handlers, registries, token stores, proxy |
| `@ath-protocol/types` | Protocol types + Zod validators (auto-generated from schema) |

## Installation

```bash
# Client (agents)
npm install @ath-protocol/client @ath-protocol/types

# Server (gateways / services)
npm install @ath-protocol/server @ath-protocol/types
```

## Quick Start — Gateway Mode (Agent)

```typescript
import { generateKeyPair } from "jose";
import { ATHGatewayClient } from "@ath-protocol/client";

const { privateKey } = await generateKeyPair("ES256");

const client = new ATHGatewayClient({
  url: "https://your-ath-gateway.com",
  agentId: "https://your-agent.example.com/.well-known/agent.json",
  privateKey,
  keyId: "my-key-1",
});

// 1. Discover available providers
const discovery = await client.discover();
console.log("Providers:", discovery.supported_providers.map(p => p.display_name));

// 2. Register the agent
const reg = await client.register({
  developer: { name: "My Org", id: "dev-123" },
  providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
  purpose: "CI automation agent",
});
console.log("Approved scopes:", reg.approved_providers[0].approved_scopes);

// 3. Authorize (user consent flow)
const auth = await client.authorize("github", ["repo"]);
console.log("Direct user to:", auth.authorization_url);
// User completes OAuth consent in their browser...

// 4. Exchange token (after user consents)
const token = await client.exchangeToken(code, auth.ath_session_id);
console.log("Access token:", token.access_token);
console.log("Effective scopes:", token.effective_scopes);

// 5. Call APIs via the gateway proxy
const user = await client.proxy("github", "GET", "/user");

// 6. Revoke when done
await client.revoke();
```

## Quick Start — Native Mode (Agent)

```typescript
import { generateKeyPair } from "jose";
import { ATHNativeClient } from "@ath-protocol/client";

const { privateKey } = await generateKeyPair("ES256");

const client = new ATHNativeClient({
  url: "https://mail-service.example.com",
  agentId: "https://your-agent.example.com/.well-known/agent.json",
  privateKey,
});

const disc = await client.discover();  // fetches /.well-known/ath-app.json
await client.register({
  developer: { name: "My Org", id: "dev-123" },
  providers: [{ provider_id: disc.app_id, scopes: ["mail:read"] }],
  purpose: "Mail reader",
});

const auth = await client.authorize(disc.app_id, ["mail:read"]);
// ... user consent flow ...
const token = await client.exchangeToken(code, auth.ath_session_id);

// Call the service API directly
const messages = await client.api("GET", "/v1/messages");
```

## Quick Start — Server (Gateway / Native Service)

```typescript
import {
  createATHHandlers,
  InMemoryAgentRegistry,
  InMemoryTokenStore,
  InMemorySessionStore,
} from "@ath-protocol/server";

const handlers = createATHHandlers({
  registry: new InMemoryAgentRegistry(),
  tokenStore: new InMemoryTokenStore(),
  sessionStore: new InMemorySessionStore(),
  config: {
    audience: "https://your-service.com",
    callbackUrl: "https://your-service.com/ath/callback",
    availableScopes: ["read", "write"],
    appId: "my-service",
    oauth: {
      authorize_endpoint: "https://oauth-provider.com/authorize",
      token_endpoint: "https://oauth-provider.com/token",
      client_id: "your-oauth-client-id",
      client_secret: "your-oauth-client-secret",
    },
  },
});

// Wire handlers to your HTTP framework (Express, Hono, Fastify, etc.)
// handlers.register(req)   — POST /ath/agents/register
// handlers.authorize(req)  — POST /ath/authorize
// handlers.callback(req)   — GET  /ath/callback
// handlers.token(req)      — POST /ath/token
// handlers.revoke(req)     — POST /ath/revoke
```

## Protocol Security Features

### Attestation JWT with `jti` (v0.1)

Every attestation JWT includes a unique `jti` claim for replay protection. The server can optionally enable replay detection:

```typescript
import { InMemoryJtiCache } from "@ath-protocol/server";

// Pass a jti cache to verifyAttestation to reject replayed attestations
const result = await verifyAttestation(token, {
  audience: "https://your-service.com",
  jtiCache: new InMemoryJtiCache(),
});
```

### Required Fields (v0.1)

- **`state`** is required in `AuthorizationRequest` — generated from CSPRNG with 128+ bits of entropy
- **`agent_attestation`** is required in `TokenExchangeRequest` — proves current possession of the agent's private key
- **`client_secret`** is required for agent-initiated token revocation (per RFC 7009)
- **`redirect_uris`** are validated via exact-match during authorization

### Scope Intersection

Tokens are issued with the intersection of three scope sets:

```
Effective = Agent Approved ∩ User Consented ∩ Requested
```

The `TokenResponse` includes a full `scope_intersection` breakdown.

## Development

```bash
# Install dependencies
pnpm install

# Regenerate types from protocol schema
pnpm run generate

# Build all packages
pnpm run build

# Run server unit tests
pnpm run test

# Run E2E integration tests
pnpm run test:e2e

# Run all tests
pnpm run test:all
```

## Project Structure

```
packages/
  types/          Auto-generated protocol types + Zod validators
  client/         Gateway and native client implementations
  server/         Handler framework, registries, token stores, proxy
test/
  e2e-gateway.test.ts              Gateway mode E2E
  e2e-native.test.ts               Native mode E2E
  e2e-protocol-compliance.test.ts  Protocol compliance E2E (22 tests)
  mock-oauth-server.ts             Mock OAuth2 server for tests
examples/
  client-basic.ts                  Basic gateway client example
scripts/
  generate.ts                      Schema-to-TypeScript codegen
```

## Protocol Specification

See the [ATH Protocol Specification](https://github.com/ath-protocol/agent-trust-handshake-protocol) for the full protocol documentation, including:

- [Agent Registration](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/specification/0.1/server/registration.mdx)
- [Authorization](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/specification/0.1/server/authorization.mdx)
- [Token Exchange](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/specification/0.1/server/token.mdx)
- [Token Revocation](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/specification/0.1/server/revocation.mdx)
- [API Proxy](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/specification/0.1/server/proxy.mdx)

## License

OpenATH License — see [LICENSE](LICENSE) for details.
