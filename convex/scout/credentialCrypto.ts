"use node";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from "node:crypto";

export const SCOUT_CREDENTIAL_KEY_VERSION = 1 as const;
export const SCOUT_CREDENTIAL_FORMAT_VERSION = 1 as const;
export const SCOUT_CREDENTIAL_ALGORITHM = "aes-256-gcm" as const;

const MASTER_KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;
const PASSWORD_LENGTH = 24;
const LOWERCASE = "abcdefghijkmnopqrstuvwxyz";
const UPPERCASE = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*_-+";
const PASSWORD_CHARACTERS = `${LOWERCASE}${UPPERCASE}${DIGITS}${SYMBOLS}`;
const KEY_FINGERPRINT_CONTEXT = "scout-managed-credential-key-v1\0";

export type CredentialBinding = {
  credentialReference: string;
  scoutId: string;
  serviceDomain: string;
  credentialHost: string;
  identifier: string;
  keyFingerprint: string;
};

export type EncryptedCredential = {
  nonce: string;
  ciphertext: string;
  authenticationTag: string;
};

function associatedData(binding: CredentialBinding) {
  return Buffer.from(
    JSON.stringify({
      formatVersion: SCOUT_CREDENTIAL_FORMAT_VERSION,
      algorithm: SCOUT_CREDENTIAL_ALGORITHM,
      purpose: "scout-managed-password",
      keyVersion: SCOUT_CREDENTIAL_KEY_VERSION,
      keyFingerprint: binding.keyFingerprint,
      credentialReference: binding.credentialReference,
      scoutId: binding.scoutId,
      serviceDomain: binding.serviceDomain,
      credentialHost: binding.credentialHost,
      identifier: binding.identifier,
    }),
    "utf8",
  );
}

function randomCharacter(characters: string) {
  return characters[randomInt(characters.length)] ?? "";
}

export function decodeCredentialMasterKey(value: string | undefined) {
  const encoded = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("SCOUT_CREDENTIAL_MASTER_KEY_V1 must be a base64-encoded 32-byte key");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== MASTER_KEY_BYTES || key.toString("base64") !== encoded) {
    key.fill(0);
    throw new Error("SCOUT_CREDENTIAL_MASTER_KEY_V1 must be a base64-encoded 32-byte key");
  }
  return key;
}

export function credentialKeyFingerprint(key: Buffer) {
  return createHash("sha256").update(KEY_FINGERPRINT_CONTEXT).update(key).digest("base64url");
}

export function generateManagedPassword() {
  const characters = [
    randomCharacter(LOWERCASE),
    randomCharacter(UPPERCASE),
    randomCharacter(DIGITS),
    randomCharacter(SYMBOLS),
    ...Array.from({ length: PASSWORD_LENGTH - 4 }, () => randomCharacter(PASSWORD_CHARACTERS)),
  ];
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [characters[index], characters[swapIndex]] = [
      characters[swapIndex] ?? "",
      characters[index] ?? "",
    ];
  }
  return characters.join("");
}

export function encryptCredential(
  password: string,
  key: Buffer,
  binding: CredentialBinding,
): EncryptedCredential {
  const nonce = randomBytes(NONCE_BYTES);
  const aad = associatedData(binding);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce, {
      authTagLength: AUTHENTICATION_TAG_BYTES,
    });
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    try {
      return {
        nonce: nonce.toString("base64url"),
        ciphertext: ciphertext.toString("base64url"),
        authenticationTag: authenticationTag.toString("base64url"),
      };
    } finally {
      ciphertext.fill(0);
      authenticationTag.fill(0);
    }
  } finally {
    nonce.fill(0);
    aad.fill(0);
  }
}

export function decryptCredential(
  encrypted: EncryptedCredential,
  key: Buffer,
  binding: CredentialBinding,
) {
  const nonce = Buffer.from(encrypted.nonce, "base64url");
  const ciphertext = Buffer.from(encrypted.ciphertext, "base64url");
  const authenticationTag = Buffer.from(encrypted.authenticationTag, "base64url");
  const aad = associatedData(binding);
  try {
    if (nonce.length !== NONCE_BYTES || authenticationTag.length !== AUTHENTICATION_TAG_BYTES) {
      throw new Error("Invalid encrypted credential envelope");
    }
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, {
      authTagLength: AUTHENTICATION_TAG_BYTES,
    });
    decipher.setAAD(aad);
    decipher.setAuthTag(authenticationTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    try {
      return plaintext.toString("utf8");
    } finally {
      plaintext.fill(0);
    }
  } catch {
    throw new Error("Managed credential could not be decrypted");
  } finally {
    nonce.fill(0);
    ciphertext.fill(0);
    authenticationTag.fill(0);
    aad.fill(0);
  }
}
