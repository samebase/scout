import { describe, expect, test } from "vite-plus/test";
import { gameInviteDisplayText } from "./invite";

describe("Play invitation display", () => {
  test.each(["", "Wait for me to start.", "First round.\n\nMy note: keep this label."])(
    "shortens the generated invitation while preserving its note: %s",
    (note) => {
      const prompt = [
        "Play a game with me at https://example.com/game",
        "Join as a player using your own browser and Scout identity. Load the games skill. Follow the game's rules and play through the current game, waiting for your turn when needed. Keep chat updates short and tell me if you need help. Stop when this game ends or I ask you to stop.",
        ...(note ? [`My note: ${note}`] : []),
      ].join("\n\n");
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
