import { describe, expect, it } from "vite-plus/test";
import { selectScrapeProfileName } from "./browser";
import { selectAgentMailInboxId } from "./mail";
import type { ScoutConnection } from "./scouts";

const linkedConnection: ScoutConnection = {
  agentMail: { inboxId: "linked-inbox" },
  firecrawl: { profileName: "linked-profile" },
};

describe("runtime provider connection resolution", () => {
  it("uses linked provider values", () => {
    expect(selectAgentMailInboxId({ scoutEmail: "legacy@example.test" }, linkedConnection)).toBe(
      "linked-inbox",
    );
    expect(selectScrapeProfileName(linkedConnection)).toBe("linked-profile");
  });

  it("uses legacy values only when the connection is missing", () => {
    expect(selectAgentMailInboxId({ scoutEmail: "legacy@example.test" }, null)).toBe(
      "legacy@example.test",
    );
    expect(selectScrapeProfileName(null)).toBe("scout-conrad");
  });
});
