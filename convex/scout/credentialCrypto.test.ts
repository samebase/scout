import { describe, expect, test } from "vitest";
import {
  credentialKeyFingerprint,
  decodeCredentialMasterKey,
  decryptCredential,
  encryptCredential,
  generateManagedPassword,
} from "./credentialCrypto";

function testBinding(keyFingerprint: string) {
  return {
    credentialReference: "6f81ad2e-b6f5-4b65-a79f-035f75732c1e",
    scoutId: "scout-id",
    serviceDomain: "example.com",
    credentialHost: "accounts.example.com",
    identifier: "scout@example.test",
    keyFingerprint,
  };
}

function changedBase64Url(value: string) {
  return `${value.startsWith("A") ? "B" : "A"}${value.slice(1)}`;
}

describe("Scout managed-credential cryptography", () => {
  test("accepts only one canonical base64 encoding of a 32-byte key", () => {
    const encoded = Buffer.alloc(32, 7).toString("base64");
    const key = decodeCredentialMasterKey(encoded);
    expect(key).toEqual(Buffer.alloc(32, 7));
    key.fill(0);

    expect(() => decodeCredentialMasterKey(undefined)).toThrow("base64-encoded 32-byte key");
    expect(() => decodeCredentialMasterKey(Buffer.alloc(31).toString("base64"))).toThrow(
      "base64-encoded 32-byte key",
    );
    expect(() => decodeCredentialMasterKey(encoded.replace(/=$/, ""))).toThrow(
      "base64-encoded 32-byte key",
    );
  });

  test("generates a 24-character password with every required character class", () => {
    const password = generateManagedPassword();
    expect(password).toHaveLength(24);
    expect(password).toMatch(/[a-z]/);
    expect(password).toMatch(/[A-Z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@#$%^&*_+-]/);
  });

  test("round-trips with unique nonces and a deterministic key fingerprint", () => {
    const key = Buffer.alloc(32, 9);
    const fingerprint = credentialKeyFingerprint(key);
    const binding = testBinding(fingerprint);
    const first = encryptCredential("correct horse battery staple", key, binding);
    const second = encryptCredential("correct horse battery staple", key, binding);

    expect(first.nonce).not.toBe(second.nonce);
    expect(credentialKeyFingerprint(Buffer.alloc(32, 9))).toBe(fingerprint);
    expect(decryptCredential(first, key, binding)).toBe("correct horse battery staple");
    key.fill(0);
  });

  test("rejects a wrong key and tampering of every encrypted field or AAD binding", () => {
    const key = Buffer.alloc(32, 11);
    const fingerprint = credentialKeyFingerprint(key);
    const binding = testBinding(fingerprint);
    const encrypted = encryptCredential("hidden-password", key, binding);

    expect(() => decryptCredential(encrypted, Buffer.alloc(32, 12), binding)).toThrow(
      "Managed credential could not be decrypted",
    );
    for (const field of ["nonce", "ciphertext", "authenticationTag"] as const) {
      expect(() =>
        decryptCredential(
          { ...encrypted, [field]: changedBase64Url(encrypted[field]) },
          key,
          binding,
        ),
      ).toThrow("Managed credential could not be decrypted");
    }
    for (const field of [
      "credentialReference",
      "scoutId",
      "serviceDomain",
      "credentialHost",
      "identifier",
      "keyFingerprint",
    ] as const) {
      expect(() =>
        decryptCredential(encrypted, key, { ...binding, [field]: `${binding[field]}-changed` }),
      ).toThrow("Managed credential could not be decrypted");
    }
    key.fill(0);
  });
});
