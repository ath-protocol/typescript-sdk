#!/usr/bin/env npx tsx
/**
 * Auto-test session: power-user persona exercising the ATH SDK against a live gateway.
 * Perception-action loop with structured recording.
 */
import { generateKeyPair } from "jose";
import { ATHClient } from "./packages/client/src/client.js";
import { ATHClientError } from "./packages/client/src/errors.js";

const GATEWAY = "http://localhost:3000";

interface StepRecord {
  step: number;
  action: string;
  observation: string;
  expected: string;
  match: boolean;
  friction: string | null;
}

const log: StepRecord[] = [];
let stepNum = 0;

function record(action: string, observation: string, expected: string, friction: string | null = null) {
  stepNum++;
  const match = friction === null;
  log.push({ step: stepNum, action, observation, expected, match, friction });
  const icon = match ? "✓" : "✗";
  console.log(`  ${icon} Step ${stepNum}: ${action}`);
  if (friction) console.log(`    FRICTION: ${friction}`);
}

async function main() {
  console.log("=== Auto-Test: Power User Session ===\n");
  console.log("Goal 1: Complete full ATH handshake via SDK\n");

  const { privateKey } = await generateKeyPair("ES256");

  // --- GOAL 1: Standard happy-path flow ---

  const client = new ATHClient({
    gatewayUrl: GATEWAY,
    agentId: "https://power-user-agent.example.com/.well-known/agent.json",
    privateKey,
    keyId: "pu-key-1",
  });

  // Step: Discover
  const t0 = Date.now();
  const discovery = await client.discover();
  const discoverMs = Date.now() - t0;
  record(
    "discover()",
    `${discovery.supported_providers.length} providers, ${discoverMs}ms`,
    "200 with provider list",
    discoverMs > 3000 ? `Discovery took ${discoverMs}ms — felt slow` : null,
  );

  // Step: Register with multiple providers
  const reg = await client.register({
    developer: { name: "Power User Corp", id: "pu-dev-001" },
    providers: [
      { provider_id: "github", scopes: ["repo", "read:user"] },
      { provider_id: "slack", scopes: ["channels:read", "chat:write"] },
    ],
    purpose: "Multi-provider test",
  });
  record(
    "register() with 2 providers",
    `client_id=${reg.client_id}, status=${reg.agent_status}, ${reg.approved_providers.length} providers approved`,
    "approved for both providers",
    reg.approved_providers.length !== 2 ? "Not all providers approved" : null,
  );

  // Step: Authorize github
  const auth = await client.authorize("github", ["repo", "read:user"]);
  record(
    "authorize('github', ['repo', 'read:user'])",
    `session=${auth.ath_session_id}, url present=${!!auth.authorization_url}`,
    "session id and authorization URL",
  );

  // Step: Simulate consent
  const consentUrl = new URL(auth.authorization_url);
  const approveRes = await fetch(`${GATEWAY}/ui/mock-consent/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      callback: consentUrl.searchParams.get("callback") || "",
      state: consentUrl.searchParams.get("state") || "",
      provider: consentUrl.searchParams.get("provider") || "",
    }),
    redirect: "manual",
  });
  const loc = approveRes.headers.get("location") || "";
  await fetch(loc, { redirect: "manual" });
  record(
    "Simulate user consent via mock",
    `consent redirect status=${approveRes.status}`,
    "302 redirect to callback",
    approveRes.status !== 302 ? `Unexpected status ${approveRes.status}` : null,
  );

  // Step: Exchange token
  const token = await client.exchangeToken("mock_code", auth.ath_session_id);
  record(
    "exchangeToken()",
    `token_type=${token.token_type}, effective=[${token.effective_scopes.join(",")}]`,
    "Bearer token with repo,read:user",
    !token.effective_scopes.includes("repo") ? "Missing 'repo' in effective scopes" : null,
  );

  // Step: Proxy call
  const proxyRes = await client.proxy<Record<string, unknown>>("github", "GET", "/user");
  record(
    "proxy('github', 'GET', '/user')",
    `mock=${proxyRes.mock}, provider=${proxyRes.provider}`,
    "mock response for github",
  );

  console.log("\nGoal 2: Push limits and error handling\n");

  // --- GOAL 2: Error handling and edge cases ---

  // Step: Proxy with wrong provider
  try {
    await client.proxy("slack", "GET", "/channels");
    record("proxy('slack') with github token", "No error thrown", "Should fail with PROVIDER_MISMATCH", "Expected error but got success");
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    record(
      "proxy('slack') with github token",
      `Rejected: ${code}`,
      "PROVIDER_MISMATCH",
      code !== "PROVIDER_MISMATCH" ? `Got ${code} instead of PROVIDER_MISMATCH` : null,
    );
  }

  // Step: Revoke token
  await client.revoke();
  record("revoke()", "Token revoked", "Success");

  // Step: Use revoked token
  client.setToken(token.access_token);
  try {
    await client.proxy("github", "GET", "/user");
    record("proxy() after revoke", "No error thrown", "Should fail with TOKEN_REVOKED", "Expected rejection");
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    record(
      "proxy() after revoke",
      `Rejected: ${code}`,
      "TOKEN_REVOKED",
      code !== "TOKEN_REVOKED" ? `Got ${code} instead of TOKEN_REVOKED` : null,
    );
  }

  // Step: Register duplicate agent (same agent_id, different key)
  const { privateKey: pk2 } = await generateKeyPair("ES256");
  const client2 = new ATHClient({
    gatewayUrl: GATEWAY,
    agentId: "https://power-user-agent.example.com/.well-known/agent.json",
    privateKey: pk2,
    keyId: "pu-key-2",
  });
  try {
    const reg2 = await client2.register({
      developer: { name: "Power User Corp", id: "pu-dev-001" },
      providers: [{ provider_id: "github", scopes: ["repo"] }],
      purpose: "Duplicate registration test",
    });
    record(
      "register() duplicate agent_id",
      `status=${reg2.agent_status}, client_id=${reg2.client_id}`,
      "Accepted or CONFLICT",
    );
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    const msg = err instanceof Error ? err.message : "";
    record(
      "register() duplicate agent_id",
      `Rejected: ${code} — ${msg}`,
      "CONFLICT is acceptable (agent already registered)",
      null, // Not friction — expected behavior
    );
    // Use original client for subsequent steps instead
    client2.setCredentials(reg.client_id, reg.client_secret);
  }

  // Step: Authorize with unapproved scope
  try {
    await client2.authorize("github", ["repo", "admin:org"]);
    record("authorize() with unapproved scope", "No error", "Should fail", "Expected SCOPE_NOT_APPROVED");
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    record(
      "authorize() with unapproved 'admin:org'",
      `Rejected: ${code}`,
      "SCOPE_NOT_APPROVED",
      code !== "SCOPE_NOT_APPROVED" ? `Got ${code} instead of SCOPE_NOT_APPROVED` : null,
    );
  }

  // Step: Authorize with non-existent provider
  try {
    await client2.authorize("nonexistent-provider", ["read"]);
    record("authorize() with unknown provider", "No error", "Should fail", "Expected error");
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    record(
      "authorize() with unknown provider",
      `Rejected: ${code}`,
      "PROVIDER_NOT_APPROVED or similar",
    );
  }

  console.log("\nGoal 3: Rapid sequential operations\n");

  // --- GOAL 3: Stress / rapid operations ---

  const { privateKey: pk3 } = await generateKeyPair("ES256");
  const stressClient = new ATHClient({
    gatewayUrl: GATEWAY,
    agentId: "https://stress-agent.example.com/.well-known/agent.json",
    privateKey: pk3,
  });

  // Step: Rapid register + authorize + token 5 times
  const t1 = Date.now();
  const stressReg = await stressClient.register({
    developer: { name: "Stress", id: "stress-dev" },
    providers: [{ provider_id: "github", scopes: ["repo"] }],
    purpose: "Stress test",
  });
  let successCount = 0;
  for (let i = 0; i < 5; i++) {
    try {
      const a = await stressClient.authorize("github", ["repo"]);
      const sUrl = new URL(a.authorization_url);
      const sApprove = await fetch(`${GATEWAY}/ui/mock-consent/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          callback: sUrl.searchParams.get("callback") || "",
          state: sUrl.searchParams.get("state") || "",
          provider: sUrl.searchParams.get("provider") || "",
        }),
        redirect: "manual",
      });
      const sLoc = sApprove.headers.get("location") || "";
      await fetch(sLoc, { redirect: "manual" });
      const sToken = await stressClient.exchangeToken("mock_code", a.ath_session_id);
      if (sToken.access_token) successCount++;
    } catch { /* count as failure */ }
  }
  const stressMs = Date.now() - t1;
  record(
    `5x rapid authorize+consent+token cycles`,
    `${successCount}/5 succeeded in ${stressMs}ms`,
    "All 5 succeed",
    successCount < 5 ? `Only ${successCount}/5 succeeded` : null,
  );

  // Step: exchangeToken without prior authorize
  try {
    await client.exchangeToken("fake_code", "fake_session_id");
    record("exchangeToken() with fake session", "No error", "Should fail", "Expected error");
  } catch (err) {
    const code = err instanceof ATHClientError ? err.code : "unknown";
    record(
      "exchangeToken() with fake session",
      `Rejected: ${code}`,
      "SESSION_NOT_FOUND or similar",
    );
  }

  // --- SUMMARY ---
  console.log("\n=== Session Summary ===\n");
  const passed = log.filter((s) => s.match).length;
  const failed = log.filter((s) => !s.match).length;
  console.log(`Total steps: ${log.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Friction/failures: ${failed}`);

  if (failed > 0) {
    console.log("\nFriction points:");
    for (const s of log.filter((s) => !s.match)) {
      console.log(`  Step ${s.step}: ${s.action} — ${s.friction}`);
    }
  }

  console.log("\n=== Session Complete ===\n");
  // Output full log as JSON for structured consumption
  console.log(JSON.stringify(log, null, 2));
}

main().catch((err) => {
  console.error("Session failed:", err);
  process.exit(1);
});
