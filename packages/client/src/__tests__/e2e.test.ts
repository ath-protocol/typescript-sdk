/**
 * E2E Test: ATHClient SDK against the reference gateway (Hono app).
 *
 * Uses the gateway's in-process Hono app (no real HTTP server needed).
 * Patches global fetch to route requests through Hono's `app.request()`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { generateKeyPair } from "jose";
import { ATHClient } from "../client.js";
import { ATHClientError } from "../errors.js";

// Import gateway internals for in-process testing
import { app } from "../../../../../packages/gateway/src/app.js";
import { agentStore } from "../../../../../packages/gateway/src/registry/agent-store.js";
import { tokenStore } from "../../../../../packages/gateway/src/auth/token.js";
import { sessionStore } from "../../../../../packages/gateway/src/auth/session-store.js";
import { providerStore } from "../../../../../packages/gateway/src/providers/store.js";

const GATEWAY_URL = "http://localhost:3000";

/**
 * Patch global fetch to route through Hono's app.request().
 * This allows ATHClient (which uses fetch) to talk to the gateway in-process.
 */
const originalFetch = globalThis.fetch;

function patchedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

  if (url.startsWith(GATEWAY_URL)) {
    const path = url.slice(GATEWAY_URL.length) || "/";
    return app.request(path, {
      method: init?.method || "GET",
      headers: init?.headers as Record<string, string>,
      body: init?.body as string,
    });
  }

  return originalFetch(input, init);
}

describe("ATHClient E2E against reference gateway", () => {
  let client: ATHClient;
  let keypair: Awaited<ReturnType<typeof generateKeyPair>>;

  beforeAll(async () => {
    agentStore.clear();
    tokenStore.clear();
    sessionStore.clear();
    providerStore.clearCache();

    globalThis.fetch = patchedFetch as typeof fetch;

    keypair = await generateKeyPair("ES256");
    client = new ATHClient({
      gatewayUrl: GATEWAY_URL,
      agentId: "https://sdk-test-agent.example.com/.well-known/agent.json",
      privateKey: keypair.privateKey,
      keyId: "sdk-test-key",
    });
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
    agentStore.clear();
    tokenStore.clear();
    sessionStore.clear();
  });

  it("discovers the gateway", async () => {
    const discovery = await client.discover();
    expect(discovery.ath_version).toBe("0.1");
    expect(discovery.gateway_id).toBeTruthy();
    expect(discovery.supported_providers.length).toBeGreaterThan(0);
    expect(discovery.supported_providers.some((p) => p.provider_id === "github")).toBe(true);
  });

  it("registers the agent", async () => {
    const reg = await client.register({
      developer: { name: "SDK Test", id: "dev-sdk-test" },
      providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
      purpose: "SDK E2E test",
    });

    expect(reg.client_id).toBeTruthy();
    expect(reg.client_secret).toBeTruthy();
    expect(reg.agent_status).toBe("approved");
    expect(reg.approved_providers[0].approved_scopes).toContain("repo");
  });

  it("initiates authorization", async () => {
    const auth = await client.authorize("github", ["repo", "read:user"]);
    expect(auth.authorization_url).toBeTruthy();
    expect(auth.ath_session_id).toBeTruthy();
  });

  it("completes the full flow: authorize → consent → token → proxy → revoke", async () => {
    const auth = await client.authorize("github", ["repo"]);

    // Simulate user consent by calling the callback directly
    const session = await sessionStore.get(auth.ath_session_id);
    expect(session).toBeTruthy();

    await app.request(`/ath/callback?code=mock_sdk_code&state=${session!.oauth_state}`, {
      method: "GET",
    });

    // Exchange token
    const tokenRes = await client.exchangeToken("mock_sdk_code", auth.ath_session_id);
    expect(tokenRes.access_token).toBeTruthy();
    expect(tokenRes.token_type).toBe("Bearer");
    expect(tokenRes.effective_scopes).toContain("repo");
    expect(tokenRes.scope_intersection.effective).toContain("repo");

    // Proxy call
    const proxyRes = await client.proxy<{ mock: boolean; provider: string }>(
      "github", "GET", "/user",
    );
    expect(proxyRes.mock).toBe(true);
    expect(proxyRes.provider).toBe("github");

    // Revoke
    await client.revoke();

    // Verify revoked token is rejected
    client.setToken(tokenRes.access_token);
    try {
      await client.proxy("github", "GET", "/user");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("TOKEN_REVOKED");
    }
  });

  it("rejects unregistered agent at authorize", async () => {
    const otherClient = new ATHClient({
      gatewayUrl: GATEWAY_URL,
      agentId: "https://unknown-agent.example.com/agent.json",
      privateKey: keypair.privateKey,
      keyId: "unknown-key",
    });
    // Set a fake client_id so the client-side guard passes and we hit the server
    otherClient.setCredentials("fake_client_id", "fake_secret");

    try {
      await otherClient.authorize("github", ["repo"]);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("AGENT_NOT_REGISTERED");
    }
  });
});
