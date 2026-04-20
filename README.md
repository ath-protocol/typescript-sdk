# ATH TypeScript SDK

TypeScript SDK for the [Agent Trust Handshake (ATH) Protocol](https://github.com/ath-protocol/agent-trust-handshake-protocol) — an open, lightweight protocol for establishing trusted connections between AI agents and external services.

## Packages

| Package | npm | Description |
|---------|-----|-------------|
| [`@agenttrusthandshake/types`](packages/types) | Protocol types | Auto-generated TypeScript types and Zod validators from the [ATH JSON Schema](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/schema/0.1/schema.json) |
| [`@agenttrusthandshake/client`](packages/client) | ATH client | Build AI agents that connect to ATH gateways and native services |
| [`@agenttrusthandshake/server`](packages/server) | ATH server | Build ATH gateways and native ATH implementations |

## Installation

### Agent developers (client)

```bash
npm install @agenttrusthandshake/client
```

### Gateway / service implementors (server)

```bash
npm install @agenttrusthandshake/server
```

### Types only

```bash
npm install @agenttrusthandshake/types
```

## Quick Start

### Client — connect an agent to an ATH gateway

```typescript
import { ATHClient } from "@agenttrusthandshake/client";
import { generateKeyPair } from "jose";

const { privateKey } = await generateKeyPair("ES256");

const client = new ATHClient({
  gatewayUrl: "http://localhost:3000",
  agentId: "https://my-agent.example.com/.well-known/agent.json",
  privateKey,
});

// 1. Discover available providers
const discovery = await client.discover();

// 2. Register agent (Phase A: app-side authorization)
const reg = await client.register({
  developer: { name: "My Company", id: "dev-001" },
  providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
  purpose: "Code review assistant",
});

// 3. Start user authorization (Phase B: user-side authorization)
const auth = await client.authorize("github", ["repo", "read:user"]);
// Direct user to auth.authorization_url for OAuth consent

// 4. Exchange for ATH token (after user consents)
const token = await client.exchangeToken(code, auth.ath_session_id);

// 5. Call APIs through the gateway proxy
const user = await client.proxy("github", "GET", "/user");

// 6. Revoke when done
await client.revoke();
```

### Server — build an ATH implementor

```typescript
import {
  verifyAttestation,
  intersectScopes,
  InMemoryAgentRegistry,
  InMemoryTokenStore,
  InMemorySessionStore,
  generateCredentials,
} from "@agenttrusthandshake/server";

// Verify agent attestation JWTs (uses `jose` under the hood)
const result = await verifyAttestation(jwt, {
  audience: "https://my-gateway.example.com",
  publicKey, // or use resolvePublicKey to fetch from agent_id URI
});

// Compute scope intersection (trusted handshake enforcement)
const scopes = intersectScopes(
  agentApprovedScopes,
  userConsentedScopes,
  requestedScopes,
);
// scopes.effective = intersection of all three
```

## Schema Codegen

Types are auto-generated from the canonical [ATH JSON Schema](https://github.com/ath-protocol/agent-trust-handshake-protocol/blob/main/schema/0.1/schema.json):

```bash
cd typescript-sdk
npx tsx scripts/generate.ts
```

This downloads `schema.json` and `meta.json` from the spec repo and generates:
- `packages/types/src/schema/types.gen.ts` — TypeScript interfaces
- `packages/types/src/schema/zod.gen.ts` — Zod validators
- `packages/types/src/schema/index.ts` — barrel with endpoint constants and protocol version

## Examples

```bash
# Start the reference gateway
pnpm --filter ath-gateway dev

# Run the client example (in another terminal)
npx tsx typescript-sdk/examples/client-basic.ts
```

## Development

```bash
# Install dependencies
pnpm install

# Generate types from schema
cd typescript-sdk && npx tsx scripts/generate.ts && cd ..

# Build all SDK packages
pnpm --filter @agenttrusthandshake/types build
pnpm --filter @agenttrusthandshake/client build
pnpm --filter @agenttrusthandshake/server build

# Run tests
pnpm --filter @agenttrusthandshake/server test   # 17 unit tests
pnpm --filter @agenttrusthandshake/client test   # 5 E2E tests
pnpm --filter ath-gateway test                   # 27 gateway tests
```

## Architecture

```
ath-protocol/agent-trust-handshake-protocol    ← Spec repo (source of truth)
    schema/0.1/schema.json                      ← JSON Schema for all protocol types
    schema/0.1/meta.json                        ← Endpoint definitions + protocol version

typescript-sdk/                                 ← This SDK
    scripts/generate.ts                         ← Downloads schema → generates types
    packages/
        types/    → @agenttrusthandshake/types   (auto-generated, zero runtime deps)
        client/   → @agenttrusthandshake/client  (depends on types + jose)
        server/   → @agenttrusthandshake/server  (depends on types + jose)
    examples/
        client-basic.ts                         ← Runnable agent example
```

## License

MIT
