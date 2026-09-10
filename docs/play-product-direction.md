# Scout Play and Scout Review

Scout has one activity feed and one shared conversation interface. Play and Review are chat
purposes with different starting copy and runtime instructions, using the same pool of Scouts.

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

- One shared navigation menu links Activity, Play, and Review for everyone. Settings is available
  to signed-in accounts; Lab, Scouts, Sites, and Members follow the existing access permissions.
- `/` lists public activity, newest first, with live or recorded previews and pagination.
  All / Play / Review filters select a purpose. Signed-in users can switch to My activity,
  including their private chats. Play and Review entry points sit above the single feed.
- `/play` starts with one chat composer. A message can include a game link, ask for research,
  or request preparation. Signing in keeps the draft and does not send it automatically.
- An approved member chooses an available Scout and private or public visibility (private by default).
  Creating the Agent chat and sending its first message happen in one mutation.
  The user's message is saved as written; Play guidance belongs in the system instructions.
  Failed starts retain the draft. A Scout remains limited to one active chat.
- `/play?thread=...` and `/review?thread=...` put the text conversation beside Scout's live browser or replay.
  A resizable Samebase sidebar holds the browser and replays. Mobile opens it with a button or swipe
  without discarding the draft or browser; its selector appears when there are multiple sessions.
  Owners retain Stop and human handoff controls. Public spectators can watch without signing in;
  they cannot send messages or control the browser. Owners can change visibility after starting.
  The player keeps their own game open.
- Scout's `set_activity_step` tool saves `research`, `account_setup`, or `play` on the chat.
  These optional activities describe current work, not a mandatory checklist or proof of success.
  Run, stop, and handoff state still comes from the existing turn lifecycle.
- Normal assistant messages carry brief observations and move commentary. Tool code and provider
  reasoning stay in Lab. The conversation uses Lab's message scroller and keeps native text selection.
  A draft can be written while Scout works; Scout must stop before it can be sent.
- `/chats` and `/scouts` remain staff-only. Staff owners can open the detailed Lab inspector;
  members use the simpler conversation. The public API excludes tools, provider reasoning,
  handoff evidence, workspace files, browser control credentials, and Scout account details.
- `/review` uses the same composer, conversation, visibility controls, and replay sidebar as Play.
  It starts a Review chat through the same mutation and harness, checking Review permission.
  Review guidance asks for concrete product findings with reproducible steps and page URLs.
  There are no separate product feeds or `/play/session` route.

Sessions remain ordinary Agent chats. `scoutChats.purpose` distinguishes general, Play (with its
activity step), and Review chats; `visibility` independently controls public viewing. Existing chats
are private. There is no new agent or workflow engine. Execution checks the owner's current
permission for the chat purpose throughout the existing runtime.
No named game has been claimed as reliably supported.

## Schema rollout

Populated deployments need a backfill before deploying the required `purpose` and `visibility`
fields. The branch checkpoint named `Prepare existing chats for explicit purpose and visibility`
accepts both schemas and contains `migrateChatPurpose:run`. Run it in batches with
`paginationOpts`, passing each returned cursor until `isDone` is true, then deploy the final code.
It converts the old `play` context into `purpose`, sets existing chats to private, and removes `play`.
The primary development deployment has completed this step. Production has not been changed.
Fresh deployments need no backfill. The final runtime has no legacy schema fallback.

## Shared presentation

Both routes render the same components in `src/products/conversation/`, with colors, fonts, and
corners set by the product shell. Play keeps its blue Scout piece, Bricolage Grotesque headings,
DM Sans body text, and yellow accents. Review uses IBM Plex Sans, green-gray colors, and restrained
corners, with no game mascot in the composer. Its guidance asks for measured findings that separate
observed problems from interpretation and preferences. The homepage keeps yellow and green entry
buttons and a single activity feed.

## What to learn next

Use real game and review tasks to check whether Scout completes the request, what needs human
help, and which findings are backed by observed browser state. Gameplay completion is still an
open reliability issue; a finished agent turn alone does not establish that a game ended.
