/**
 * @agenttrusthandshake/client — TypeScript client for the ATH protocol.
 *
 * Re-exports all protocol types from @agenttrusthandshake/types.
 */
export { ATHClient, type ATHClientConfig } from "./client.js";
export { ATHClientError } from "./errors.js";
export { signAttestation, type KeyInput } from "./attestation.js";
export * from "@agenttrusthandshake/types";
