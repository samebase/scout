import { describe, expect, test } from "vitest";
import { canonicalCredentialHost, canonicalProductDomain } from "./productsDomain";

describe("product and credential domains", () => {
  test("groups products without www while preserving the exact credential host", () => {
    expect(canonicalProductDomain("www.example.com")).toBe("example.com");
    expect(canonicalCredentialHost("www.example.com")).toBe("www.example.com");
    expect(canonicalCredentialHost("accounts.example.com")).toBe("accounts.example.com");
  });

  test.each([
    "http://accounts.example.com",
    "https://accounts.example.com:8443",
    "https://accounts.example.com/login",
    "https://accounts.example.com?next=/login",
    "https://user:password@accounts.example.com",
    "127.0.0.1",
  ])("rejects a credential target that is not one exact HTTPS DNS host: %s", (value) => {
    expect(() => canonicalCredentialHost(value)).toThrow();
  });
});
