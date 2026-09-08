# Scout Play completion trial

September 8, 2026. Baseline: `f22f91c` (v190), primary checkout, localhost:5173,
Convex dev `acoustic-cat-488`. Seven live games using Magda, fresh Play chats, and
the same persistent browser profile. No new site guides or selector coaching.

## Method

The invitations were ordinary user prompts:

- "Join my Tic Tac Toe game and play one round against me: [private room URL]"
- "Join my Score Four game and play one game against me: [private room URL]"

Papergames used unlimited time. The operator played through the public browser UI,
using immediate wins, blocks, then center/corners in Tic Tac Toe. In Score Four,
the operator filled the bottom level of row A, giving Scout a visible threat to block.
Success required a finished game and an accurate final result, not merely a completed
Convex turn. Failed rooms were resigned afterward for cleanup; those forfeits are
excluded from results. Full Scout transcripts and Model calls remain in the dev chats.

## Runs

Costs below are recorded model costs; Firecrawl credits are separate. Elapsed time
includes tools, browser setup, and opponent delays.

| Run                                                                                                      | Model          | Outcome                                                            | Elapsed | Model cost | Firecrawl credits |
| -------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ | ------: | ---------: | ----------------: |
| [Tic Tac Toe baseline 1](http://localhost:5173/chats?thread=m575mqh279q4bsxfvk8qteqpb98e0c69)            | Qwen 3.7 Flash | Failed Firecrawl reconnection after two Scout moves                |   604 s |  $0.010858 |                20 |
| [Score Four baseline 1](http://localhost:5173/chats?thread=m577tx54hda6kfp579wqxfvsvh8e1h5n)             | Qwen 3.7 Flash | Stopped after joining, promising to wait                           |    53 s |  $0.000964 |                 2 |
| [Score Four baseline 2](http://localhost:5173/chats?thread=m570wgshjvp3zathtzmkmdxnmh8e1t5b)             | Qwen 3.7 Flash | Finished; correct loss, wrong explanation of winning line          |    93 s |  $0.002147 |                 3 |
| [Tic Tac Toe baseline 2](http://localhost:5173/chats?thread=m57ffjqv93j7nvdnzbbzj2p4nh8e0sr2)            | Qwen 3.7 Flash | Finished; correctly reported draw despite board-reading errors     |   389 s |  $0.007818 |                13 |
| [Tic Tac Toe Luna baseline](http://localhost:5173/chats?thread=m578b9aq7y63h1axtyn5n67t3d8e038a)         | GPT-5.6 Luna   | Stopped on its turn after receiving the opponent's move            |   240 s |  $0.028065 |                 8 |
| [Score Four completion check](http://localhost:5173/chats?thread=m5786gjzscthssnqgexnv361j98e0xm3)       | Qwen 3.7 Flash | Finished without needing rescue; check repeated final answer       |   177 s |  $0.003476 |                 6 |
| [Tic Tac Toe Luna completion check](http://localhost:5173/chats?thread=m570svy2x6hvcf7tjaqj6gcks98e0nq4) | GPT-5.6 Luna   | Stopped on its turn; check repeated incorrect board and turn claim |   156 s |  $0.013795 |                 5 |

Baseline results: two finished games, two premature stops, one connection failure.
The two treatment runs demonstrated no recovered stop. Total recorded model cost:
$0.067123; total Firecrawl usage: 57 credits. This is a small diagnostic sample, not
a reliable model ranking or success-rate estimate.

Opponent timing was imperfect. The first Score Four response arrived seven seconds
after Scout had already stopped. Luna's baseline first opponent response was delayed
89.5 seconds by operator automation; the next response took about 0.3 seconds and was
present in the input before Scout stopped. Qwen Tic Tac Toe first responses took about
5 and 13.6 seconds; another response in the first run took about 34 seconds. In the
treatments, Score Four deliberately included a 32.6-second opening wait, while Luna's
first opponent response took 6.3 seconds. These differences prevent clean latency or
model comparisons; they do not establish an unseen move as the cause of the Luna stops.

## Findings

The harness ends a turn when the model returns `finishReason: "stop"` without a tool
call. It then closes the browser. Text promising future waiting does not schedule work.
Both Qwen and Luna chose that finish reason before the game ended.

Luna's baseline final Model call (`r574tgrc6wwjqfav7pbkyajf218e0ajb`) contained the latest
board, including the opponent's second move. There was no saved summary checkpoint
in that call; older browser snapshots had been trimmed, but the latest result was
present. Missing recent history does not explain this stop.

The treatment exposed a separate observation problem. Luna clicked top-left as O,
received explicit DOM results showing O at index 0 and X at index 4, then described
itself as X and waited for another opponent move. The initial snapshot also exposed
an O in a still-hoverable center cell before a move, consistent with a hover preview.
That may have contributed to its initial confusion, but later correct results did
not correct its belief.

Qwen repeatedly treated accessibility roles as HTML tags or attributes, including
`generic`, `img`, and `[cursor="pointer"]`. This caused empty reads and guessed
selectors. It needed roughly 5.5 and 2.5 minutes to make its first Tic Tac Toe moves.
Luna also passed timeout options as the second argument to `page.waitForFunction`;
native Playwright expects evaluation data second and options third. Its requested
120-second timeout therefore produced the configured 10-second timeout instead.

Both completed Score Four runs reported the correct winner but described A1–A4 at
level 1 as a vertical stack. Completing a game does not establish competent strategy
or accurate spatial reasoning.

## Rejected experiment

After a text-only stop following tool work, the harness made one additional model
call with the original context and attempted answer. It explained that a text-only
answer ends the run and asked the model to compare the requested outcome with the
latest observations, take an available next action, or finish if complete/blocked.
The check was not recursively checked; existing step and duration limits remained.
Tool activity could resume the existing continuation path. No schema or tools changed.

The Score Four check ran only after the game was over, adding a duplicate answer,
about $0.000421 and 2.2 seconds. Luna's check repeated the mistaken identity and turn,
adding about $0.003525 and 3.6 seconds. It took no corrective tool action.

The implementation passed the full build and 634 tests, including a mocked recovery
case, but failed to demonstrate recovery in live use. It was removed. The restored
baseline passed the full build and 633 tests (three skipped). No runtime change from
this experiment is retained.

## Next comparison

Use these same invitations and record opponent timing from the first move. Test one
browser-tool clarification at a time: accessibility roles versus real DOM selectors,
or the actual bounded-wait API signature. Separately test whether a verified shared
site guide improves board and turn reading. Do not add strategy advice or assume an
extra completion prompt fixes an incorrect understanding of the page.

## Comparison with the earlier ChessMerge playthrough

The user's [September 5 production game](https://scout.pfp.workers.dev/chats?thread=m570rt7qa55g876syfn7qzjk3n8dvrjp&session=q971jd67dda6p4arhz469dxgtn8dvmrh)
lasted 1,502 seconds and reached checkmate at move 35. The inspector shows Qwen
3.7 Flash, 17 tools, 84 model calls, and a running summary used from call 56 onward.
The replay lasts 24:40. Numerous invalid selectors and wait errors occurred, but
Scout continued. This confirms the user's report of a long, completed playthrough.

The original invitation explicitly said not to stop while the game was active,
to wait and check again on "Opponent's turn", to move on "Your turn", and to
continue until the final result. ChessMerge exposed those labels and labeled legal
destinations. The new trials used different sites and shorter invitations, so their
results alone cannot establish a regression from recent commits.

Code comparison against `9f8ae55` shows the same one-step continuation mechanism,
120-step and 45-minute limits, and completion on a text-only `stop`. The subsequent
change to that branch allows continuation when a provider returns `stop` together
with completed tool calls. It does not impose a new early-stop condition. Qwen and
Luna model identifiers and generation settings did not change in that comparison.

The Luna baseline has a concrete missed-update sequence: O played bottom-right;
the tool result already contained X at top-right as well as center; Luna then took
that four-piece board as a fresh baseline and waited for another change. After the
wait, it claimed the opponent had not moved. The final status reply ended the run.
In Score Four's premature stop, Qwen correctly recognized that it was the opponent's
turn, but returned a final promise to wait without scheduling any waiting tool.
These are distinct failures; neither was a step limit or missing latest history.

### Replaying the failed decision

A temporary dev-only action replayed the saved Luna final input with no executable
tools. It used the same gateway model, instructions, message history, and JSON tool
schemas. Each candidate generated only its next response; this was a decision probe,
not another completed game. Initial exploratory probes omitted `strict: false` on
two mail schemas; an apparent improvement from removing workspace guidance did not
hold in a corrected repeat and is not treated as a finding.

The corrected probes preserved those flags and asserted equality of the reconstructed
instructions, messages, and tool definitions in the SDK's model-call callback before
dispatch. Three samples were run for each variant:

| Variant                                  | Chose the legal move at index 6 | Waited or reread instead | Text-only stop |
| ---------------------------------------- | ------------------------------: | -----------------------: | -------------: |
| Original saved input                     |                               1 |                        2 |              0 |
| Remove workspace paragraph and Bash tool |                               0 |                        3 |              0 |
| Remove workspace paragraph, retain Bash  |                               0 |                        3 |              0 |
| Remove Play commentary sentence group    |                               0 |                        3 |              0 |

Some probes invented extra pieces or again ignored X at top-right. The exact stop
was not deterministic, while incorrect waiting remained common. These samples do
not identify the workspace tools or commentary instruction as the cause of a
regression. A Qwen comparison produced one tool response, but provider HTTP 429
errors interrupted the matrix; it does not support a comparison between variants.
Those new provider errors do not explain the earlier successful text-only stops.

The temporary action was removed after probing. No change to the runtime, skills,
tool availability, or stopping behavior was retained. The next live comparison
should include ChessMerge with the original invitation, and measure turn recognition
separately from whether Scout keeps issuing calls. More calls alone can preserve
the same mistaken waiting behavior.

## Shorter Play instructions

The next live trials changed only `playInstructions` and the bundled games guide.
Play now directly says to continue until an observed win, loss, draw, or other final
result, and to wait and check again on the opponent's turn. The games guide shrank
from 242 to 68 words. Applied to the saved Luna context, total system instructions
shrank from 1,069 to 880 words. Tools, models, history handling, and the stopping
rule stayed unchanged. This follows [Anthropic's guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
to start with clear, minimal instructions and test them against observed failures.

- [Score Four, Qwen](http://localhost:5173/chats?thread=m578nfvh3f67rj8a6evgr0d5md8e1kps):
  ordinary one-game invitation; 152 seconds, 5 browser credits, $0.00263 model usage.
  Continued through the final move and correctly named the winner. It still confused
  button focus with a pending move and described the winning horizontal line as a
  vertical stack. Completion passed; board reasoning did not.
- [ChessMerge, Qwen](http://localhost:5173/chats?thread=m57bnzz740n96tph04sjx26wds8e02vw):
  ordinary full-game invitation without the site's extra persistence paragraph;
  410 seconds, 14 browser credits, $0.00870 model usage. Played four moves, continued
  through a 49-second opponent pause, and detected the operator's resignation.
  Recovered from repeatedly attempting an illegal knight move by reading legal
  destinations. The final answer reported Black's win by resignation but incorrectly
  told the user they were Black. This was a controlled end-detection test, not a
  complete game ending in checkmate.
- [Tic Tac Toe, Luna](http://localhost:5173/chats?thread=m573xvkqv89xknr32ta2vm4q6n8e1nfk):
  ordinary one-round invitation; 377 seconds, 13 browser credits, $0.04343 model
  usage. The operator was X and opened, unlike the earlier trials. The opening took
  about 75 seconds while verifying the site's symbol mapping; subsequent operator
  moves used the visible turn indicator. Luna initially thought it was X, corrected
  itself to O, and played three moves. X won across the middle row. Luna's next wait
  mistakenly required five Xs and returned the lobby after the game had closed.
  Before another model call, reconnecting to Firecrawl failed with HTTP 504. No
  final result was delivered. This did not reproduce premature text-only stopping,
  but it failed end-to-end completion and is not counted as a successful trial.

Both Qwen runs included seven model attempts marked as retried before a response
completed. The inspector does not retain their underlying errors, so these trials
do not establish why those retries occurred. Earlier successful baselines and this
small sample prevent attributing the completed runs to the prompt change alone.

## Removing duplicated tool instructions

A second trim replaced the system prompt's workspace manual with guidance about
when to use private versus shared files, and shortened the skill-loading preamble.
Tool descriptions already contain the removed format, path, runtime, persistence,
and limit details. Account and credential instructions stayed unchanged. The base
instructions dropped from 469 to 305 words; the same recorded Play context would
drop from 880 to 668 words, excluding tool definitions.

- Luna received the same research-and-save request in fresh chats
  [before](http://localhost:5173/chats?thread=m57cmz7x966wgjeaqhjewcpn9x8e0xr2) and
  [after](http://localhost:5173/chats?thread=m573ezn8gv03hwcddee1qppg9h8e141v).
  Both produced sourced Markdown guides. The baseline's new shared guide was
  removed before repeating the request, leaving the original site guide available
  in both runs. Both confused private source files with the shared site workspace.
  The shorter version fetched the rules through the browser afterward. It took
  9 tool calls and 74 seconds versus 7 calls and 63 seconds before the trim; this
  comparison does not show improved efficiency. The final saved file was read back
  through the workspace API and contained the source link.
- [Score Four, Qwen](http://localhost:5173/chats?thread=m575pdty557pz5j4nbftmtx67n8e0md6)
  used the same ordinary invitation and opponent moves as the preceding run.
  It finished in 204 seconds, with 7 browser credits and $0.00376 model usage.
  It correctly reported the winner, but again described a horizontal line as a
  vertical stack. No premature stop occurred. This supports retaining the simpler
  wording, without claiming a measured improvement in reasoning or reliability.

The complete check and build passed with 633 tests and 3 skipped tests.

## Shared guide discovery and saving

Browsing a site does not create a shared workspace or summarize a transcript.
The workspace is created on the first Bash call with `workspace` set to the site's
hostname. The instructions already ask Scout to check and save site guides.
Five preceding Score Four transcripts had no Bash calls, and the shared dev
workspace for `score-four.pfp.workers.dev` did not exist.

A wording experiment made the timing explicit: read guides before using a site,
then save a short dated guide after verifying a reusable method. It did not make
this behavior reliable:

- [Qwen's ordinary Score Four invitation](http://localhost:5173/chats?thread=m573sqp8wn68w0awasrjszyfsd8e1ada)
  completed the game in 432 seconds, used 14 browser credits and $0.00517 of model
  usage, but made no Bash calls. Opponent response times varied, so this is not a
  latency comparison. It again misdescribed the winning line.
- An explicit follow-up to save the methods produced a private directory named
  after the hostname. Qwen omitted the Bash `workspace` argument. The guide saved
  failed selectors, match-specific player names, an invented date, and incorrect
  board dimensions. It was not available to another chat.
- Luna was explicitly asked to verify and save the guide in the shared workspace.
  It selected that workspace correctly and tested a local move, but also saved an
  untested wait loop and an invented date. The operator replaced that file with
  only the methods supported by recorded successful calls and snapshots. The
  resulting shared guide is manually reviewed test data, not autonomous learning.
- [A fresh Qwen preparation chat](http://localhost:5173/chats?thread=m570a6qa8df6d20t7j01h2dsts8e1f8g)
  went straight to the browser without reading the now-existing shared guide.
  It searched visible button text for the full accessible name, timed out, then
  used the coordinate text instead. It started playing both sides of a local game;
  the operator stopped this test. This was not a completed multiplayer trial.

The additional timing wording was removed after the experiment. The earlier
prompt simplification remains. Storage, choosing the correct workspace, guide
quality, and discovery are separate checks; a successful file write does not
establish reliable reuse. No automatic guide-writing workflow was added.

## Preparation before play

The next experiment changed only the Play instructions. It replaced optional
research with an explicit sequence: inspect the game's shared workspace; if no
useful guide exists, research the rules and inspect the controls, save verified
findings there, then play. Existing guides should be checked and reused. Account
setup remains conditional. The ordinary user invitation contains no guide-writing
instructions.

- [Qwen, BuddyBoardGames Tic Tac Toe](http://localhost:5173/chats?thread=m57f9sp8ef46cv452v758b7hzn8e1989):
  the site workspace did not exist. The recorded first model input contained both
  the new paragraph and Bash's optional `workspace` argument. Qwen selected the
  research activity but made no Bash calls, researched no rules, and saved no
  guide. It played three moves and stopped with "Now it's your turn," without
  reporting the operator's subsequent win. The turn took 295 seconds, 10 browser
  credits, and $0.00567 of model usage. No coaching was sent during the run.
- [Luna, the same game and instructions](http://localhost:5173/chats?thread=m57avc2a31h49kfs0vgb4j17h98e1py9):
  a fresh chat and private room, with the site workspace still absent. Luna called
  Bash with `workspace: "buddyboardgames.com"` before opening the browser and saw
  an empty directory. It then joined and began playing without saving a guide.
  Correct workspace selection alone does not pass the preparation requirement.
  It won with three O moves and reported the observed result, completing in 200
  seconds with 7 browser credits and $0.01809 of model usage. The shared workspace
  was still empty at completion. No coaching or manual guide edits were used.

These two trials do not establish a reliable preparation workflow or isolate the
effect of the wording from model variability. The change adds no automatic guide
injection, forced tool calls, or new workflow machinery.
The explicit preparation paragraph remains in dev as the requested behavior, not
as a demonstrated fix. The full build passed with 633 tests and 3 skipped tests.

## Replaying the user's skipped preparation

The user's [BuddyBoardGames run](http://localhost:5173/chats?thread=m571cxfs3tz9aey8by7d7pbwb58e1188)
contained the preparation paragraph in both its first and final saved model inputs.
It made no shared-workspace calls, loaded no skill, and did no rules research.
Its only Bash call decoded the room identifier in the private workspace.

A temporary internal dev action replayed the first saved input, with the original
20 tool definitions but no executable tools. Each call generated one decision;
it did not play a game or execute the proposed commands. Three samples per model
compared the full 665-word instructions with just the unchanged 165-word Play
section. The ordinary user invitation and tool definitions were identical. All
12 calls verified the reconstructed instructions, messages, and tool definitions
against the expected input in the SDK's pre-call hook.

| Model          | Instructions      | Requested site-workspace Bash | Requested games skill |
| -------------- | ----------------- | ----------------------------: | --------------------: |
| Qwen 3.7 Flash | Original          |                           3/3 |                   0/3 |
| Qwen 3.7 Flash | Play section only |                           0/3 |                   0/3 |
| GPT-5.6 Luna   | Original          |                           1/3 |                   3/3 |
| GPT-5.6 Luna   | Play section only |                           1/3 |                   2/3 |

Categories overlap within a response. A skill-only first decision does not show
whether the model would subsequently check the site workspace. Two of Qwen's
three proposed workspace checks incorrectly appended the hostname to /workspace
although the workspace argument already selected the site. Those commands would
miss files at the workspace root. One response proposed opening the browser in
the same response as checking guides, without first reading the check's result.

This demonstrates variation from the user's original response despite replaying
the same saved input, and exposes a workspace-path misunderstanding. It does not
isolate provider routing, prove why that particular response skipped preparation,
or establish that the shorter instructions improve compliance. No product prompt
or tool change was made during this audit. The temporary action was removed.

## Luna live preparation and completion check

[Fresh Luna chat](http://localhost:5173/chats?thread=m579hfk55zbfdcqt379zpbp0qn8e04vf&session=qh72agh1hjz482t9nqkyyxqyjs8e0c9c),
using the current full instructions and the ordinary prompt "let's play [invitation]".
The existing BuddyBoardGames workspace contained only its root directory. No guides,
prompts, or tools were changed for the trial, and no follow-up coaching was sent.
The operator created a private room and played X through the public game controls.

Luna loaded games, correctly listed /workspace in the buddyboardgames.com workspace,
and selected the research activity. It then joined the room and switched to play
without opening the site's How to Play page, reading rules through a web tool, or
writing a guide. The shared workspace remained empty at completion, revision 1.

It played four legal O moves, blocked an immediate row threat, and reached the
nine-move draw. It observed the site's Stalemate dialog and correctly reported a
draw. All 16 tool calls succeeded; no premature stop or human handoff occurred.
The complete turn took 203 seconds, cost $0.01682731 in recorded model usage, and
used 6 Firecrawl credits. Gameplay completion passed; research and guide creation
failed. This is one live trial, not a measured model success rate.
