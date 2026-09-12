import { describe, expect, test } from "vitest";
import { canonicalCredentialHost, canonicalServiceDomain } from "./serviceDomains";

describe("service and credential domains", () => {
  test("groups services without www while preserving the exact credential host", () => {
    expect(canonicalServiceDomain("www.example.com")).toBe("example.com");
    expect(canonicalCredentialHost("www.example.com")).toBe("www.example.com");
    expect(canonicalCredentialHost("accounts.example.com")).toBe("accounts.example.com");
  });

  test("canonicalizes service URLs without reducing unrelated subdomains", () => {
    expect(canonicalServiceDomain(" https://WWW.Example.com./settings?view=account#profile ")).toBe(
      "example.com",
    );
    expect(canonicalServiceDomain("https://dashboard.example.com/account")).toBe(
      "dashboard.example.com",
    );
  });

  test.each([
    "",
    "localhost",
    "127.0.0.1",
    "file:///tmp/account",
    "https://user:password@example.com",
    "https://invalid_host.example",
  ])("rejects an invalid service domain: %s", (value) => {
    expect(() => canonicalServiceDomain(value)).toThrow();
  });

  test.each([
    "http://accounts.example.com",
    "https://accounts.example.com:8443",
    "https://accounts.example.com/login",
    "https://accounts.example.com?next=/login",
    "https://accounts.example.com#login",
    "https://user:password@accounts.example.com",
    "127.0.0.1",
  ])("rejects a credential target that is not one exact HTTPS DNS host: %s", (value) => {
    expect(() => canonicalCredentialHost(value)).toThrow();
  });
});
