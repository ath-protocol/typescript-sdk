/**
 * @agenttrusthandshake/server — Server-side helpers for building ATH gateways and native implementations.
 *
 * Re-exports all protocol types from @agenttrusthandshake/types.
 */
export { verifyAttestation, type AttestationResult, type AttestationVerifyOptions } from "./attestation.js";
export {
  type AgentRegistry,
  type RegisteredAgent,
  InMemoryAgentRegistry,
  hashSecret,
  generateCredentials,
} from "./registry.js";
export { intersectScopes, type ScopeIntersectionResult } from "./scopes.js";
export { type TokenStore, type BoundToken, InMemoryTokenStore } from "./tokens.js";
export {
  type SessionStore,
  type AuthorizationSession,
  type SessionStatus,
  InMemorySessionStore,
} from "./sessions.js";
export * from "@agenttrusthandshake/types";
