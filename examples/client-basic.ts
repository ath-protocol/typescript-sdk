#!/usr/bin/env npx tsx
/**
 * Basic ATH client example — demonstrates the full trusted handshake flow.
 *
 * Prerequisites:
 *   Start an ATH gateway (e.g. the reference implementation from the ATH repo)
 *
 * Run:
 *   npx tsx examples/client-basic.ts
 */
import { generateKeyPair } from "jose";
import { ATHGatewayClient } from "@ath-protocol/client";

const GATEWAY_URL = process.env.ATH_GATEWAY_URL || "http://localhost:3000";

async function main() {
  console.log("=== ATH Client SDK — Basic Example ===\n");

  const { privateKey } = await generateKeyPair("ES256");

  const client = new ATHGatewayClient({
    url: GATEWAY_URL,
    agentId: "https://example-agent.example.com/.well-known/agent.json",
    privateKey,
    keyId: "example-key-1",
  });

  // 1. Discover
  console.log("1. Discovering gateway...");
  const discovery = await client.discover();
  console.log(`   Version: ${discovery.ath_version}`);
  console.log(`   Providers: ${discovery.supported_providers.map((p) => p.display_name).join(", ")}\n`);

  // 2. Register
  console.log("2. Registering agent...");
  const reg = await client.register({
    developer: { name: "Example Dev", id: "dev-example" },
    providers: [{ provider_id: "github", scopes: ["repo", "read:user"] }],
    purpose: "ATH SDK example",
  });
  console.log(`   Client ID: ${reg.client_id}`);
  console.log(`   Status: ${reg.agent_status}`);
  console.log(`   Approved: ${reg.approved_providers[0].approved_scopes.join(", ")}\n`);

  // 3. Authorize (state is now required — the SDK generates it automatically)
  console.log("3. Starting authorization...");
  const auth = await client.authorize("github", ["repo", "read:user"]);
  console.log(`   Session: ${auth.ath_session_id}`);
  console.log(`   User should visit: ${auth.authorization_url}\n`);

  // 4. Simulate consent
  // In production, the user visits authorization_url in their browser.
  // For testing with a mock OAuth server that supports ?auto_approve=true:
  console.log("4. Simulating user consent...");
  const consentUrl = new URL(auth.authorization_url);
  consentUrl.searchParams.set("auto_approve", "true");
  const oauthRes = await fetch(consentUrl.toString(), { redirect: "manual" });
  if (oauthRes.status === 302) {
    const callbackUrl = oauthRes.headers.get("location") || "";
    await fetch(callbackUrl, { redirect: "manual" });
    console.log("   Consent completed.\n");
  } else {
    console.log("   Auto-approve not available. In production, user consents via browser.\n");
  }

  // 5. Exchange token (now includes agent_attestation for identity proof)
  console.log("5. Exchanging token...");
  const tokenRes = await client.exchangeToken("mock_code", auth.ath_session_id);
  console.log(`   Token type: ${tokenRes.token_type}`);
  console.log(`   Expires in: ${tokenRes.expires_in}s`);
  console.log(`   Effective: [${tokenRes.effective_scopes.join(", ")}]\n`);

  // 6. Proxy call
  console.log("6. Proxied API call (GET /user)...");
  const apiRes = await client.proxy<Record<string, unknown>>("github", "GET", "/user");
  console.log(`   Response:`, JSON.stringify(apiRes, null, 2), "\n");

  // 7. Revoke (now sends client_secret for authentication per RFC 7009)
  console.log("7. Revoking token...");
  await client.revoke();
  console.log("   Done.\n");

  console.log("=== Example Complete ===");
}

main().catch((err) => {
  console.error("Example failed:", err);
  process.exit(1);
});
