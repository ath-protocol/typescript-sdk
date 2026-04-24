# ATH TypeScript SDK

[中文](README.md)

> 🔌 Add trusted agent interactions to your TypeScript/JavaScript project in 5 minutes

## Overview

This is the official TypeScript SDK for the [Agent Trust Handshake (ATH) Protocol](https://github.com/ath-protocol/agent-trust-handshake-protocol), designed for frontend and Node.js developers. Build trusted agent-to-service interactions without dealing with low-level protocol details.

## Features

- ✅ Supports both Gateway Mode and Native Mode deployment
- ✅ Full TypeScript type definitions for a first-class developer experience
- ✅ Built-in ES256 JWT signing with `jti` replay protection
- ✅ Automatic PKCE (RFC 7636) + CSRF state parameter protection
- ✅ Three-way scope intersection: `Effective = Agent Approved ∩ User Consented ∩ Requested`
- ✅ Compatible with Node.js 18+

## Installation

```bash
# Client (for building agents)
npm install @ath-protocol/client @ath-protocol/types

# Server (for building gateways / ATH-native services)
npm install @ath-protocol/server @ath-protocol/types
```

## Quick Start — Gateway Mode

### Step 1: Initialize the client

```typescript
import { generateKeyPair } from 'jose';
import { ATHGatewayClient } from '@ath-protocol/client';

// Generate an ES256 key pair for agent attestation
const { privateKey } = await generateKeyPair('ES256');

const client = new ATHGatewayClient({
  url: 'https://your-ath-gateway.com',
  agentId: 'https://your-agent.example.com/.well-known/agent.json',
  privateKey,
  keyId: 'my-key-1',
});
```

### Step 2: Discover services and register the agent

```typescript
// Discover available service providers
const discovery = await client.discover();
console.log('Providers:', discovery.supported_providers.map(p => p.display_name));

// Register the agent and request capabilities (Phase A: app-side authorization)
const reg = await client.register({
  developer: { name: 'Example Corp', id: 'dev-123' },
  providers: [{ provider_id: 'github', scopes: ['repo', 'read:user'] }],
  purpose: 'Code review assistant',
});
console.log('Status:', reg.agent_status);
console.log('Approved scopes:', reg.approved_providers[0].approved_scopes);
```

### Step 3: User authorization and token exchange

```typescript
// Initiate user authorization flow (Phase B: user-side OAuth consent)
const auth = await client.authorize('github', ['repo']);
console.log('Direct user to:', auth.authorization_url);
// User completes OAuth consent in their browser...

// After consent, exchange the authorization code for an ATH access token
const token = await client.exchangeToken(code, auth.ath_session_id);
console.log('Access token:', token.access_token);
console.log('Effective scopes:', token.effective_scopes);
console.log('Scope intersection:', token.scope_intersection);
```

### Step 4: Call APIs and revoke

```typescript
// Call upstream service APIs through the gateway proxy
const user = await client.proxy('github', 'GET', '/user');
console.log('User info:', user);

// Revoke the token when done
await client.revoke();
```

## Quick Start — Native Mode

```typescript
import { generateKeyPair } from 'jose';
import { ATHNativeClient } from '@ath-protocol/client';

const { privateKey } = await generateKeyPair('ES256');

const client = new ATHNativeClient({
  url: 'https://mail-service.example.com',
  agentId: 'https://your-agent.example.com/.well-known/agent.json',
  privateKey,
});

// Discover the service (fetches /.well-known/ath-app.json)
const disc = await client.discover();

// Register → Authorize → Token (same flow as gateway mode)
await client.register({
  developer: { name: 'Example Corp', id: 'dev-123' },
  providers: [{ provider_id: disc.app_id, scopes: ['mail:read'] }],
  purpose: 'Mail reader',
});
const auth = await client.authorize(disc.app_id, ['mail:read']);
// ... user consent ...
const token = await client.exchangeToken(code, auth.ath_session_id);

// Call the service API directly
const messages = await client.api('GET', '/v1/messages');
```

## Quick Start — Server (Gateway / Native Service)

```typescript
import {
  createATHHandlers,
  InMemoryAgentRegistry,
  InMemoryTokenStore,
  InMemorySessionStore,
} from '@ath-protocol/server';

const handlers = createATHHandlers({
  registry: new InMemoryAgentRegistry(),
  tokenStore: new InMemoryTokenStore(),
  sessionStore: new InMemorySessionStore(),
  config: {
    audience: 'https://your-service.com',
    callbackUrl: 'https://your-service.com/ath/callback',
    availableScopes: ['read', 'write'],
    appId: 'my-service',
    oauth: {
      authorize_endpoint: 'https://oauth-provider.com/authorize',
      token_endpoint: 'https://oauth-provider.com/token',
      client_id: 'your-oauth-client-id',
      client_secret: 'your-oauth-client-secret',
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

## Packages

| Package | Description | When to Use |
|---------|-------------|-------------|
| `@ath-protocol/client` | Client SDK (`ATHGatewayClient` + `ATHNativeClient`) | Most developers only need this |
| `@ath-protocol/types` | Protocol types + Zod validators (auto-generated from schema) | TypeScript projects |
| `@ath-protocol/server` | Server SDK (handler framework, registries, token stores, proxy) | Building ATH gateways or services |

## Protocol v0.1 Security Features

| Feature | Description |
|---------|-------------|
| JWT `jti` replay protection | Each attestation JWT includes a unique `jti`; servers can reject replayed attestations |
| `state` required | Authorization requests must include a CSPRNG-generated 128-bit `state` parameter |
| Token exchange attestation | `exchangeToken` requires a fresh `agent_attestation` JWT |
| Revocation authentication | Agent-initiated revocation requires `client_secret` (per RFC 7009) |
| Redirect URI exact-match | `redirect_uris` are validated via exact-match comparison |
| Scope intersection | `Effective = Agent Approved ∩ User Consented ∩ Requested` |

## Use Cases

- 🌐 Browser-based AI applications
- 🖥️ Node.js server-side integrations
- 💻 Cross-platform Electron apps
- 📱 Mobile web / mini-program development
- 🔌 Browser extension development

## Development

```bash
pnpm install          # Install dependencies
pnpm run generate     # Regenerate types from protocol schema
pnpm run build        # Build all packages
pnpm run test         # Run server unit tests (36 tests)
pnpm run test:e2e     # Run E2E integration tests (40 tests)
pnpm run test:all     # Run all tests (76 tests)
```

## Project Structure

```
packages/
  types/          Auto-generated protocol types + Zod validators
  client/         Gateway and native client implementations
  server/         Handler framework, registries, token stores, proxy
test/
  e2e-gateway.test.ts              Gateway mode E2E tests
  e2e-native.test.ts               Native mode E2E tests
  e2e-protocol-compliance.test.ts  Protocol v0.1 compliance tests
  mock-oauth-server.ts             Mock OAuth2 server for testing
examples/
  client-basic.ts                  Basic gateway client example
scripts/
  generate.ts                      Schema-to-TypeScript codegen
```

## Documentation

- [Full API Documentation](https://athprotocol.dev/docs/sdk/typescript)
- [Example Projects](https://github.com/ath-protocol/typescript-sdk/tree/main/examples)
- [ATH Protocol Specification](https://github.com/ath-protocol/agent-trust-handshake-protocol)
- [FAQ](https://athprotocol.dev/docs/faq)

## Architecture

```
Your TypeScript Project → This SDK → ATH Gateway → Backend Services
                              ↘ Native Mode Direct ↗
```

The SDK handles all the complex logic — registration, attestation, authorization, proxy, and revocation — so you can focus on your business code.

## License

This project uses the **OpenATH License**. See the [LICENSE](LICENSE) file for details.
