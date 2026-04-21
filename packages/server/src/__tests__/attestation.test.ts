import { describe, it, expect } from "vitest";
import { generateKeyPair, SignJWT, exportJWK } from "jose";
import { verifyAttestation } from "../attestation.js";
import { InMemoryAgentDocCache } from "../agent-doc-cache.js";

describe("verifyAttestation", () => {
  it("verifies a valid attestation JWT", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://agent.example.com/.well-known/agent.json";

    const jwt = await new SignJWT({ capabilities: [] })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(agentId)
      .setSubject(agentId)
      .setAudience("https://gateway.example.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyAttestation(jwt, {
      audience: "https://gateway.example.com",
      publicKey,
    });

    expect(result.valid).toBe(true);
    expect(result.agentId).toBe(agentId);
  });

  it("rejects an expired JWT", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://agent.example.com/.well-known/agent.json";

    const jwt = await new SignJWT({ capabilities: [] })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(agentId)
      .setSubject(agentId)
      .setAudience("https://gateway.example.com")
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);

    const result = await verifyAttestation(jwt, {
      audience: "https://gateway.example.com",
      publicKey,
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("rejects wrong audience", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://agent.example.com/.well-known/agent.json";

    const jwt = await new SignJWT({ capabilities: [] })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(agentId)
      .setSubject(agentId)
      .setAudience("https://other-gateway.example.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyAttestation(jwt, {
      audience: "https://gateway.example.com",
      publicKey,
    });

    expect(result.valid).toBe(false);
  });

  it("MH-A1: resolves public key from sub claim", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://agent.example.com/.well-known/agent.json";
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer("https://agent.example.com")
      .setSubject(agentId)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h")
      .sign(privateKey);

    const seen: string[] = [];
    const result = await verifyAttestation(jwt, {
      audience: "https://gw.example.com",
      resolvePublicKey: async (id) => { seen.push(id); return publicKey; },
    });

    expect(result.valid).toBe(true);
    expect(seen).toEqual([agentId]);
  });

  it("MH-A2: falls back to iss when sub is absent", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const issuer = "https://agent-only-iss.example.com/.well-known/agent.json";
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(issuer)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h")
      .sign(privateKey);

    const seen: string[] = [];
    const result = await verifyAttestation(jwt, {
      audience: "https://gw.example.com",
      resolvePublicKey: async (id) => { seen.push(id); return publicKey; },
    });

    expect(result.valid).toBe(true);
    expect(seen).toEqual([issuer]);
  });

  it("MH-A3: fails cleanly when both sub and iss are absent", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyAttestation(jwt, {
      audience: "https://gw.example.com",
      resolvePublicKey: async () => { throw new Error("should not be called"); },
    });

    expect(result.valid).toBe(false);
    expect(result.error).toContain("sub/iss");
  });

  it("MH-A4/A7: cache hit avoids a second resolve call", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://cache-hit.example.com/.well-known/agent.json";
    const cache = new InMemoryAgentDocCache();
    let calls = 0;
    const resolve = async () => { calls++; return publicKey; };

    const mk = () => new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "rotating-kid" })
      .setIssuer(agentId).setSubject(agentId)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h")
      .sign(privateKey);

    const j1 = await mk();
    const j2 = await mk();
    await verifyAttestation(j1, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });
    await verifyAttestation(j2, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });

    expect(calls).toBe(1);
    expect(cache.size()).toBe(1);
  });

  it("MH-A8: different kid → different cache entries (key rotation)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://rotate.example.com/.well-known/agent.json";
    const cache = new InMemoryAgentDocCache();
    let calls = 0;
    const resolve = async () => { calls++; return publicKey; };

    const j1 = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "old" })
      .setIssuer(agentId).setSubject(agentId)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h").sign(privateKey);
    const j2 = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "new" })
      .setIssuer(agentId).setSubject(agentId)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h").sign(privateKey);

    await verifyAttestation(j1, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });
    await verifyAttestation(j2, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });

    expect(calls).toBe(2);
    expect(cache.size()).toBe(2);
  });

  it("failure is NOT cached (transient outage does not poison)", async () => {
    const { privateKey, publicKey } = await generateKeyPair("ES256");
    const agentId = "https://transient.example.com/.well-known/agent.json";
    const cache = new InMemoryAgentDocCache();
    let calls = 0;
    const resolve = async () => {
      calls++;
      if (calls === 1) throw new Error("transient");
      return publicKey;
    };

    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: "k1" })
      .setIssuer(agentId).setSubject(agentId)
      .setAudience("https://gw.example.com")
      .setIssuedAt().setExpirationTime("1h").sign(privateKey);

    const r1 = await verifyAttestation(jwt, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });
    expect(r1.valid).toBe(false);
    expect(cache.size()).toBe(0);

    const r2 = await verifyAttestation(jwt, { audience: "https://gw.example.com", resolvePublicKey: resolve, cache });
    expect(r2.valid).toBe(true);
    expect(calls).toBe(2);
  });

  it("supports skip signature verification mode", async () => {
    const { privateKey } = await generateKeyPair("ES256");
    const agentId = "https://agent.example.com/.well-known/agent.json";

    const jwt = await new SignJWT({ capabilities: [] })
      .setProtectedHeader({ alg: "ES256", kid: "test-key" })
      .setIssuer(agentId)
      .setSubject(agentId)
      .setAudience("https://gateway.example.com")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const result = await verifyAttestation(jwt, {
      audience: "https://gateway.example.com",
      skipSignatureVerification: true,
    });

    expect(result.valid).toBe(true);
    expect(result.agentId).toBe(agentId);
  });
});
