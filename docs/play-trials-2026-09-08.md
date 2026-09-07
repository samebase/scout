# Scout Play candidates and trials

September 8, 2026. Expand the game selection beyond BuddyBoardGames and establish actual
Play behavior before changing prompts or tools. These are candidates, not a supported-games list.

## Candidate sites

Scout currently sees accessibility snapshots and can inspect rendered DOM through Playwright.
It does not receive browser screenshots as model input. Prefer guest invitations, discrete
actions, readable state, and untimed games. “HTML5” alone says nothing about that compatibility.

| Site / game                                                                         | Entry and timing                                                                                                         | Evidence and remaining work                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Papergames](https://papergames.io/en/) — Tic Tac Toe, Connect 4, Gomoku, Checkers  | Guest names and invitation links. Tic Tac Toe friend settings offer unlimited time.                                      | Actual Scout Tic Tac Toe trial below. Empty cells are ordinary divs; played pieces are labeled SVGs. Other games on this site remain untested.                                                                                                                                  |
| [Codenames Green](https://www.codenamesgreen.com/) — cooperative word game          | Two players can share an identifier and choose opposite sides. No account prompt; timer tokens count turns, not seconds. | Entry and [public UI source](https://github.com/jbowens/codenamesgreen/blob/master/src/Game.elm) inspected. Words are text; key categories use DOM classes. Needs a live trial of clues, guesses, visible role information, and results.                                        |
| [FreeBoardGames — Four in a Row](https://www.freeboardgames.org/en/play/fourinarow) | Online Friend opens a nickname prompt; room links supported. No clock on the inspected local board.                      | Local board and [source](https://github.com/freeboardgames/FreeBoardGames.org/blob/master/web/src/games/fourinarow/board.tsx) inspected. SVG circles expose position and color; the accessibility snapshot omits cells. Multiplayer synchronization and timing remain untested. |
| [Netgames — Love Letter](https://netgames.io/games/love-letter/)                    | Two to four players, guest name and room code/link.                                                                      | Room entry and [client controls](https://netgames.io/games/love-letter/js/room.js) inspected. Card text is generated through CSS and appears in the observed accessibility snapshot. Discard and target controls use text. Actual trial below.                                  |
| [SE!ZE](https://playseze.com/?mode=friend) — strategy board game                    | Guest private tables; friend setup offers No clock.                                                                      | Setup and static opening-board DOM inspected. HTML cells and pieces; [rules](https://playseze.com/rules) describe piece then destination selection. Interactive match state remains untested.                                                                                   |
| [Codenames Online](https://codenames.game/) — Duet                                  | [Publisher documents](https://www.codenamesgame.com/play-online) browser Duet for two players, with no account required. | Entry, tutorial DOM, and deployed UI source inspected. Text cards and guess controls; colors use CSS. Needs a private Duet trial.                                                                                                                                               |
| [PlayingCards.io](https://playingcards.io/@playingcardsio/checkers) — Checkers      | Guest rooms; account optional.                                                                                           | Template page and [FAQ](https://playingcards.io/docs/faq) inspected. Players drag pieces and enforce rules themselves. Lower priority: live piece positions and move controls remain untested.                                                                                  |

The known prior game is [ChessMerge](https://chessmerge.com/), as supplied by the user; do not
substitute Combine Chess based on the name. The user subsequently identified the other game as
[Score Four](https://score-four.pfp.workers.dev/). Its trial appears below; ChessMerge still needs
a fresh complete Scout trial. The maintained list is in [the game catalog](./play-games.md).

[Gametable](https://gametable.org/faq/) currently documents no internet friend play. The inspected
[boardgames.zone Mancala](https://boardgames.zone/mancala/local) board uses canvas without readable
pits or seed counts. [Lichess](https://lichess.org/page/fair-play) and
[Barricade](https://barricade.gg/terms) require a supported automation route or permission before
agent trials; keep them out of this guest-game batch.

## Initial baseline conditions

- Primary checkout at `f280fbd` (v189), localhost:5173, existing `acoustic-cat-488` development
  deployment. No fixture accounts, environment changes, or production writes.
- Magda, Qwen3.7 Flash (`qwen/qwen3.7-flash`), through the ordinary Play UI.
- Fresh chat for each trial. One ordinary invitation prompt; no selector hints, follow-up coaching,
  prompt changes, or tool changes. Guest identity can persist in the Scout browser profile.
- The operator plays the other side through visible UI. Never inspect an opponent's private hand
  or invoke internal game methods. Record any operator delay that affects the result.

The later Score Four and guide trials document their follow-up messages and code changes below.

## Papergames Tic Tac Toe

Prompt: “Join my Tic Tac Toe game and play one round against me: [room URL]”

First run: [Play transcript](http://localhost:5173/play/session?thread=m5755t96k6rx54hepaf6810bmd8dzgd6).
Guest signup and room join worked. Scout struggled to find the board; the operator's side timed
out before making a move while inspecting the UI. Friend defaults were subsequently observed as
30 seconds per turn and two minutes per player. Scout was awarded a win without playing a move.
This is a confounded trial, not proof of gameplay.

Repeat: [Play transcript](http://localhost:5173/play/session?thread=m57f9tmhtkd9vbee4jbk58ew9d8dy241),
[Lab](http://localhost:5173/chats?thread=m57f9tmhtkd9vbee4jbk58ew9d8dy241),
browser session `qh75h0j14wvq24ndcdtj7rts9x8dyt51`.
The operator selected Set unlimited time in friend settings before creating the new room.

Observed moves, with zero-based row/column coordinates:

| Move | Player      | Cell                         |
| ---- | ----------- | ---------------------------- |
| 1    | Scout, O    | 0,0                          |
| 2    | Operator, X | 1,1                          |
| 3    | Scout, O    | 2,2                          |
| 4    | Operator, X | 0,1                          |
| 5    | Scout, O    | 1,0                          |
| 6    | Operator, X | 2,1 — wins the middle column |

Scout made three legal moves and observed the opponent's first two moves. It claimed its fifth
move would block the opponent, but played in the wrong column. That is a move-selection error,
separate from browser control.

Browser operation evidence:

- Operations 3 and 11 tried `getByRole('generic', { name: '' })` and timed out.
- Operation 4 referenced an undefined `boardArealocator` variable.
- Operation 9 found `.grid.s-3x3` and made the first legal move. Operations 12 and 14 made the next two.
- Operations 10 and 13 counted `img` elements, then called `getAttribute` on the absent element
  even when the count was zero. Pieces are SVGs with accessible image roles, not HTML `img` tags.
  Those calls hit the execution timeout. A three- or five-second sleep at the start was not the
  main source of the delay.
- After the winning move, the site removed the board and displayed a rematch/countdown panel.
  Scout initially described an unchanged board, then noticed the rematch state and tried to
  establish the result. Result recognition must be assessed separately from making legal moves.

The round ended on the website, but the Scout task did not finish cleanly: operation 17 failed
before dispatch with `Playwright could not reconnect to Firecrawl: The operation was aborted
due to timeout`. Its last commentary tentatively inferred an opponent win and confused a level
number with the score. It did not deliver a final result. The recorded run consumed 259,258 model
tokens (249,751 input / 9,507 output), $0.008354 model cost, and 21 Firecrawl credits over 624.6
browser seconds. Model cost excludes Firecrawl. Some operator response delays are included;
this is not a clean latency benchmark.

One run does not establish reliability or prove that a prompt change would fix these failures.
Repeat the same ordinary task and compare a different game before generalizing.

## Netgames Love Letter

Prompt: “Join my Love Letter game and play one round against me:
https://netgames.io/games/love-letter/rooms/FLFC”

[Play transcript](http://localhost:5173/play/session?thread=m572m483nfr6d2xs8j2crhptfx8dzn6f),
[Lab](http://localhost:5173/chats?thread=m572m483nfr6d2xs8j2crhptfx8dzn6f),
browser session `qh7e2f582xxje47m7yd0p4cqz18dyfw2`.

The operator created a guest room and started the game after Magda joined. This is normal host
interaction, not agent coaching. The prompt requests one round, not the full seven-point match.

Scout joined as a guest and correctly read its cards. The snapshot also included off-screen
player/cheatsheet panels. Scout spent several operations trying to close those panels or scroll
to the game. It then selected Priest, struggled to activate the Discard control, and eventually
played it. The control is an anchor styled as a button, with no button role. The operator had
played Handmaid, so the Priest effect had no available opponent target.

The operator next played Baron while retaining the higher-value Prince. The legal comparison
eliminated Magda's Baron, and the site displayed the operator's round win. The operator chose
from its own hand and used the site's normal target/confirmation controls.

Scout stopped before reporting that result. Its final response called the opponent unresponsive
and offered to wait or report a stalled round, despite the original request to play a round.
Only about 72 seconds elapsed between its Priest confirmation settling (operation 20) and task
completion; its description of “several minutes” was inaccurate. Operator activity was not a
controlled latency test, so this establishes a premature stop under that pause, not behavior
against an instantly responding player.

It also called Prince its newly drawn card while saying it was the opponent's turn; Prince was
the operator's draw. Investigate visible/hidden panel contents and ownership before treating
all card text in a snapshot as the Scout's hand.

The backend marked this task `completed`, although the user goal was incomplete. There were
23 browser operations, including five error results: an off-screen close control, two ambiguous
OK locators, `document` used outside `page.evaluate`, and a nonexistent Discard button role.
The run consumed 398,475 model tokens (389,461 input / 9,014 output), $0.012668 model cost, and
12 Firecrawl credits over 356.4 browser seconds. Model cost excludes Firecrawl.

## Next comparison

Keep the same join-and-play prompt for repeated Tic Tac Toe and Love Letter trials. Add
Codenames Green or official Duet as a cooperative word-game trial, and FreeBoardGames Four in
a Row as another spatial board. Test one change at a time and retain the model, mode, transcript,
operator pauses, and actual outcome.

Judge room entry, state/turn reading, legal actions, useful play, and result reporting separately.
Do not use backend `completed` or a lucky timeout win as the success criterion. Repeated browser
selection failures and premature waiting termination are candidates for general improvements;
these runs do not yet show which prompt, tool, or model change will improve them.

## Score Four baseline

[Play transcript](http://localhost:5173/play/session?thread=m57epca45ecyna2xbpjqrha2m18dzngr).
Prompt: "Join my Score Four game and play one game against me: [private room URL]"

Magda joined as a guest and could read all sixteen labeled pegs from the accessibility snapshot.
It stopped while waiting for the operator's first move. The operator had paused to inspect code;
this is not evidence about a fast opponent. After a normal follow-up, "I've made my move", Scout
read B2 Maple, played C2 Walnut, later read the operator's A1 Maple, and played B1 Walnut. It then
stopped again while saying it was the operator's turn. The requested game was not completed.

The board-reading path worked without a site guide. Scout nevertheless questioned why controls
were disabled during the other player's turn. That is turn interpretation, not missing HTML.
The independent [Score Four probe](./score-four-site-guide.md) also verified stacked pieces and
full-peg disabling through normal local-game controls. No game strategy was supplied.

## Papergames guide treatment

[Play transcript](http://localhost:5173/play/session?thread=m574qrahxng1x1mqhv77hvj7e58dz7d1),
[Lab](http://localhost:5173/chats?thread=m574qrahxng1x1mqhv77hvj7e58dz7d1).
Same Magda/Qwen model and ordinary invitation wording as the earlier Tic Tac Toe trial, in a
fresh chat with unlimited time. The site randomly gave the operator the first move this time.

The only gameplay guidance addition was the bundled `papergames-tic-tac-toe` reading/control
guide. Generic `games` instructions were unchanged. The chat spontaneously selected both guides;
no prompt mentioned skills or selectors. The browser profile retained its guest identity.

- Operation 2 failed because Scout invented `browserState(page).buttons`; it recovered using
  the real Playwright Play button in operation 3.
- Operation 4 used the guide's extraction and read the empty board correctly on its first try.
- Operation 5 reused that extraction and observed the operator's X in the center.
- Operation 6 placed O top-left through the documented cell selector and reread the new board.
- Scout then ended the task while saying it would wait. The operator played X top-middle,
  but there was no ongoing agent run to observe it. The operator later resigned solely to close
  the abandoned test room. That forfeit is not a successful agent outcome.

The earlier baseline spent operations 3–8 rediscovering controls before its first move in
operation 9. The treatment used the provided method immediately, but this single run does not
establish a reliable improvement rate. Starting-player order and operator timing differed, and
the treatment stopped sooner, so whole-run latency/cost is not a like-for-like comparison.
Recorded treatment usage: 83,883 model tokens, $0.002765 model cost, 4 Firecrawl credits, 114.2
browser seconds. The backend marked the task completed despite the unfinished user goal.

## HTML format and sandbox check

[Conrad Lab transcript](http://localhost:5173/chats?thread=m57a7kz67z0rry9h4vcm9zw6f18dzv6c).
Qwen 3.7 Flash received: "Save raw HTML and Markdown copies of https://example.com/. From the
saved HTML, tell me the page title and where its link goes."

It selected `rawHtml` and `markdown` itself and saved two files:
`/workspace/sources/example.com/index-e527d95d.raw.html` and
`/workspace/sources/example.com/index-5cf0e659.md`. Its title and link answer was correct.

Follow-up: "Extract the heading and all link text and URLs from the saved HTML into a JSON file."
Scout read the saved HTML with `js-exec`, used regular expressions for this simple page, saved
`/workspace/results/extracted_headings_links.json`, and read it back with `cat`. The JSON contains
the h1 "Example Domain" and the "Learn more" link to `https://iana.org/domains/example`.

This proves format selection, real file persistence, and simple offline processing. It does not
prove robust HTML parsing: the sandbox has no DOMParser or importable Cheerio. The installed
`html-to-markdown` command works in a fixture but is excluded from Scout's command allowlist.
No HTML parsing dependency or new command was added in this change.
