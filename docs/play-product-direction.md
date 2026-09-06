# Scout Play and Scout Review

Scout Play and Scout Review have separate landing pages, linked by a neutral Scout overview.
Play focuses on someone with a browser game open who wants another player. Review introduces
the idea of findings backed by a recording; its dedicated workflow is still to be designed.

## Play positioning

| Direction                     | Headline                             | Why choose it                                                                   | Tradeoff                                                                              |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Clear invitation, implemented | Add a player to your game.           | Explains the action immediately and works for opponents and teammates.          | Needs a demonstration to show what joining means.                                     |
| More personality              | Good company. Questionable strategy. | Sets an honest expectation and makes Scout's imperfect play part of the appeal. | Doesn't explain the product alone.                                                    |
| Familiar gaming language      | Your player two is here.             | Short and easy to remember.                                                     | Suggests console games, fast controls, and two-player support we haven't established. |

## Research, September 5, 2026

[Sei](https://sei.gg/) leads with an AI gaming companion and shows playing, calling, screen sharing,
and watching together. The useful lesson is that a concrete shared activity explains companionship.
Scout's first page needs fewer promises because its current interaction is browser play and chat.

[VoxelMind](https://www.voxel-mind.com/) explains two specific ways to start: a hosted Minecraft
world or bringing the companion into an existing world. This makes the next action clear.
For Scout, the corresponding action is pasting the invite link to a game the person already opened.

[KRAFTON's PUBG Ally discussion](https://developer.nvidia.com/blog/how-krafton-built-pubg-ally-a-co-playable-character-powered-by-nvidia-ace/)
describes an AI that takes game actions, and emphasizes responsiveness and testing in a tightly
bounded game mode. Scout currently has browser latency and variable playing ability. My inference
is that slower games and a visible stop control make a more credible first experience than a broad
claim about playing any game. These references support positioning, not Scout compatibility claims.

## The implemented flow

- `/` offers the two products with a preview of each visual identity.
- `/play` pairs the invitation and two-player illustration with a short explanation of how to start.
  The introduction sets expectations about Scout's imperfect play.
- `/play/session` accepts a room link, with an optional note revealed on request. Signing in keeps the draft.
- An authenticated invite chooses an existing active Scout, creates a normal Agent chat, and sends
  a game request through the existing backend. Failed sends reuse the already-created chat on retry.
- `/play/session?thread=...` shows Scout's browser, text conversation, help requests, and a stop control.
  Scout must stop before a new instruction is sent. The player keeps the original game open in their own tab.
- `/chats`, `/scouts`, and `/settings` remain the lab. The play screen links there for detailed
  transcripts and setup. A new account with no configured Scout gets a setup link, not a pretend player.
- `/review` introduces the review product with a static signup-flow illustration and a link to
  the existing Lab. There are no dedicated review forms or report pages yet.

No new agent, schema, model, or provider integration is introduced. Sessions remain ordinary chats
and are recoverable through the lab. No named game has been claimed as supported.

## Two design languages

The signature is a pair of player tiles: you and a blue Scout piece. A compact three-step row explains
the invitation flow beneath the hero. Warm yellow `#F5E597`, blue `#3558DA`,
paper `#FAFAF6`, ink `#253044`, and pale blue `#EDF0F9` give it the feel of a tabletop game.
Bricolage Grotesque gives the headlines and player pieces a rounded character; DM Sans handles forms.

Review uses IBM Plex Sans and IBM Plex Mono, green-gray paper `#F1F4F2`, ink `#203C36`, and
restrained green `#28584D`. The landing page pairs quiet typography with a document-style illustration.
It has no game pieces or playful display type.

The neutral overview does not dictate either product's shell. Product pages use Tailwind utilities,
with small class variants for repeated controls and panels in `src/products/ui.ts`. Font declarations
and palette tokens live in the existing `src/style.css`; there are no product stylesheets.
Each product can be linked to directly. A future split can give each its own root and deployment.
Backend ownership, accounts, and any submission requirements would need a separate decision first.

## What to learn next

Try one real game invitation from start to finish. Record whether Scout joins, finishes the game,
needs a reminder, and how long its turns take. Use that evidence to choose the first named game and
replace the illustration with a short real gameplay clip. Automatic Scout provisioning and a dedicated
game-session history would be useful follow-ups after the play flow is validated.
