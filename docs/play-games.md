# Scout Play game catalog

Updated September 8, 2026. Keep candidate games here so Play discovery and future landing-page
examples can use the same list. A candidate is not a claim that Scout plays it reliably.

| Site                                                                | Games                                    | Current evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Score Four](https://score-four.pfp.workers.dev/)                   | Score Four                               | User-owned. Scout joined, read labeled pegs, and made two legal moves, but stopped before completing the game. Separate local DOM probe verified stacks and full pegs.                                                              |
| [ChessMerge](https://chessmerge.com/)                               | ChessMerge                               | User-owned. Practice board and legal-destination labels inspected. Earlier user playthroughs; needs a fresh complete Scout trial on the current harness.                                                                            |
| [Papergames](https://papergames.io/en/)                             | Tic Tac Toe, Connect 4, Gomoku, Checkers | Guest Tic Tac Toe trial: three legal Scout moves, repeated browser-reading failures, missed winning threat, and failed final result check. Other listed games untested. Unlimited time is available in Tic Tac Toe friend settings. |
| [Netgames](https://netgames.io/games/love-letter/)                  | Love Letter                              | Guest trial: joined and played a card, but struggled with page controls and stopped before the round result. Two to four players.                                                                                                   |
| [Codenames Green](https://www.codenamesgreen.com/)                  | Cooperative word game                    | Entry and source inspected. Two players can share an identifier and select opposite sides. Words are text; key categories use DOM classes. Live Scout trial pending.                                                                |
| [Codenames Online](https://codenames.game/)                         | Duet                                     | Publisher documents two-player browser Duet without accounts. Entry, tutorial, and UI source inspected; live Scout trial pending.                                                                                                   |
| [FreeBoardGames](https://www.freeboardgames.org/en/play/fourinarow) | Four in a Row                            | Friend-link entry and local SVG board inspected. Coordinates and colors need DOM extraction. Multiplayer Scout trial pending.                                                                                                       |
| [SE!ZE](https://playseze.com/?mode=friend)                          | Strategy board game                      | Guest private-table setup, No clock setting, and static HTML board inspected. Interactive Scout trial pending.                                                                                                                      |
| [BuddyBoardGames](https://buddyboardgames.com/)                     | Connect 4, Yahtzee, Reversi, Checkers    | Earlier entry/demo inspection found useful cell and dice labels. Needs current live multiplayer Scout trials.                                                                                                                       |
| [PlayingCards.io](https://playingcards.io/@playingcardsio/checkers) | Checkers and other tabletops             | Guest-room template and documentation inspected. Dragging and manual rule enforcement make this a lower-priority trial.                                                                                                             |

## Evidence

- [September 8 real Play trials](./play-trials-2026-09-08.md): exact prompts, model, local
  transcript links, browser operations, and outcomes for Papergames, Love Letter, and Score Four.
- [Earlier site research](./playable-games-research.md): BuddyBoardGames DOM findings and
  additional accessibility candidates.

Before presenting a game as playable on the landing page, attach a recent completed Scout
playthrough with the tested mode and model. Keep failed trials as evidence rather than silently
turning an inspected site into a supported example.

## Reusable site knowledge experiment

The first prototype adds a curated Papergames Tic Tac Toe guide through existing `load_skills`.
A fresh chat discovered it and used its reading method, but stopped before completing the round.
Generic skills remain bundled in `convex/scout/skills.ts`.

The next MVP lets the existing Bash tool select a shared site workspace by hostname. Scouts can
save and read guides or scripts across chats without adding a site to the code or registering a
product. See [workspace usage](./workspaces.md#shared-site-workspaces) and the
[ChessMerge learning and reuse trial](./shared-site-workspace-trial-2026-09-08.md). Shared storage
works, but the trials do not establish reliable autonomous discovery or accurate learned guides.

Start with one guide per site/game, containing how to identify the active board, extract visible
state and whose turn it is, choose a legal control, and observe the result. Include the date and
transcript that verified the method. Keep rules/strategy separate from browser-reading methods
so their effects can be compared independently.

Reusable guides should contain public site knowledge and tested snippets. Current board state,
room links, private hands, and account information belong to the private chat workspace. Test reuse
in a fresh chat before treating a saved guide as a working integration.
