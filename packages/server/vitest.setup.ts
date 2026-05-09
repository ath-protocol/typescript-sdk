import { webcrypto } from "node:crypto";

if (typeof globalThis.crypto === "undefined") {
  // @ts-expect-error Node 18 doesn't expose crypto globally; jose needs it
  globalThis.crypto = webcrypto;
}
