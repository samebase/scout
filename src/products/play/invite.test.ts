import { describe, expect, test } from "vite-plus/test";
import { gameInviteDisplayText, gameInvitePrompt } from "./invite";

describe("Play invitation display", () => {
  test.each(["", "Wait for me to start.", "First round.\n\nMy note: keep this label."])(
    "shortens the generated invitation while preserving its note: %s",
    (note) => {
      const prompt = gameInvitePrompt({ roomUrl: "https://example.com/game", note });
      expect(gameInviteDisplayText(prompt)).toBe(
        ["Play a game with me at https://example.com/game", ...(note ? [note] : [])].join("\n\n"),
      );
    },
  );

  test.each([
    "Play a game with me at https://example.com/game\n\nKeep this second paragraph.\n\nMy note: keep this label too.",
    "My note: try another game.",
  ])("preserves ordinary chat messages: %s", (text) => {
    expect(gameInviteDisplayText(text)).toBe(text);
  });
});
