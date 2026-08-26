import { describe, expect, test } from "vitest";
import { extractEmailLinks } from "./emailLinks";

describe("extractEmailLinks", () => {
  test("keeps labelled HTTPS links in deterministic order", () => {
    const links = extractEmailLinks({
      html: `
        <a href="https://tally.so/auth/verify?token=secret&amp;source=email">
          Verify <strong>email</strong>
        </a>
        <a href="https://tally.so/privacy">Privacy</a>
      `,
      text: "Verify: https://tally.so/auth/verify?token=secret&source=email",
    });

    expect(links).toEqual([
      {
        url: "https://tally.so/auth/verify?token=secret&source=email",
        host: "tally.so",
        label: "Verify email",
      },
      {
        url: "https://tally.so/privacy",
        host: "tally.so",
        label: "Privacy",
      },
    ]);
  });

  test("ignores links that are not HTTPS", () => {
    const links = extractEmailLinks({
      html: '<a href="javascript:alert(1)">Bad</a><a href="http://example.com">Plain HTTP</a>',
      text: "",
    });

    expect(links).toEqual([]);
  });
});
