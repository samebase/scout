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

export function gameInvitePrompt(invite: z.output<typeof gameInviteSchema>) {
  return [
    `Play a game with me at ${invite.roomUrl}`,
    "Join as a player using your own browser and Scout identity. Load the games skill. Follow the game's rules and play through the current game, waiting for your turn when needed. Keep chat updates short and tell me if you need help. Stop when this game ends or I ask you to stop.",
    ...(invite.note ? [`My note: ${invite.note}`] : []),
  ].join("\n\n");
}
