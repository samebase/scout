import type { ModelMessage } from "ai";
import { describe, expect, it } from "vitest";
import { compactBrowserModelContext, compactedBrowserSnapshotCount } from "./browserContext";

describe("browser model context", () => {
  it("keeps commands and outcomes while retaining only the latest browser snapshot", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            toolCallId: "old-call",
            toolName: "browser_execute",
            input: { code: "await page.getByRole('button').click()" },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "old-call",
            toolName: "browser_execute",
            output: {
              type: "json",
              value: {
                success: true,
                currentPage: "old page snapshot",
                output: "clicked",
                resultFile: {
                  status: "saved",
                  path: "/workspace/browser-results/old.json",
                  byteCount: 25000,
                },
              },
            },
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "mail-call",
            toolName: "list_messages",
            output: { type: "json", value: { currentPage: "not browser evidence" } },
          },
          {
            type: "tool-result",
            toolCallId: "latest-call",
            toolName: "browser_execute",
            output: {
              type: "json",
              value: {
                success: false,
                currentPage: "latest page snapshot",
                error: "button was disabled",
              },
            },
          },
        ],
      },
    ] satisfies ModelMessage[];

    const compacted = compactBrowserModelContext(messages);
    expect(compacted).toEqual([
      messages[0],
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "old-call",
            toolName: "browser_execute",
            output: {
              type: "json",
              value: {
                success: true,
                currentPage: "[superseded by a newer browser snapshot]",
                output: "clicked",
                resultFile: {
                  status: "saved",
                  path: "/workspace/browser-results/old.json",
                  byteCount: 25000,
                },
              },
            },
          },
        ],
      },
      messages[2],
    ]);
    expect(compactedBrowserSnapshotCount(compacted)).toBe(1);
  });
});
