import { describe, expect, test } from "vitest";
import { diagnosticMessage } from "./redaction";

describe("diagnostic redaction", () => {
  test("removes URLs, email addresses, bearer credentials, and named secrets", () => {
    const message = diagnosticMessage(
      new Error(
        "POST https://example.com/path failed for conrad@agentmail.to; Authorization: Bearer abc123; password=hunter2",
      ),
    );

    expect(message).toBe(
      "POST [url redacted] failed for [email redacted]; [secret redacted]; [secret redacted]",
    );
    expect(message).not.toContain("abc123");
    expect(message).not.toContain("hunter2");
  });
});
