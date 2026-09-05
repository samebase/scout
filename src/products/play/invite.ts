import { z } from "zod";

export const gameInviteSchema = z.object({
  roomUrl: z
    .string()
    .trim()
    .max(2048)
    .pipe(
      z.url({
        protocol: /^https?$/,
        error: "Enter a full game link starting with https:// or http://.",
      }),
    )
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password;
    }, "Use a room link without a username or password in the URL."),
  note: z.string().trim().max(1000, "Keep your note to 1,000 characters or fewer."),
});

const gameInstructions =
  "Join as a player using your own browser and Scout identity. Load the games skill. Follow the game's rules and play through the current game, waiting for your turn when needed. Keep chat updates short and tell me if you need help. Stop when this game ends or I ask you to stop.";

export function gameInvitePrompt(invite: z.output<typeof gameInviteSchema>) {
  return [
    `Play a game with me at ${invite.roomUrl}`,
    gameInstructions,
    ...(invite.note ? [`My note: ${invite.note}`] : []),
  ].join("\n\n");
}

export function gameInviteDisplayText(text: string) {
  const [opening, instructions, ...noteParagraphs] = text.split("\n\n");
  if (!opening?.startsWith("Play a game with me at ") || instructions !== gameInstructions) {
    return text;
  }
  const note = noteParagraphs.join("\n\n");
  if (note && !note.startsWith("My note: ")) return text;
  return note ? `${opening}\n\n${note.slice("My note: ".length)}` : opening;
}
