#!/usr/bin/env npx tsx
/**
 * Basic ATH client example — demonstrates the full trusted handshake flow
 * using the gateway client.
 *
 * Prerequisites:
 *   An ATH gateway running (e.g. the reference implementation) with a
 *   mock OAuth provider that supports ?auto_approve=true for automated consent.
 *
 * Run:
 *   ATH_GATEWAY_URL=http://localhost:3000 npx tsx examples/client-basic.ts
 */
import { generateKeyPair } from "jose";
import { ATHGatewayClient } from "@ath-protocol/client";

const GATEWAY_URL = process.env.ATH_GATEWAY_URL || "http://localhost:3000";

async function main() {
  console.log("=== ATH Client SDK — Basic Example ===\n");

  // Generate an ES256 key pair for agent attestation
  const { privateKey } = await generateKeyPair("ES256");

  const client = new ATHGatewayClient({
    url: GATEWAY_URL,
    agentId: "https://example-agent.example.com/.well-known/agent.json",
    privateKey,
    keyId: "example-key-1",
  });

  // 1. Discover — fetch /.well-known/ath.json
  console.log("1. Discovering gateway...");
  const discovery = await client.discover();
  console.log(`   Version: ${discovery.ath_version}`);
  console.log(`   Providers: ${discovery.supported_providers.map((p) => p.display_name).join(", ")}\n`);

  // 2. Register — POST /ath/agents/register (with ES256 attestation + jti)
  console.log("2. Registering agent...");
  const reg = await client.register({
    developer: { name: "Example Dev", id: "dev-example" },
    providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
    purpose: "ATH SDK example",
  });
  console.log(`   Client ID: ${reg.client_id}`);
  console.log(`   Status: ${reg.agent_status}`);
  console.log(`   Approved: ${reg.approved_providers[0].approved_scopes.join(", ")}\n`);

  // 3. Authorize — POST /ath/authorize (state is required, PKCE generated server-side)
  console.log("3. Starting authorization...");
  const auth = await client.authorize("github", ["repo", "read:user"], {
    resource: "https://api.github.com",
  });
  console.log(`   Session: ${auth.ath_session_id}`);
  console.log(`   User should visit: ${auth.authorization_url}\n`);

  // 4. Simulate user consent
  // In production the user visits authorization_url in their browser.
  // Here we auto-approve if the OAuth server supports it.
  console.log("4. Simulating user consent...");
  const consentUrl = new URL(auth.authorization_url);
  consentUrl.searchParams.set("auto_approve", "true");
  const r1 = await fetch(consentUrl.toString(), { redirect: "manual" });
  if (r1.status === 302) {
    const callbackUrl = r1.headers.get("location")!;
    await fetch(callbackUrl, { redirect: "manual" });
    console.log("   Consent completed.\n");
  } else {
    console.log("   Auto-approve not supported — manual consent required.\n");
  }

  // 5. Exchange token — POST /ath/token (includes agent_attestation + client_secret)
  console.log("5. Exchanging token...");
  const tokenRes = await client.exchangeToken("code", auth.ath_session_id);
  console.log(`   Token: ${tokenRes.access_token.slice(0, 20)}...`);
  console.log(`   Type: ${tokenRes.token_type}`);
  console.log(`   Expires in: ${tokenRes.expires_in}s`);
  console.log(`   Effective scopes: [${tokenRes.effective_scopes.join(", ")}]`);
  console.log(`   Scope intersection:`);
  console.log(`     Agent approved: [${tokenRes.scope_intersection.agent_approved.join(", ")}]`);
  console.log(`     User consented: [${tokenRes.scope_intersection.user_consented.join(", ")}]`);
  console.log(`     Effective: [${tokenRes.scope_intersection.effective.join(", ")}]\n`);

  // 6. Proxy API call — ANY /ath/proxy/{provider}/{path}
  console.log("6. Proxied API call (GET /userinfo)...");
  try {
    const apiRes = await client.proxy<Record<string, unknown>>("github", "GET", "/userinfo");
    console.log(`   Response:`, JSON.stringify(apiRes, null, 2), "\n");
  } catch (err) {
    console.log(`   Proxy call failed (upstream may not be running): ${err}\n`);
  }

  // 7. Revoke — POST /ath/revoke (sends client_id + client_secret + token)
  console.log("7. Revoking token...");
  await client.revoke();
  console.log("   Token revoked.\n");

  console.log("=== Example Complete ===");
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
