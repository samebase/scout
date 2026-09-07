# Games for Scout Play

Research date: September 7, 2026. This is a candidate list, not a supported-games promise.

See [the maintained game catalog](./play-games.md) for later candidates and verification status.

## What Scout can observe

Scout's current browser snapshot is accessibility text, produced by
`body.ariaSnapshot({ mode: "ai" })` in `convex/scout/playwrightBrowser.ts`.
`browser_execute` returns text and the resulting page snapshot. It can inspect rendered DOM
and use Playwright controls, but it does not send screenshot images to the model.
The live video and replay are for the person using Scout.

Firecrawl itself supports screenshots and full browser control
([documentation](https://docs.firecrawl.dev/features/interact)). The limitation is Scout's
current observation path. A canvas-only board usually has no readable pieces in that path.
HTML5 is not a useful compatibility label: an HTML5 game can render everything into canvas.
DOM or SVG also needs inspection to establish that piece identities and positions are readable.

Prefer games with visible, readable state; discrete legal actions; explicit turn and outcome
indicators; and enough time for multi-second model/tool calls. Private invite links and guest
access reduce setup. Fast shooters such as Krunker are a poor match for this runtime.

## Evidence needed before recommending a game

Keep the game URL, mode, date, tested model, and supporting Scout transcript with each result.
Distinguish source inspection, browser inspection, and a completed Scout playthrough. An open
homepage or successful click does not establish playability.

A useful first verification is a private two-player game: join from the other browser, read the
board and whose turn it is, make legal moves through ordinary controls, observe the opponent's
move, and finish with the correct result. Use an ordinary user request and record any coaching,
timeouts, account requirements, or handoffs. Check a follow-up/rejoin when the game supports it.
Do not read opponents' hidden state, invoke internal game logic to make moves, or modify the game
to manufacture success.

For “Find a game for us,” a small list with recent successful Scout playthroughs is a better
default than unrestricted recommendations. Other games can remain explicit experiments.
Third-party changes and model differences mean the evidence should be dated and refreshed.

## Shortlist

One research subagent, Noether, inspected official pages, public source, and entry-page DOM.
No game below received a Scout playthrough or a two-client multiplayer test during this research.
BuddyBoardGames board and dice observations came from the pre-room/demo DOM behind the entry
dialog. They establish useful markup, but do not prove that live multiplayer updates expose the
same information. The parent checked Scout's implementation and the leading official sources.

| Game                                              | Entry and players                                                                                   | Evidence                                                                                                                                                                                                                                                                                                                                         | Next verification                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Connect 4](https://buddyboardgames.com/connect4) | Two players, guest nickname and room name or invite link                                            | Inspected DOM has 42 focusable button cells labeled with row, column, and occupancy. Official controls place a piece by clicking a column.                                                                                                                                                                                                       | First choice: join from a second browser, verify labels update, turns alternate, and win/draw is observed.                                                                                                                                                                                                              |
| [Yahtzee](https://buddyboardgames.com/yahtzee)    | One to eight players, guest nickname and room; everyone joins before starting                       | Inspected dice labels expose index, value, and held state. Roll control and score sheet are labeled.                                                                                                                                                                                                                                             | Verify scoring cells, hold/unhold updates, and the zero-score confirmation.                                                                                                                                                                                                                                             |
| [Reversi](https://buddyboardgames.com/reversi)    | Two players, guest nickname and room                                                                | Inspected board cells expose coordinates and occupancy. Official rules describe automatic passes and piece-count victory.                                                                                                                                                                                                                        | Verify changed colors after a move, forced passes, and game-end counts.                                                                                                                                                                                                                                                 |
| [Checkers](https://buddyboardgames.com/checkers)  | Two players, guest nickname and room                                                                | Inspected cells are focusable buttons with coordinate/piece labels. Decorative pieces are hidden from accessibility.                                                                                                                                                                                                                             | Verify move selection, mandatory multi-jumps, and king labels.                                                                                                                                                                                                                                                          |
| [Lichess](https://lichess.org/)                   | Friend challenges and anonymous human play are documented; automated play needs separate assessment | The [accessibility guide](https://lichess.org/page/blind-mode-tutorial) documents piece lists, move history, typed moves, and no-clock games.                                                                                                                                                                                                    | Strong text interface, but automated play needs the Bot API: its current rules prohibit programmatic GUI moves. Lichess provides [BOT accounts](https://lichess.org/blog/WvDNticAAMu_mHKP/welcome-lichess-bots) and has [fair-play rules](https://lichess.org/page/fair-play). Establish the supported bot route first. |
| [Lidraughts](https://lidraughts.org/)             | Homepage offers a friend challenge and Blind Mode; source handles anonymous users                   | Public [game interface](https://github.com/RoepStoep/lidraughts/blob/c7feaf1810c34f44f9b5f2b719a4aa795f9c7618/ui/round/src/plugins/nvui.ts) and [board rendering](https://github.com/RoepStoep/lidraughts/blob/c7feaf1810c34f44f9b5f2b719a4aa795f9c7618/ui/nvui/src/draughts.ts) include textual pieces, an ASCII board, status, and move entry. | Verify deployed functionality and supported automation mode before recommending. The inspected homepage showed “Reconnecting.”                                                                                                                                                                                          |

For BuddyBoardGames, official pages say no account is required. Room names/links are the documented
join mechanism; password protection, room lifetime, and inactivity limits were not established.

Start actual Scout testing with Connect 4, Yahtzee, and Reversi. The subagent initially ranked
Lichess third on text accessibility; the parent moved it behind guest-room candidates because a
supported bot route is an additional integration question.

## The user's examples

- The user confirmed [ChessMerge](https://chessmerge.com/). An earlier possible identification
  as Combine Chess was incorrect. The user's prior Scout playthrough is useful experience, but
  this research did not independently retest ChessMerge.
- The user subsequently supplied [Score Four](https://score-four.pfp.workers.dev/) as the other
  game. Both sites are user-owned and belong in the next actual Scout trials.
