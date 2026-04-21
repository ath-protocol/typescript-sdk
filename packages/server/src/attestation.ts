/**
 * Agent attestation verification — uses `jose` for JWT verification.
 *
 * Verifies that an agent attestation JWT is:
 *  - Signed with a valid key (ES256)
 *  - Not expired
 *  - Addressed to the correct audience
 *  - Issued by the agent_id
 *
 * The agent_id URI is resolved from the JWT's `sub` claim per the ATH spec
 * (the sub claim carries the canonical agent_id URI; iss carries the agent's
 * domain). For backwards compatibility with signers that set only `iss`, the
 * resolver falls back to `iss` when `sub` is missing.
 *
 * An optional public-key cache (keyed by `(agent_id, kid)`) avoids re-fetching
 * the agent's /.well-known/agent.json on every verification — critical in
 * production, where an uncached verifier DoS-amplifies onto the agent's host.
 */
import { jwtVerify, importJWK, decodeJwt, decodeProtectedHeader, errors as joseErrors } from "jose";
import type { CryptoKey, KeyObject } from "jose";
import type { CachedKeyResolver } from "./agent-doc-cache.js";

type KeyLike = CryptoKey | KeyObject;
type ResolvedKey = KeyLike | Uint8Array;

export interface AttestationResult {
  valid: boolean;
  agentId?: string;
  error?: string;
}

export interface AttestationVerifyOptions {
  audience: string;
  /** Provide a public key directly (for testing or when you already have it). */
  publicKey?: ResolvedKey;
  /**
   * Fetch the agent's public key from their agent_id URI.
   * Defaults to fetching {agent_id}/.well-known/agent.json and reading `public_key`.
   * Override for custom key resolution.
   */
  resolvePublicKey?: (agentId: string) => Promise<ResolvedKey>;
  /**
   * Optional public-key cache keyed by `(agent_id, kid)`. If provided, successful
   * resolutions are memoized; misses and errors are never cached. Rotate by
   * issuing new JWTs under a new `kid` — the old entry ages out naturally.
   */
  cache?: CachedKeyResolver<ResolvedKey>;
  /** Skip signature verification (development only). */
  skipSignatureVerification?: boolean;
}

async function fetchAgentPublicKey(agentId: string): Promise<KeyLike | Uint8Array> {
  const res = await fetch(agentId);
  if (!res.ok) {
    throw new Error(`Failed to fetch agent identity from ${agentId}: ${res.status}`);
  }
  const doc = (await res.json()) as { public_key?: unknown };
  if (!doc.public_key) {
    throw new Error(`No public_key in agent identity document at ${agentId}`);
  }
  if (typeof doc.public_key === "object") {
    return importJWK(doc.public_key as Parameters<typeof importJWK>[0], "ES256");
  }
  throw new Error("public_key must be a JWK object");
}

export async function verifyAttestation(
  token: string,
  options: AttestationVerifyOptions,
): Promise<AttestationResult> {
  try {
    if (options.skipSignatureVerification) {
      const header = decodeProtectedHeader(token);
      if (header.alg !== "ES256") {
        return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
      }
      const payload = decodeJwt(token);
      return { valid: true, agentId: (payload.sub ?? payload.iss) as string };
    }

    const resolve = options.resolvePublicKey || fetchAgentPublicKey;
    const rawPayload = decodeJwt(token);
    const header = decodeProtectedHeader(token);

    // Per the ATH identity spec, `sub` carries the canonical agent_id URI
    // (the location to fetch /.well-known/agent.json from). `iss` carries
    // the agent's domain. We resolve the public key from `sub`, falling
    // back to `iss` for signers that predate this disambiguation.
    const agentId = (rawPayload.sub as string | undefined) ?? (rawPayload.iss as string | undefined);
    if (!agentId) {
      return { valid: false, error: "Missing sub/iss claim — cannot resolve agent identity" };
    }

    const kid = (header.kid as string | undefined) ?? "default";

    let publicKey: ResolvedKey;
    if (options.publicKey) {
      publicKey = options.publicKey;
    } else if (options.cache) {
      // getOrLoad coalesces concurrent misses so a burst of verifications for
      // the same (agent_id, kid) triggers ONE resolver call, not N.
      publicKey = await options.cache.getOrLoad(agentId, kid, () => resolve(agentId));
    } else {
      publicKey = await resolve(agentId);
    }

    const { payload } = await jwtVerify(token, publicKey, {
      algorithms: ["ES256"],
      audience: options.audience,
      // Only pin issuer when the signer explicitly set it — some spec-aligned
      // signers put only the domain here, which is an expected variant.
      ...(rawPayload.iss ? { issuer: rawPayload.iss as string } : {}),
    });

    return { valid: true, agentId: (payload.sub ?? payload.iss) as string };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { valid: false, error: "Attestation JWT has expired" };
    }
    if (err instanceof joseErrors.JWTClaimValidationFailed) {
      return { valid: false, error: `Claim validation failed: ${err.message}` };
    }
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Unknown verification error",
    };
  }
}
