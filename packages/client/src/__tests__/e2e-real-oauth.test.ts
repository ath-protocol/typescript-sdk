/**
 * E2E Test: ATHClient SDK against real HTTP servers (no mocks).
 *
 * Starts:
 *  - Mock OAuth2 server on port 15000 (real PKCE, real token exchange)
 *  - ATH Gateway on port 15001 (configured in direct OAuth mode)
 *
 * Exercises every ATH capability through the SDK using real HTTP.
 * This is the "no mock" full-coverage test.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generateKeyPair } from "jose";
import { serve } from "@hono/node-server";
import type { ServerType } from "@hono/node-server";

import { ATHClient } from "../client.js";
import { ATHClientError } from "../errors.js";

// Gateway internals (for provisioning only — not for bypassing HTTP)
import { app as gatewayApp } from "../../../../../packages/gateway/src/app.js";
import { app as oauthApp } from "../../../../../packages/mock-oauth/src/server.js";
import { agentStore } from "../../../../../packages/gateway/src/registry/agent-store.js";
import { tokenStore } from "../../../../../packages/gateway/src/auth/token.js";
import { sessionStore } from "../../../../../packages/gateway/src/auth/session-store.js";
import { oauthBridge } from "../../../../../packages/gateway/src/oauth/client.js";
import { providerStore } from "../../../../../packages/gateway/src/providers/store.js";

const OAUTH_PORT = 15000;
const GATEWAY_PORT = 15001;
const OAUTH_URL = `http://localhost:${OAUTH_PORT}`;
const GATEWAY_URL = `http://localhost:${GATEWAY_PORT}`;

let oauthServer: ServerType;
let gatewayServer: ServerType;

describe("ATHClient E2E — real HTTP, real OAuth (no mock)", () => {
  let client: ATHClient;
  let keypair: Awaited<ReturnType<typeof generateKeyPair>>;

  beforeAll(async () => {
    // Clean state
    agentStore.clear();
    tokenStore.clear();
    sessionStore.clear();
    oauthBridge.clearTokens();
    providerStore.clearCache();

    process.env.ATH_GATEWAY_HOST = GATEWAY_URL;

    // Configure the mock OAuth server as the "github" provider
    providerStore.set("github", {
      display_name: "GitHub",
      available_scopes: ["repo", "read:user", "user:email", "read:org"],
      authorize_endpoint: `${OAUTH_URL}/authorize`,
      token_endpoint: `${OAUTH_URL}/token`,
      api_base_url: OAUTH_URL,
      client_id: "ath-gateway-client",
      client_secret: "ath-gateway-secret",
    });

    // Start real HTTP servers
    oauthServer = serve({ fetch: oauthApp.fetch, port: OAUTH_PORT, hostname: "127.0.0.1" });
    gatewayServer = serve({ fetch: gatewayApp.fetch, port: GATEWAY_PORT, hostname: "127.0.0.1" });

    // Health check — wait for both servers
    for (let i = 0; i < 20; i++) {
      try {
        const [gw, oauth] = await Promise.all([
          fetch(`${GATEWAY_URL}/health`).then((r) => r.ok),
          fetch(`${OAUTH_URL}/health`).then((r) => r.ok),
        ]);
        if (gw && oauth) break;
      } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 200));
    }

    keypair = await generateKeyPair("ES256");
    client = new ATHClient({
      gatewayUrl: GATEWAY_URL,
      agentId: "https://real-e2e-agent.example.com/.well-known/agent.json",
      privateKey: keypair.privateKey,
      keyId: "real-e2e-key",
    });
  });

  afterAll(async () => {
    gatewayServer?.close();
    oauthServer?.close();
    agentStore.clear();
    tokenStore.clear();
    sessionStore.clear();
    oauthBridge.clearTokens();
    providerStore.delete("github");
    providerStore.clearCache();
  });

  // ── Coverage: Discovery ──

  it("discovers the gateway over real HTTP", async () => {
    const discovery = await client.discover();
    expect(discovery.ath_version).toBe("0.1");
    expect(discovery.gateway_id).toBe(GATEWAY_URL);
    expect(discovery.supported_providers.length).toBeGreaterThan(0);
    const github = discovery.supported_providers.find((p) => p.provider_id === "github");
    expect(github).toBeDefined();
    expect(github!.available_scopes).toContain("repo");
    expect(github!.auth_mode).toBe("OAUTH2");
  });

  // ── Coverage: Registration (Phase A) ──

  it("registers the agent with real HTTP", async () => {
    const reg = await client.register({
      developer: { name: "Real E2E Corp", id: "dev-real-e2e" },
      providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
      purpose: "Real OAuth E2E test",
    });

    expect(reg.client_id).toBeTruthy();
    expect(reg.client_secret).toBeTruthy();
    expect(reg.agent_status).toBe("approved");
    expect(reg.approved_providers).toHaveLength(1);
    expect(reg.approved_providers[0].provider_id).toBe("github");
    expect(reg.approved_providers[0].approved_scopes).toContain("repo");
    expect(reg.approved_providers[0].approved_scopes).toContain("read:user");
  });

  // ── Coverage: Authorization (Phase B) with PKCE + Resource Indicators ──

  let sessionId: string;
  let authorizationUrl: string;

  it("initiates authorization — gets real OAuth URL with PKCE", async () => {
    const auth = await client.authorize("github", ["repo", "read:user"], {
      resource: "https://api.example.com",
    });

    expect(auth.ath_session_id).toBeTruthy();
    expect(auth.authorization_url).toContain(OAUTH_URL);
    expect(auth.authorization_url).toContain("/authorize");
    expect(auth.authorization_url).toContain("response_type=code");
    expect(auth.authorization_url).toContain("code_challenge=");
    expect(auth.authorization_url).toContain("code_challenge_method=S256");
    expect(auth.authorization_url).toContain("resource=");

    sessionId = auth.ath_session_id;
    authorizationUrl = auth.authorization_url;
  });

  // ── Coverage: User consent (real OAuth redirect chain) ──

  it("simulates user consent via real OAuth server redirect chain", async () => {
    const url = new URL(authorizationUrl);
    url.searchParams.set("auto_approve", "true");

    // OAuth server → redirect to gateway /ath/callback?code=...&state=...
    const oauthRes = await fetch(url.toString(), { redirect: "manual" });
    expect(oauthRes.status).toBe(302);
    const callbackUrl = oauthRes.headers.get("location")!;
    expect(callbackUrl).toContain("/ath/callback");
    expect(callbackUrl).toContain("code=");

    // Gateway callback → exchanges code via PKCE, redirects to UI
    const callbackRes = await fetch(callbackUrl, { redirect: "manual" });
    expect(callbackRes.status).toBe(302);
    const finalUrl = callbackRes.headers.get("location")!;
    expect(finalUrl).toContain("success=true");
  });

  // ── Coverage: Token exchange ──

  it("exchanges for ATH token — real OAuth code exchange with PKCE", async () => {
    const token = await client.exchangeToken("real_code", sessionId);

    expect(token.access_token).toBeTruthy();
    expect(token.access_token).toMatch(/^ath_tk_/);
    expect(token.token_type).toBe("Bearer");
    expect(token.expires_in).toBeGreaterThan(0);
    expect(token.provider_id).toBe("github");
    expect(token.agent_id).toBe("https://real-e2e-agent.example.com/.well-known/agent.json");
    expect(token.effective_scopes).toContain("repo");
    expect(token.effective_scopes).toContain("read:user");
    expect(token.scope_intersection.agent_approved).toContain("repo");
    expect(token.scope_intersection.user_consented).toContain("repo");
    expect(token.scope_intersection.effective).toContain("repo");
  });

  // ── Coverage: Proxy — real API calls to mock OAuth server ──

  it("proxies GET /userinfo to real OAuth server", async () => {
    const user = await client.proxy<{ login: string; name: string; email: string }>(
      "github", "GET", "/userinfo",
    );
    expect(user.login).toBe("test-user");
    expect(user.name).toBe("Test User");
    expect(user.email).toBe("test@example.com");
  });

  it("proxies GET /api/repos to real OAuth server", async () => {
    const repos = await client.proxy<{ name: string; full_name: string }[]>(
      "github", "GET", "/api/repos",
    );
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThan(0);
    expect(repos[0].name).toBe("ath-gateway");
  });

  // ── Coverage: Error handling — provider mismatch ──

  it("rejects proxy to wrong provider", async () => {
    try {
      await client.proxy("slack", "GET", "/channels");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("PROVIDER_MISMATCH");
      expect((err as ATHClientError).status).toBe(403);
    }
  });

  // ── Coverage: Error handling — unapproved scope ──

  it("rejects authorization with unapproved scope", async () => {
    try {
      await client.authorize("github", ["repo", "admin:org"]);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("SCOPE_NOT_APPROVED");
    }
  });

  // ── Coverage: Error handling — unregistered agent ──

  it("rejects unregistered agent at authorize", async () => {
    const { privateKey: otherKey } = await generateKeyPair("ES256");
    const otherClient = new ATHClient({
      gatewayUrl: GATEWAY_URL,
      agentId: "https://unknown.example.com/agent.json",
      privateKey: otherKey,
    });
    otherClient.setCredentials("fake_id", "fake_secret");

    try {
      await otherClient.authorize("github", ["repo"]);
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("AGENT_NOT_REGISTERED");
    }
  });

  // ── Coverage: Token revocation ──

  let savedToken: string;

  it("revokes the token", async () => {
    const preCheck = await client.proxy<{ login: string }>("github", "GET", "/userinfo");
    expect(preCheck.login).toBe("test-user");

    savedToken = client.getClientId()!;
    const tokenRes = await client.exchangeToken("unused", sessionId).catch(() => null);

    // We need the actual access_token string to test revocation.
    // Re-do the flow to get a fresh token we can save before revoking.
    const auth2 = await client.authorize("github", ["repo", "read:user"]);
    const url2 = new URL(auth2.authorization_url);
    url2.searchParams.set("auto_approve", "true");
    const r1 = await fetch(url2.toString(), { redirect: "manual" });
    await fetch(r1.headers.get("location")!, { redirect: "manual" });
    const token2 = await client.exchangeToken("real_code", auth2.ath_session_id);
    savedToken = token2.access_token;

    await client.revoke();
  });

  it("rejects proxy with revoked token", async () => {
    client.setToken(savedToken);

    try {
      await client.proxy("github", "GET", "/userinfo");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("TOKEN_REVOKED");
    }
  });

  // ── Coverage: Token with wrong session ──

  it("rejects exchangeToken with fake session", async () => {
    try {
      await client.exchangeToken("fake_code", "fake_session_id");
      expect.unreachable("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ATHClientError);
      expect((err as ATHClientError).code).toBe("SESSION_NOT_FOUND");
    }
  });
});
