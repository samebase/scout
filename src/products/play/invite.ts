const gameInstructions =
  "Join as a player using your own browser and Scout identity. Load the games skill. Follow the game's rules and play through the current game, waiting for your turn when needed. Keep chat updates short and tell me if you need help. Stop when this game ends or I ask you to stop.";

export function gameInviteDisplayText(text: string) {
  const [opening, instructions, ...noteParagraphs] = text.split("\n\n");
  if (!opening?.startsWith("Play a game with me at ") || instructions !== gameInstructions) {
    return text;
  }
  const note = noteParagraphs.join("\n\n");
  if (note && !note.startsWith("My note: ")) return text;
  return note ? `${opening}\n\n${note.slice("My note: ".length)}` : opening;
}
